"""SpecPatch 校验与应用：把 agent 产出的增量操作安全地落到 AppSpec。"""

from __future__ import annotations

import copy
import re
from typing import Any

VALID_FIELD_TYPES = {'text', 'number', 'select', 'date', 'checkbox', 'relation', 'textarea', 'email', 'url'}


def empty_spec(app_id: str, name: str = '', description: str = '') -> dict[str, Any]:
    return {
        'specVersion': '0.3',
        'app': {
            'id': app_id,
            'name': name,
            'description': description,
            'metadata': {},
        },
        'models': [],
        'seeds': [],
        'pages': [],
        'actions': [],
        'policy': {'roleDefinitions': [], 'attributeDefinitions': [], 'rules': [], 'publicAccess': {}},
        'identityProfiles': [],
        'integrations': [],
        'workflows': [],
        'sharedResources': [],
        'sharedBindings': [],
        'navigation': {'items': []},
        'shell': {'mode': 'workspace'},
        'runtimeCapabilities': {'ai': True, 'speech': False, 'documents': False},
    }


def _err(op: dict[str, Any], msg: str) -> str:
    return f"op[{op.get('op')}] {msg}"


def _validate_model(model: dict[str, Any], spec: dict[str, Any], ignore_id: str | None = None) -> list[str]:
    errors: list[str] = []
    mid = model.get('id')
    if not mid or not re.fullmatch(r'[a-z][a-z0-9_]*', str(mid)):
        errors.append(f"模型 id 非法: {mid!r}（需小写字母开头的 snake_case）")
    if not model.get('name'):
        errors.append(f"模型 {mid} 缺少 name")
    fields = model.get('fields') or []
    seen_field_ids = set()
    for f in fields:
        fid = f.get('id')
        if not fid or fid in seen_field_ids:
            errors.append(f"模型 {mid} 字段 id 缺失或重复: {fid!r}")
            continue
        seen_field_ids.add(fid)
        if f.get('type') not in VALID_FIELD_TYPES:
            errors.append(f"模型 {mid} 字段 {fid} 类型非法: {f.get('type')}")
        if f.get('type') == 'relation':
            rel = f.get('relation') or {}
            target = rel.get('targetModelId')
            if not target:
                errors.append(f"模型 {mid} 字段 {fid} relation 缺少 targetModelId")
            elif target != mid and target != ignore_id and not any(m.get('id') == target for m in spec.get('models', [])):
                errors.append(f"模型 {mid} 字段 {fid} relation 指向不存在的模型: {target}")
            if rel.get('cardinality') not in (None, 'one', 'many'):
                errors.append(f"模型 {mid} 字段 {fid} relation cardinality 非法: {rel.get('cardinality')}")
    return errors


