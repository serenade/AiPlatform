"""应用级 AI 工具集（需求4）：通过 function calling 调度当前应用的功能。

作用域严格限定在 context.app_id —— 所有平台数据调用都拼入该 app_id，
由平台 API 按应用校验模型存在性；LLM 无法越权访问其他应用的数据。
"""

from __future__ import annotations

import json
from typing import Any

import httpx

MAX_TOOL_ROUNDS = 6


def build_tool_specs(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """按当前 spec 生成工具描述（模型列表作为 description 注入，帮助 LLM 选择）。"""
    model_brief = '、'.join(f"{m.get('id')}({m.get('name')})" for m in spec.get('models', [])) or '暂无模型'

    def fn(name: str, desc: str, props: dict[str, Any], required: list[str]) -> dict[str, Any]:
        return {
            'type': 'function',
            'function': {
                'name': name,
                'description': desc,
                'parameters': {'type': 'object', 'properties': props, 'required': required},
            },
        }

    return [
        fn(
            'list_app_models',
            f'获取当前应用的数据模型与字段结构。当前应用模型：{model_brief}',
            {},
            [],
        ),
        fn(
            'query_records',
            '查询当前应用指定模型的记录列表（可关键词搜索）',
            {
                'model_id': {'type': 'string', 'description': '模型 id'},
                'q': {'type': 'string', 'description': '关键词（可选）'},
                'limit': {'type': 'integer', 'description': '返回条数，默认 20，最大 100'},
            },
            ['model_id'],
        ),
        fn(
            'create_record',
            '在当前应用的指定模型中创建一条记录',
            {
                'model_id': {'type': 'string', 'description': '模型 id'},
                'data': {'type': 'object', 'description': '字段值字典，如 {"title": "周会", "room": "A301"}'},
            },
            ['model_id', 'data'],
        ),
        fn(
            'update_record',
            '更新当前应用中指定记录的部分字段',
            {
                'model_id': {'type': 'string', 'description': '模型 id'},
                'record_id': {'type': 'string', 'description': '记录 id'},
                'data': {'type': 'object', 'description': '要更新的字段值字典'},
            },
            ['model_id', 'record_id', 'data'],
        ),
        fn(
            'delete_record',
            '删除当前应用中指定的一条记录',
            {
                'model_id': {'type': 'string', 'description': '模型 id'},
                'record_id': {'type': 'string', 'description': '记录 id'},
            },
            ['model_id', 'record_id'],
        ),
        fn(
            'propose_spec_patch',
            '以 SpecPatch 提案形式修改应用结构（新增模型/页面/导航等），提案经用户确认后生效',
            {
                'summary': {'type': 'string', 'description': '一句话总结变更'},
                'operations': {
                    'type': 'array',
                    'description': (
                        '增量操作数组，可用 op：add_model / update_model / remove_model / add_seed / '
                        'add_page / set_navigation / set_metadata'
                    ),
                    'items': {'type': 'object'},
                },
            },
            ['summary', 'operations'],
        ),
    ]


class AppToolExecutor:
    """工具执行器：通过平台 API（internal token）访问应用数据，作用域锁定 app_id。"""

    def __init__(self, platform_api_url: str, internal_token: str, store, spec_fetcher):
        self.platform = platform_api_url.rstrip('/')
        self.token = internal_token
        self.store = store  # SQLiteStore，用于保存 SpecPatch 提案
        self.spec_fetcher = spec_fetcher

    def _headers(self) -> dict[str, str]:
        return {'x-internal-token': self.token}

    async def execute(self, name: str, args: dict[str, Any], app_id: str, thread_id: str) -> dict[str, Any]:
        try:
            if name == 'list_app_models':
                return await self._list_models(app_id)
            if name == 'query_records':
                return await self._query_records(app_id, args)
            if name == 'create_record':
                return await self._create_record(app_id, args)
            if name == 'update_record':
                return await self._update_record(app_id, args)
            if name == 'delete_record':
                return await self._delete_record(app_id, args)
            if name == 'propose_spec_patch':
                return await self._propose_patch(app_id, thread_id, args)
            return {'ok': False, 'error': f'未知工具: {name}'}
        except Exception as exc:  # noqa: BLE001 — 工具错误回传给 LLM 自行调整
            return {'ok': False, 'error': str(exc)[:400]}

    async def _list_models(self, app_id: str) -> dict[str, Any]:
        spec = await self.spec_fetcher(app_id)
        models = [
            {
                'id': m.get('id'),
                'name': m.get('name'),
                'fields': [
                    {'id': f.get('id'), 'name': f.get('name'), 'type': f.get('type')} for f in m.get('fields', [])
                ],
            }
            for m in spec.get('models', [])
        ]
        return {'ok': True, 'models': models}

    async def _query_records(self, app_id: str, args: dict[str, Any]) -> dict[str, Any]:
        params: dict[str, Any] = {'limit': min(int(args.get('limit') or 20), 100)}
        if args.get('q'):
            params['q'] = args['q']
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                f'{self.platform}/api/apps/{app_id}/data/{args["model_id"]}',
                params=params,
                headers=self._headers(),
            )
        return self._data_result(resp)

    async def _create_record(self, app_id: str, args: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.post(
                f'{self.platform}/api/apps/{app_id}/data/{args["model_id"]}',
                json={'data': args.get('data') or {}},
                headers=self._headers(),
            )
        return self._data_result(resp)

    async def _update_record(self, app_id: str, args: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.put(
                f'{self.platform}/api/apps/{app_id}/data/{args["model_id"]}/{args["record_id"]}',
                json={'data': args.get('data') or {}},
                headers=self._headers(),
            )
        return self._data_result(resp)

    async def _delete_record(self, app_id: str, args: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.delete(
                f'{self.platform}/api/apps/{app_id}/data/{args["model_id"]}/{args["record_id"]}',
                headers=self._headers(),
            )
        if resp.status_code == 204:
            return {'ok': True, 'deleted': args['record_id']}
        return self._data_result(resp)

    async def _propose_patch(self, app_id: str, thread_id: str, args: dict[str, Any]) -> dict[str, Any]:
        spec = await self.spec_fetcher(app_id)
        patch = {'type': 'spec_patch', 'summary': args.get('summary', ''), 'operations': args.get('operations', [])}
        from .spec.patch import apply_patch

        _, errors = apply_patch(spec, patch)
        self.store.save_proposal(thread_id, app_id, patch, errors)
        if errors:
            return {'ok': False, 'saved': True, 'errors': errors, 'message': '提案存在校验错误，请修正后重新提交'}
        return {
            'ok': True,
            'saved': True,
            'message': '提案已保存，等待用户在界面上确认应用（apply）后生效',
        }

    @staticmethod
    def _data_result(resp: httpx.Response) -> dict[str, Any]:
        if resp.status_code == 204:
            return {'ok': True}
        try:
            body = resp.json()
        except Exception:  # noqa: BLE001
            body = resp.text[:400]
        if resp.status_code >= 400:
            message = body.get('message') if isinstance(body, dict) else str(body)
            return {'ok': False, 'status': resp.status_code, 'error': message}
        return {'ok': True, 'result': body}


def tool_message_chunks(text: str, size: int = 24) -> list[str]:
    """把非流式的最终回复切块，模拟流式输出节奏。"""
    return [text[i : i + size] for i in range(0, len(text), size)] or ['']
