"""LLM 客户端抽象 + 双模式工厂（OpenAI 兼容 / Mock 自动探测）。"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from typing import Any, AsyncIterator

import httpx


class LlmClient(ABC):
    mode: str = 'mock'
    model: str | None = None
    supports_tools: bool = False

    @abstractmethod
    def stream_reply(self, system: str, user_text: str) -> AsyncIterator[str]:
        """流式产出回复文本（含末尾的 spec_patch 代码块）。"""
        raise NotImplementedError


class ToolCallResult:
    __slots__ = ('content', 'tool_calls')

    def __init__(self, content: str | None, tool_calls: list[dict[str, Any]] | None):
        self.content = content
        self.tool_calls = tool_calls  # OpenAI 格式: [{"id","type":"function","function":{"name","arguments"}}]


class OpenAiCompatClient(LlmClient):
    """任意 OpenAI 兼容端点（DeepSeek / Qwen / vLLM / OpenAI 官方…）。"""

    mode = 'real'
    supports_tools = True

    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = base_url.rstrip('/')
        self.model = model
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(base_url=base_url, api_key=api_key, http_client=httpx.AsyncClient(timeout=120))

    async def stream_reply(self, system: str, user_text: str) -> AsyncIterator[str]:
        stream = await self.client.chat.completions.create(
            model=self.model,  # type: ignore[arg-type]
            messages=[
                {'role': 'system', 'content': system},
                {'role': 'user', 'content': user_text},
            ],
            stream=True,
            temperature=0.3,
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    async def chat_completion(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> ToolCallResult:
        """非流式补全（工具调用循环用），返回 content 与 OpenAI 格式 tool_calls。"""
        kwargs: dict[str, Any] = {'model': self.model, 'messages': messages, 'temperature': 0.3}  # type: ignore[arg-type]
        if tools:
            kwargs['tools'] = tools
        resp = await self.client.chat.completions.create(**kwargs)
        choice = resp.choices[0] if resp.choices else None
        message = choice.message if choice else None
        tool_calls = None
        if message and message.tool_calls:
            tool_calls = [
                {
                    'id': tc.id,
                    'type': 'function',
                    'function': {'name': tc.function.name, 'arguments': tc.function.arguments or '{}'},
                }
                for tc in message.tool_calls
            ]
        return ToolCallResult(message.content if message else None, tool_calls)


def create_llm() -> LlmClient:
    """环境变量模式的 LLM 工厂：LLM_MOCK=on → Mock；配置齐全 → 真实；否则 Mock。

    off 模式的「无配置报错」由 main.resolve_llm 处理（平台模型配置也可作为来源）。
    """
    mock_flag = os.getenv('LLM_MOCK', 'auto').strip().lower()
    base_url = os.getenv('LLM_BASE_URL', '').strip()
    api_key = os.getenv('LLM_API_KEY', '').strip()
    model = os.getenv('LLM_MODEL', '').strip()
    configured = bool(base_url and api_key and model)

    if mock_flag != 'on' and configured:
        client = OpenAiCompatClient(base_url, api_key, model)
        client.model = model
        return client

    from .mock import MockLlm

    return MockLlm()