def apply_patch(spec: dict[str, Any], patch: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """应用 SpecPatch，返回 (new_spec, errors)。errors 非空表示部分/全部 op 被拒绝。"""
    new_spec = copy.deepcopy(spec)
    errors: list[str] = []
    # 规范化顶层集合键，容忍历史/简化 spec 缺键
    for key, default in (
        ('models', []), ('seeds', []), ('pages', []), ('actions', []),
        ('navigation', {'items': []}), ('policy', {}), ('shell', {}),
    ):
        if not isinstance(new_spec.get(key), type(default)):
            new_spec[key] = default
    new_spec['navigation'].setdefault('items', [])
    models: list[dict[str, Any]] = new_spec['models']

    for op in patch.get('operations', []):
        kind = op.get('op')
        try:
            if kind == 'add_model':
                model = op.get('model') or {}
                if any(m.get('id') == model.get('id') for m in models):
                    errors.append(_err(op, f"模型已存在: {model.get('id')}"))
                    continue
                sub = _validate_model(model, new_spec)
                errors += [_err(op, e) for e in sub]
                models.append(model)
            elif kind == 'update_model':
                mid = op.get('modelId')
                target = next((m for m in models if m.get('id') == mid), None)
                if target is None:
                    errors.append(_err(op, f"模型不存在: {mid}"))
                    continue
                for f in op.get('fields', []):
                    existing = next((x for x in target.setdefault('fields', []) if x.get('id') == f.get('id')), None)
                    if existing:
                        existing.update(f)
                    else:
                        target['fields'].append(f)
                if 'name' in op:
                    target['name'] = op['name']
                sub = _validate_model(target, new_spec)
                errors += [_err(op, e) for e in sub]
            elif kind == 'remove_model':
                mid = op.get('modelId')
                if not any(m.get('id') == mid for m in models):
                    errors.append(_err(op, f"模型不存在: {mid}"))
                    continue
                new_spec['models'] = [m for m in models if m.get('id') != mid]
                models = new_spec['models']
                new_spec['seeds'] = [s for s in new_spec['seeds'] if s.get('modelId') != mid]
                new_spec['pages'] = [p for p in new_spec['pages'] if p.get('modelId') != mid]
                # 清理指向被删模型的 relation 字段
                for m in models:
                    m['fields'] = [
                        f for f in m.get('fields', [])
                        if not (f.get('type') == 'relation' and (f.get('relation') or {}).get('targetModelId') == mid)
                    ]
                alive_page_ids = {p['id'] for p in new_spec['pages']}
                new_spec['navigation']['items'] = [
                    i for i in new_spec['navigation']['items'] if i.get('pageId') in alive_page_ids
                ]
            elif kind == 'add_seed':
                mid = op.get('modelId')
                if not any(m.get('id') == mid for m in models):
                    errors.append(_err(op, f"模型不存在: {mid}"))
                    continue
                new_spec['seeds'].append({'modelId': mid, 'rows': op.get('rows', [])})
            elif kind == 'add_page':
                page = op.get('page') or {}
                if not page.get('id'):
                    errors.append(_err(op, 'page 缺少 id'))
                    continue
                pid = page.get('modelId')
                if pid and not any(m.get('id') == pid for m in models):
                    errors.append(_err(op, f"page 引用的模型不存在: {pid}"))
                    continue
                if any(p.get('id') == page.get('id') for p in new_spec['pages']):
                    errors.append(_err(op, f"页面已存在: {page.get('id')}"))
                    continue
                new_spec['pages'].append(page)
            elif kind == 'set_navigation':
                items = op.get('items', [])
                page_ids = {p.get('id') for p in new_spec['pages']}
                bad = [i for i in items if i.get('pageId') not in page_ids]
                if bad:
                    errors.append(_err(op, f"导航引用不存在的页面: {[i.get('pageId') for i in bad]}"))
                    continue
                new_spec['navigation']['items'] = items
            elif kind == 'set_metadata':
                key = op.get('key', '')
                if not key:
                    errors.append(_err(op, 'set_metadata 缺少 key'))
                    continue
                node: Any = new_spec
                parts = key.split('.')
                for p in parts[:-1]:
                    node = node.setdefault(p, {})
                node[parts[-1]] = op.get('value')
            else:
                errors.append(_err(op, f'未知操作类型: {kind}'))
        except Exception as e:  # 防御：单个 op 异常不拖垮整体
            errors.append(_err(op, f'应用异常: {e}'))

    return new_spec, errors


SPEC_PATCH_MARKER = re.compile(r'```(?:json)?\s*(\{.*?"type"\s*:\s*"spec_patch".*?\})\s*```', re.DOTALL)


def extract_spec_patch(text: str) -> dict[str, Any] | None:
    """从 LLM 回复文本中提取 ```json {type: spec_patch} 代码块。"""
    m = SPEC_PATCH_MARKER.search(text)
    if not m:
        return None
    import json

    try:
        patch = json.loads(m.group(1))
        return patch if isinstance(patch, dict) and patch.get('type') == 'spec_patch' else None
    except json.JSONDecodeError:
        return None
