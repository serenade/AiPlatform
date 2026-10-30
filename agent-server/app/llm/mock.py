"""Mock 模式：确定性剧本 + 模拟流式输出，零外部依赖可演示。"""

from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

from .client import LlmClient


def _meeting_room_patch() -> dict:
    return {
        'type': 'spec_patch',
        'summary': '新增会议室与预订两个数据模型、预订列表页和导航',
        'operations': [
            {
                'op': 'add_model',
                'model': {
                    'id': 'meeting_room',
                    'name': '会议室',
                    'fields': [
                        {'id': 'name', 'name': '会议室名称', 'type': 'text', 'required': True},
                        {'id': 'capacity', 'name': '容纳人数', 'type': 'number', 'required': True},
                        {'id': 'location', 'name': '位置', 'type': 'text', 'required': False},
                        {
                            'id': 'status', 'name': '状态', 'type': 'select', 'required': True,
                            'options': ['可用', '维护中'],
                        },
                    ],
                },
            },
            {
                'op': 'add_model',
                'model': {
                    'id': 'reservation',
                    'name': '会议室预订',
                    'fields': [
                        {'id': 'title', 'name': '会议主题', 'type': 'text', 'required': True},
                        {'id': 'room', 'name': '会议室', 'type': 'relation', 'required': True,
                         'relation': {'targetModelId': 'meeting_room', 'cardinality': 'one', 'displayFieldId': 'name'}},
                        {'id': 'booker', 'name': '预订人', 'type': 'text', 'required': True},
                        {'id': 'start_time', 'name': '开始时间', 'type': 'text', 'required': True},
                        {'id': 'end_time', 'name': '结束时间', 'type': 'text', 'required': True},
                    ],
                },
            },
            {
                'op': 'add_seed',
                'modelId': 'meeting_room',
                'rows': [
                    {'name': '三层·启明厅', 'capacity': 12, 'location': '3F 东侧', 'status': '可用'},
                    {'name': '五层·皓月厅', 'capacity': 6, 'location': '5F 西侧', 'status': '可用'},
                ],
            },
            {
                'op': 'add_page',
                'page': {'id': 'reservations_page', 'title': '预订列表', 'type': 'table', 'modelId': 'reservation'},
            },
            {
                'op': 'add_page',
                'page': {'id': 'rooms_page', 'title': '会议室', 'type': 'table', 'modelId': 'meeting_room'},
            },
            {
                'op': 'set_navigation',
                'items': [
                    {'id': 'nav_reservations', 'label': '会议室预订', 'pageId': 'reservations_page'},
                    {'id': 'nav_rooms', 'label': '会议室', 'pageId': 'rooms_page'},
                ],
            },
            {'op': 'set_metadata', 'key': 'shell.mode', 'value': 'workspace'},
        ],
    }


def _crm_patch() -> dict:
    return {
        'type': 'spec_patch',
        'summary': '新增客户与跟进记录模型、客户列表页和导航',
        'operations': [
            {
                'op': 'add_model',
                'model': {
                    'id': 'customer',
                    'name': '客户',
                    'fields': [
                        {'id': 'name', 'name': '客户名称', 'type': 'text', 'required': True},
                        {'id': 'level', 'name': '级别', 'type': 'select', 'required': True,
                         'options': ['A', 'B', 'C']},
                        {'id': 'owner', 'name': '负责人', 'type': 'text', 'required': False},
                        {'id': 'contact', 'name': '联系方式', 'type': 'text', 'required': False},
                    ],
                },
            },
            {
                'op': 'add_model',
                'model': {
                    'id': 'follow_up',
                    'name': '跟进记录',
                    'fields': [
                        {'id': 'content', 'name': '跟进内容', 'type': 'textarea', 'required': True},
                        {'id': 'customer', 'name': '客户', 'type': 'relation', 'required': True,
                         'relation': {'targetModelId': 'customer', 'cardinality': 'one', 'displayFieldId': 'name'}},
                        {'id': 'follow_at', 'name': '跟进时间', 'type': 'date', 'required': True},
                    ],
                },
            },
            {
                'op': 'add_page',
                'page': {'id': 'customers_page', 'title': '客户列表', 'type': 'table', 'modelId': 'customer'},
            },
            {
                'op': 'add_page',
                'page': {'id': 'follow_ups_page', 'title': '跟进记录', 'type': 'table', 'modelId': 'follow_up'},
            },
            {
                'op': 'set_navigation',
                'items': [
                    {'id': 'nav_customers', 'label': '客户', 'pageId': 'customers_page'},
                    {'id': 'nav_follow_ups', 'label': '跟进记录', 'pageId': 'follow_ups_page'},
                ],
            },
        ],
    }


def _todo_patch() -> dict:
    return {
        'type': 'spec_patch',
        'summary': '新增任务模型、任务列表页和导航',
        'operations': [
            {
                'op': 'add_model',
                'model': {
                    'id': 'task',
                    'name': '任务',
                    'fields': [
                        {'id': 'title', 'name': '任务名称', 'type': 'text', 'required': True},
                        {'id': 'priority', 'name': '优先级', 'type': 'select', 'required': True,
                         'options': ['高', '中', '低']},
                        {'id': 'assignee', 'name': '负责人', 'type': 'text', 'required': False},
                        {'id': 'done', 'name': '是否完成', 'type': 'checkbox', 'required': False},
                    ],
                },
            },
            {
                'op': 'add_seed',
                'modelId': 'task',
                'rows': [
                    {'title': '梳理业务流程', 'priority': '高', 'assignee': '管理员', 'done': False},
                    {'title': '邀请团队成员', 'priority': '中', 'assignee': '管理员', 'done': False},
                ],
            },
            {
                'op': 'add_page',
                'page': {'id': 'tasks_page', 'title': '任务列表', 'type': 'table', 'modelId': 'task'},
            },
            {
                'op': 'set_navigation',
                'items': [{'id': 'nav_tasks', 'label': '任务', 'pageId': 'tasks_page'}],
            },
        ],
    }


