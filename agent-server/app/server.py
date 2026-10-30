"""AIR ChatKit Server：respond 流式产出助手消息 + SpecPatch 提案。"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from chatkit.server import ChatKitServer
from chatkit.types import (
    AssistantMessageContent,
    AssistantMessageContentPartAdded,
    AssistantMessageContentPartDone,
    AssistantMessageContentPartTextDelta,
    AssistantMessageItem,
    ThreadItemDoneEvent,
    ThreadItemAddedEvent,
    ThreadItemUpdatedEvent,
    ThreadMetadata,
    UserMessageItem,
    UserMessageTextContent,
)

from .llm.client import LlmClient
from .spec.patch import apply_patch, empty_spec, extract_spec_patch
from .store import SQLiteStore


@dataclass
class RequestContext:
    app_id: str
    user_id: str | None = None


SPEC_PATCH_SCHEMA_HINT = """\
输出约定（严格遵守）：
1. 先用简洁的中文解释你的规划（数据模型、页面、导航）。
2. 回复末尾输出一个 ```json 代码块，内容为 SpecPatch：
{"type":"spec_patch","summary":"一句话总结","operations":[...]}
3. 只输出增量操作，不要重复全量 spec。可用 op：
   - {"op":"add_model","model":{"id":"snake_case_id","name":"中文名","fields":[{"id","name","type","required","options?","relation?"}]}}
     字段 type ∈ text|textarea|number|select|date|checkbox|email|url|relation
     select 需要 options:[...]; relation 需要 relation:{targetModelId,cardinality:"one"|"many",displayFieldId}
   - {"op":"update_model","modelId":"...","fields":[...]}   # 按 field.id 合并
   - {"op":"remove_model","modelId":"..."}
   - {"op":"add_seed","modelId":"...","rows":[{...}]}
   - {"op":"add_page","page":{"id":"...","title":"...","type":"table","modelId":"..."}}
   - {"op":"set_navigation","items":[{"id":"...","label":"...","pageId":"..."}]}
   - {"op":"set_metadata","key":"shell.mode","value":"..."}
4. 所有 id 用小写 snake_case；页面 modelId 必须是本次或已有模型 id。
"""


def build_system_prompt(spec: dict[str, Any]) -> str:
    summary = {
        'models': [{'id': m.get('id'), 'name': m.get('name'), 'fields': [f.get('id') for f in m.get('fields', [])]} for m in spec.get('models', [])],
        'pages': [{'id': p.get('id'), 'title': p.get('title')} for p in spec.get('pages', [])],
        'navigation': spec.get('navigation', {}).get('items', []),
    }
    return (
        '你是「Ai智能企业应用平台」的 AppSpec 应用搭建助手。用户通过对话搭建声明式应用，'
        '你负责规划数据模型与页面，并以 SpecPatch 增量操作的形式产出提案。\n\n'
        '你还可以调用工具直接操作当前应用的数据（查询/创建/更新/删除记录），以及提交 SpecPatch 提案。'
        '需要读写应用数据时优先使用工具；只有当用户要求修改应用结构（模型/页面/导航）时才提交提案。'
        '所有工具的作用域严格限定在当前应用内。\n\n'
        f'当前应用 AppSpec 摘要：\n{json.dumps(summary, ensure_ascii=False, indent=2)}\n\n'
        '产品记忆：请围绕用户的应用定位持续完善模型与页面，避免重复创建。\n\n'
        + SPEC_PATCH_SCHEMA_HINT
    )


class AirChatKitServer(ChatKitServer[RequestContext]):
    def __init__(self, store: SQLiteStore, llm: LlmClient, spec_fetcher, tool_executor=None, llm_resolver=None):
        super().__init__(store)
        self.store: SQLiteStore = store  # 收窄类型，便于访问扩展方法
        self.llm = llm
        self.spec_fetcher = spec_fetcher  # async (app_id) -> dict
        self.tool_executor = tool_executor  # AppToolExecutor | None
        self.llm_resolver = llm_resolver  # async (app_id) -> LlmClient | None

    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem | None,
        context: RequestContext,
    ) -> AsyncIterator[Any]:
        if input_user_message is None:
            return

        user_text = ''.join(
            c.text for c in input_user_message.content if isinstance(c, UserMessageTextContent)
        ).strip()

        if not thread.title:
            thread.title = user_text[:24] or '新会话'

        # 注入运行时归属，SDK save_thread 时随之持久化（重启后可回溯）
        thread.metadata = {**(thread.metadata or {}), 'app_id': context.app_id, 'user_id': context.user_id}

        current_spec = await self.spec_fetcher(context.app_id)
        system = build_system_prompt(current_spec)

        # 按应用解析 LLM（平台模型配置 → 环境变量 → Mock）
        llm: LlmClient | None = self.llm
        resolve_error: str | None = None
        if self.llm_resolver is not None:
            try:
                llm = await self.llm_resolver(context.app_id)
            except Exception as exc:  # noqa: BLE001
                llm = None
                resolve_error = f'模型调用失败：{exc}'

        item_id = self.store.generate_item_id('message', thread, context)
        item = AssistantMessageItem(id=item_id, thread_id=thread.id, created_at=datetime.now(timezone.utc), content=[])
        yield ThreadItemAddedEvent(item=item)
        yield ThreadItemUpdatedEvent(
            item_id=item_id,
            update=AssistantMessageContentPartAdded(content_index=0, content=AssistantMessageContent(text='')),
        )

        if llm is None:
            from .tools import tool_message_chunks

            hint = (
                f'{resolve_error}\n\n'
                '请在 **平台设置 → 智能能力 / 模型配置** 中添加并启用一个 OpenAI 兼容模型，'
                '或为 Agent Server 配置环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL（LLM_MOCK=off 时不允许回退内置演示模式）。'
            )
            for chunk in tool_message_chunks(hint):
                yield ThreadItemUpdatedEvent(
                    item_id=item_id,
                    update=AssistantMessageContentPartTextDelta(content_index=0, delta=chunk),
                )
            yield ThreadItemUpdatedEvent(
                item_id=item_id,
                update=AssistantMessageContentPartDone(content_index=0, content=AssistantMessageContent(text=hint)),
            )
            yield ThreadItemDoneEvent(
                item=AssistantMessageItem(
                    id=item_id, thread_id=thread.id, created_at=item.created_at,
                    content=[AssistantMessageContent(text=hint)],
                )
            )
            return

        if llm.supports_tools and self.tool_executor is not None:
            from .tools import MAX_TOOL_ROUNDS, build_tool_specs, tool_message_chunks

            tools = build_tool_specs(current_spec)
            messages: list[dict[str, Any]] = [
                {'role': 'system', 'content': system},
                {'role': 'user', 'content': user_text},
            ]
            final_text = ''
            for _ in range(MAX_TOOL_ROUNDS):
                result = await llm.chat_completion(messages, tools)
                if result.tool_calls:
                    messages.append({'role': 'assistant', 'content': result.content, 'tool_calls': result.tool_calls})
                    for tc in result.tool_calls:
                        name = tc['function']['name']
                        try:
                            args = json.loads(tc['function']['arguments'] or '{}')
                        except json.JSONDecodeError:
                            args = {}
                        output = await self.tool_executor.execute(name, args, context.app_id, thread.id)
                        messages.append(
                            {
                                'role': 'tool',
                                'tool_call_id': tc['id'],
                                'content': json.dumps(output, ensure_ascii=False)[:4000],
                            }
                        )
                    continue

                final_text = result.content or ''
                # 文本内嵌 spec_patch 兜底解析
                patch = extract_spec_patch(final_text)
                if patch is not None:
                    _, errors = apply_patch(current_spec, patch)
                    self.store.save_proposal(thread.id, context.app_id, patch, errors)
                break
            else:
                final_text = '（已达工具调用轮次上限，请拆分需求后重试）'

            full_text = final_text
            # 分块产出，保持前端流式渲染节奏
            for chunk in tool_message_chunks(final_text):
                yield ThreadItemUpdatedEvent(
                    item_id=item_id,
                    update=AssistantMessageContentPartTextDelta(content_index=0, delta=chunk),
                )
        else:
            chunks: list[str] = []
            async for delta in llm.stream_reply(system, user_text):
                chunks.append(delta)
                yield ThreadItemUpdatedEvent(
                    item_id=item_id,
                    update=AssistantMessageContentPartTextDelta(content_index=0, delta=delta),
                )
            full_text = ''.join(chunks)
            # 文本内嵌 spec_patch 代码块（Mock 模式路径）
            patch = extract_spec_patch(full_text)
            if patch is not None:
                _, errors = apply_patch(current_spec, patch)
                self.store.save_proposal(thread.id, context.app_id, patch, errors)

        yield ThreadItemUpdatedEvent(
            item_id=item_id,
            update=AssistantMessageContentPartDone(
                content_index=0, content=AssistantMessageContent(text=full_text)
            ),
        )
        done_item = AssistantMessageItem(
            id=item_id,
            thread_id=thread.id,
            created_at=item.created_at,
            content=[AssistantMessageContent(text=full_text)],
        )
        yield ThreadItemDoneEvent(item=done_item)

    # attach runtime info for proposals metadata fallback
    def latest_proposal(self, thread_id: str) -> dict[str, Any] | None:
        return self.store.get_proposal(thread_id)


def build_default_spec(app_id: str) -> dict[str, Any]:
    return empty_spec(app_id)
