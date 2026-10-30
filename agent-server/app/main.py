"""AIR Agent Server — FastAPI 入口。

端点形状对齐原平台 /agent/* 家族；ChatKit 协议由 openai-chatkit SDK 承载。
"""

from __future__ import annotations

import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from chatkit.server import NonStreamingResult, StreamingResult
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from .llm.client import LlmClient, OpenAiCompatClient, create_llm
from .server import AirChatKitServer, RequestContext
from .spec.patch import apply_patch, empty_spec
from .store import SQLiteStore
from .tools import AppToolExecutor

DB_PATH = os.getenv('AGENT_DB_PATH', str(Path(__file__).resolve().parent.parent / 'data' / 'agent.db'))
PLATFORM_API_URL = os.getenv('PLATFORM_API_URL', 'http://localhost:4000').rstrip('/')
INTERNAL_TOKEN = os.getenv('INTERNAL_API_TOKEN', 'dev-internal-token')
VERIFY_SESSION = os.getenv('VERIFY_SESSION', 'off').strip().lower() == 'on'

store = SQLiteStore(DB_PATH)
llm = create_llm()

_llm_cache: dict[tuple[str, str, str], LlmClient] = {}


def mock_mode() -> str:
    return os.getenv('LLM_MOCK', 'auto').strip().lower()


async def resolve_llm(app_id: str) -> LlmClient:
    """按应用解析 LLM（优先级：平台模型配置 → 环境变量 → Mock）。

    - LLM_MOCK=on  : 始终 Mock
    - LLM_MOCK=off : 始终真实模型，无可用配置时报错（不回退 Mock）
    - LLM_MOCK=auto: 优先真实模型（平台配置/环境变量），都没有才 Mock
    """
    flag = mock_mode()
    if flag == 'on':
        return llm

    # 1) 平台「智能能力/模型配置」：应用绑定的 profile → 平台激活的 chat profile
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            resp = await client.get(
                f'{PLATFORM_API_URL}/api/apps/{app_id}/llm-config',
                headers={'x-internal-token': INTERNAL_TOKEN},
            )
        if resp.status_code == 200:
            profile = (resp.json() or {}).get('profile')
            if profile and profile.get('apiBase') and profile.get('model'):
                cache_key = (profile['apiBase'], profile.get('apiKey') or '', profile['model'])
                client_obj = _llm_cache.get(cache_key)
                if client_obj is None:
                    client_obj = OpenAiCompatClient(cache_key[0], cache_key[1] or 'empty-key', cache_key[2])
                    _llm_cache[cache_key] = client_obj
                    print(f"[agent] llm via profile '{profile.get('name')}' ({cache_key[2]}) for app {app_id[:20]}")
                return client_obj
    except Exception as exc:  # noqa: BLE001
        print(f'[agent] resolve llm-config failed for {app_id}: {exc}')

    # 2) 环境变量兜底（create_llm 已在 env 齐全时产出 real client）
    if llm.mode == 'real':
        return llm

    # 3) Mock（off 模式禁止回退）
    if flag == 'off':
        raise RuntimeError(
            '未找到可用的真实模型配置（平台「智能能力/模型配置」与环境变量 LLM_BASE_URL/LLM_API_KEY/LLM_MODEL 均未生效），'
            '且 LLM_MOCK=off 禁止回退 Mock'
        )
    return llm


async def fetch_current_spec(app_id: str) -> dict[str, Any]:
    """从平台 API 拉取应用当前草稿 AppSpec；失败时返回空骨架（保证演示不中断）。"""
    if not app_id or app_id == 'unknown-app':
        return empty_spec(app_id)
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            resp = await client.get(
                f'{PLATFORM_API_URL}/api/apps/{app_id}/spec',
                headers={'x-internal-token': INTERNAL_TOKEN},
            )
            if resp.status_code == 200:
                spec = resp.json()
                spec.pop('_meta', None)
                return spec
    except Exception as exc:  # noqa: BLE001
        print(f'[agent] fetch spec failed for {app_id}: {exc}')
    return empty_spec(app_id)


tool_executor = AppToolExecutor(PLATFORM_API_URL, INTERNAL_TOKEN, store, fetch_current_spec)
server = AirChatKitServer(store, llm, fetch_current_spec, tool_executor=tool_executor, llm_resolver=resolve_llm)


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[agent] LLM mode = {llm.mode} (model={llm.model})")
    yield


app = FastAPI(
    title='Ai智能企业应用平台 Agent Server',
    version='0.1.0',
    lifespan=lifespan,
    openapi_url='/agent/openapi.json',
    docs_url='/agent/docs',
)