def _pick_scenario(user_text: str) -> tuple[str, dict]:
    t = user_text.lower()
    if any(k in t for k in ('会议', '预订', '房间', 'meeting', 'room')):
        return '会议室预订', _meeting_room_patch()
    if any(k in t for k in ('客户', 'crm', '跟进', '销售')):
        return '客户管理（CRM）', _crm_patch()
    return '任务管理', _todo_patch()


def _render_reply(scenario: str, patch: dict) -> str:
    ops = patch['operations']
    model_names = [o['model']['name'] for o in ops if o.get('op') == 'add_model']
    page_titles = [o['page']['title'] for o in ops if o.get('op') == 'add_page']
    lines = [
        f'好的，我为你规划了一套「{scenario}」应用结构：',
        '',
    ]
    if model_names:
        lines.append(f'**数据模型**：{"、".join(model_names)}')
    if page_titles:
        lines.append(f'**页面**：{"、".join(page_titles)}')
    lines += [
        '',
        '确认无误后，点击下方「应用更改」即可落库为新版本。',
        '',
        '```json',
        json.dumps(patch, ensure_ascii=False, indent=2),
        '```',
    ]
    return '\n'.join(lines)


def _extract_model_ids(system: str) -> list[str]:
    """从 system prompt 的 spec 摘要中提取模型 id（保持作用域一致）。

    摘要 JSON 之后还拼接了 Schema Hint 等含大括号的文本，
    因此先定位标记，再按括号平衡截取完整 JSON。
    """
    marker = '当前应用 AppSpec 摘要：'
    idx = system.find(marker)
    if idx < 0:
        return []
    start = system.find('{', idx)
    if start < 0:
        return []
    depth = 0
    for i in range(start, len(system)):
        if system[i] == '{':
            depth += 1
        elif system[i] == '}':
            depth -= 1
            if depth == 0:
                try:
                    summary = json.loads(system[start : i + 1])
                    return [m['id'] for m in summary.get('models', []) if m.get('id')]
                except json.JSONDecodeError:
                    return []
    return []


class MockLlm(LlmClient):
    mode = 'mock'
    model = 'mock-scripted'
    supports_tools = True

    async def stream_reply(self, system: str, user_text: str) -> AsyncIterator[str]:
        scenario, patch = _pick_scenario(user_text)
        reply = _render_reply(scenario, patch)
        # 模拟流式：按 24 字符块输出，间隔 180ms
        for i in range(0, len(reply), 24):
            yield reply[i : i + 24]
            await asyncio.sleep(0.18)

    async def chat_completion(self, messages, tools=None):  # noqa: ANN001, ANN202
        from .client import ToolCallResult

        def tool_def(name: str):
            for t in tools or []:
                if t.get('function', {}).get('name') == name:
                    return t['function']
            return None

        user_text = next(
            (m['content'] for m in reversed(messages) if m.get('role') == 'user'), ''
        )
        last = messages[-1] if messages else {}

        # 第二轮：工具结果已返回 → 生成总结
        if last.get('role') == 'tool':
            try:
                output = json.loads(last.get('content') or '{}')
            except json.JSONDecodeError:
                output = {}
            records = ((output.get('result') or {}).get('records')) or []
            lines = [f'已从当前应用查询到 **{len(records)} 条记录**：', '']
            for r in records[:5]:
                brief = {k: v for k, v in r.items() if k not in ('id', 'createdAt', 'updatedAt')}
                lines.append('- ' + json.dumps(brief, ensure_ascii=False))
            if not records:
                lines.append('（暂无数据。你可以在应用里新增记录，或让我提交 SpecPatch 加一些示例数据。）')
            return ToolCallResult('\n'.join(lines), None)

        # 数据查询意图 → 产出 query_records 工具调用（仅当应用已有模型）
        if tool_def('query_records') and any(
            k in user_text for k in ('查', '看看', '列表', '多少', '有几', '数据')
        ) and not any(k in user_text for k in ('搭建', '创建模型', '加一个模型', '做一个', '生成')):
            model_ids = _extract_model_ids(messages[0]['content'] if messages else '')
            if model_ids:
                return ToolCallResult(
                    None,
                    [
                        {
                            'id': 'call_mock_query',
                            'type': 'function',
                            'function': {
                                'name': 'query_records',
                                'arguments': json.dumps({'model_id': model_ids[0], 'limit': 10}, ensure_ascii=False),
                            },
                        }
                    ],
                )

        # 创建记录意图
        if tool_def('create_record') and any(k in user_text for k in ('记一笔', '记一条', '添加记录', '新增记录')):
            model_ids = _extract_model_ids(messages[0]['content'] if messages else '')
            if model_ids:
                return ToolCallResult(
                    None,
                    [
                        {
                            'id': 'call_mock_create',
                            'type': 'function',
                            'function': {
                                'name': 'create_record',
                                'arguments': json.dumps({'model_id': model_ids[0], 'data': {'title': 'AI 快速记录', 'name': 'AI 快速记录'}}, ensure_ascii=False),
                            },
                        }
                    ],
                )

        # 第二轮总结（创建类）
        if any(m.get('role') == 'tool' for m in messages[-2:]):
            return ToolCallResult('已完成操作。还有什么需要我帮忙的吗？', None)

        # 其他意图 → 回退到搭建剧本（保持 Builder 闭环）
        scenario, patch = _pick_scenario(user_text)
        return ToolCallResult(_render_reply(scenario, patch), None)