# ---------- 鉴权 ----------
async def require_session(request: Request) -> dict[str, Any]:
    token = request.cookies.get('air_session')
    if not token:
        raise HTTPException(status_code=401, detail='Missing session cookie')
    user_id: str | None = None
    if VERIFY_SESSION:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(
                    f'{PLATFORM_API_URL}/api/auth/me', cookies={'air_session': token}
                )
            if resp.status_code != 200:
                raise HTTPException(status_code=401, detail='Invalid session cookie')
            user_id = resp.json()['user']['id']
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=401, detail='Session verification failed') from exc
    return {'user_id': user_id}


# ---------- ChatKit 协议单端点 ----------
@app.post('/agent/chatkit')
async def chatkit_endpoint(request: Request, session: dict = Depends(require_session)):
    body = await request.body()
    app_id = request.headers.get('x-air-app-id', 'unknown-app')
    context = RequestContext(app_id=app_id, user_id=session.get('user_id'))
    result = await server.process(body, context)
    if isinstance(result, StreamingResult):
        return StreamingResponse(
            result,
            media_type='text/event-stream',
            headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
        )
    return Response(content=result.json, media_type='application/json')


# ---------- threads 扩展 ----------
@app.get('/agent/chatkit/threads/search')
async def threads_search(q: str = '', limit: int = 50, session: dict = Depends(require_session)):
    return {'data': store.search_threads(q, limit)}


@app.patch('/agent/chatkit/threads/{thread_id}/pinned')
async def thread_pinned(thread_id: str, payload: dict[str, Any], session: dict = Depends(require_session)):
    if not store.set_pinned(thread_id, bool(payload.get('pinned'))):
        raise HTTPException(status_code=404, detail='Thread not found')
    return {'ok': True}


@app.patch('/agent/chatkit/threads/{thread_id}/visibility')
async def thread_visibility(thread_id: str, payload: dict[str, Any], session: dict = Depends(require_session)):
    visibility = payload.get('visibility')
    if visibility not in ('private', 'team'):
        raise HTTPException(status_code=400, detail='visibility must be private|team')
    if not store.set_visibility(thread_id, visibility):
        raise HTTPException(status_code=404, detail='Thread not found')
    return {'ok': True}


# ---------- SpecPatch 提案 ----------
@app.get('/agent/chatkit/threads/{thread_id}/items')
async def thread_items(thread_id: str, limit: int = 500, session: dict = Depends(require_session)):
    """会话消息记录（只读浏览用），按时间正序。"""
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail='Thread not found')
    return {'thread': thread, 'items': store.get_thread_items(thread_id, limit)}


@app.get('/agent/chatkit/threads/{thread_id}/proposal')
async def thread_proposal(thread_id: str, session: dict = Depends(require_session)):
    proposal = store.get_proposal(thread_id)
    if proposal is None:
        raise HTTPException(status_code=404, detail='No proposal for this thread')
    return proposal


@app.post('/agent/chatkit/apply')
async def apply_proposal(payload: dict[str, Any], session: dict = Depends(require_session)):
    app_id = payload.get('app_id')
    thread_id = payload.get('thread_id')
    if not app_id or not thread_id:
        raise HTTPException(status_code=400, detail='app_id and thread_id are required')

    proposal = store.get_proposal(thread_id)
    if proposal is None:
        raise HTTPException(status_code=404, detail='No proposal for this thread')
    if proposal['status'] == 'applied':
        return {'status': 'applied', 'result': proposal['result']}
    if proposal['errors']:
        return JSONResponse(
            status_code=422,
            content={'error': 'proposal has validation errors', 'errors': proposal['errors']},
        )
    if proposal['appId'] != app_id:
        raise HTTPException(status_code=403, detail='Proposal does not belong to this app')

    current_spec = await fetch_current_spec(app_id)
    new_spec, errors = apply_patch(current_spec, proposal['proposal'])
    if errors:
        return JSONResponse(status_code=422, content={'error': 'patch failed to apply', 'errors': errors})

    # 提交说明带 summary 与 thread id，供平台 git 版本历史按会话回滚（apps/api 会剔除 message 不落 spec）
    patch_body = proposal.get('proposal') or {}
    summary = str(patch_body.get('summary') or patch_body.get('title') or 'spec patch')[:80]
    spec_payload = dict(new_spec)
    spec_payload['message'] = f'[agent] {summary} [thread:{thread_id}]'[:160]

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.put(
                f'{PLATFORM_API_URL}/api/apps/{app_id}/spec',
                params={'source': 'agent_patch'},
                headers={'x-internal-token': INTERNAL_TOKEN, 'Content-Type': 'application/json'},
                content=json.dumps(spec_payload, ensure_ascii=False),
            )
        if resp.status_code != 201:
            return JSONResponse(
                status_code=502,
                content={'error': f'platform API returned {resp.status_code}', 'detail': resp.text[:500]},
            )
        result = resp.json()
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=502, content={'error': f'platform API unreachable: {exc}'})

    store.mark_proposal_applied(thread_id, result)
    return {'status': 'applied', 'result': result}


# ---------- 后台 Run 族（MVP：同步完成的状态机桩） ----------
@app.post('/agent/chatkit/runs', status_code=202)
async def create_run(payload: dict[str, Any], session: dict = Depends(require_session)):
    run_id = f'run_{uuid.uuid4().hex[:12]}'
    run = store.create_run(run_id, payload.get('thread_id'), payload.get('app_id'), {'input': payload.get('input', '')})
    return run


@app.get('/agent/chatkit/runs/{run_id}/snapshot')
async def run_snapshot(run_id: str, session: dict = Depends(require_session)):
    run = store.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail='Run not found')
    return run


@app.get('/agent/chatkit/runs/{run_id}/events')
async def run_events(run_id: str, session: dict = Depends(require_session)):
    if store.get_run(run_id) is None:
        raise HTTPException(status_code=404, detail='Run not found')

    async def gen():
        yield 'data: {"type":"run.completed","runId":"' + run_id + '"}\n\n'

    return StreamingResponse(gen(), media_type='text/event-stream')


@app.post('/agent/chatkit/runs/{run_id}/cancel')
async def run_cancel(run_id: str, session: dict = Depends(require_session)):
    if not store.update_run_status(run_id, 'cancelled'):
        raise HTTPException(status_code=404, detail='Run not found')
    return {'id': run_id, 'status': 'cancelled'}


@app.post('/agent/chatkit/runs/{run_id}/resolve')
async def run_resolve(run_id: str, payload: dict[str, Any], session: dict = Depends(require_session)):
    resolution = payload.get('resolution')
    mapping = {'retry': 'succeeded', 'skip': 'skipped', 'end': 'ended'}
    if resolution not in mapping:
        raise HTTPException(status_code=400, detail='resolution must be retry|skip|end')
    if store.get_run(run_id) is None:
        raise HTTPException(status_code=404, detail='Run not found')
    store.update_run_status(run_id, mapping[resolution])
    return {'id': run_id, 'status': mapping[resolution]}


# ---------- MCP 发现 ----------
@app.post('/agent/internal/mcp/discover')
async def mcp_discover(payload: dict[str, Any], session: dict = Depends(require_session)):
    endpoint = payload.get('endpoint') or payload.get('endpointUrl') or ''
    headers = payload.get('headers') or {}
    if not endpoint.startswith(('http://', 'https://')):
        return {'ok': False, 'message': '端点必须是 http(s) URL', 'tools': []}
    init_body = {
        'jsonrpc': '2.0',
        'id': 1,
        'method': 'initialize',
        'params': {
            'protocolVersion': '2025-03-26',
            'capabilities': {},
            'clientInfo': {'name': 'air-agent-server', 'version': '0.1.0'},
        },
    }
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            resp = await client.post(endpoint, json=init_body, headers=headers)
        if resp.status_code < 400:
            info = resp.json().get('result', {})
            return {'ok': True, 'message': f"已连接 · {info.get('serverInfo', {}).get('name', 'MCP server')}", 'tools': _list_mcp_tools(endpoint, headers), 'serverInfo': info}
        return {'ok': False, 'message': f'端点返回 HTTP {resp.status_code}', 'tools': []}
    except Exception as exc:  # noqa: BLE001
        return {'ok': False, 'message': str(exc)[:300], 'tools': []}


def _list_mcp_tools(endpoint: str, headers: dict[str, str]) -> list[dict[str, Any]]:
    """tools/list 探测（尽力而为；失败返回空列表不阻断连接测试）。"""
    body = {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}}
    try:
        with httpx.Client(timeout=6) as client:
            resp = client.post(endpoint, json=body, headers=headers)
            result = resp.json().get('result', {})
            return result.get('tools', [])
    except Exception:  # noqa: BLE001
        return []


# ---------- 健康检查 ----------
@app.get('/agent/health')
async def health():
    return {
        'ok': True,
        'service': 'agent-server',
        'llm': {'mode': llm.mode, 'model': llm.model},
    }


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(app, host='0.0.0.0', port=int(os.getenv('PORT', '8100')))
