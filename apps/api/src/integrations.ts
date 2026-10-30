/**
 * 应用集成路由：/api/apps/:appId/integrations/*
 * 集成配置本身存在 spec.integrations（由 PUT /spec 保存），本文件提供服务端连通性测试。
 */
import { Router } from 'express';
import type { Request } from 'express';
import { db } from './db.js';
import { RuntimeRequestError, ah } from './errors.js';
import { requireSession } from './auth.js';
import { loadAppSpec } from './appdata.js';
import type { SpecIntegration } from './dbtypes.js';

export const integrationsRouter = Router({ mergeParams: true });
integrationsRouter.use(requireSession);

interface LooseRequest {
  params: { [key: string]: string | undefined };
  sessionCtx?: { tenantId: string; role: string };
}

function requireApp(req: LooseRequest) {
  const tenantId = req.sessionCtx?.tenantId ?? '';
  const role = req.sessionCtx?.role ?? '';
  const app = db.prepare('SELECT id FROM apps WHERE id = ? AND tenant_id = ?').get(req.params.appId, tenantId) as
    | { id: string }
    | undefined;
  const found =
    app ??
    (role === 'system'
      ? (db.prepare('SELECT id FROM apps WHERE id = ?').get(req.params.appId) as { id: string } | undefined)
      : undefined);
  if (!found) throw RuntimeRequestError.notFound('应用不存在');
}

function getIntegrationOr404(req: LooseRequest): SpecIntegration {
  const spec = loadAppSpec(req.params.appId!);
  const list = (Array.isArray(spec.integrations) ? spec.integrations : []) as SpecIntegration[];
  const item = list.find((i) => i && i.id === req.params.id);
  if (!item) throw RuntimeRequestError.notFound(`集成不存在: ${req.params.id}`);
  return item;
}

/** 默认请求方法：webhook→POST、api→GET */
export function integrationMethod(int: SpecIntegration): string {
  return (int.method ?? (int.type === 'webhook' ? 'POST' : 'GET')).toUpperCase();
}

/** 发起集成请求（供本路由测试与 workflows 引擎共用），返回是否收到响应。 */
export async function callIntegration(
  int: SpecIntegration,
  body: unknown,
): Promise<{ ok: boolean; status: number | null; message: string }> {
  let url: URL;
  try {
    url = new URL(int.url);
  } catch {
    return { ok: false, status: null, message: 'URL 无效' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, status: null, message: '仅支持 http/https 地址' };
  }
  const method = integrationMethod(int);
  const hasBody = method !== 'GET' && method !== 'HEAD' && body !== undefined;
  try {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(int.headers ?? {}) },
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    return { ok: res.ok, status: res.status, message: res.ok ? '请求成功' : `响应状态 ${res.status}` };
  } catch (err) {
    return { ok: false, status: null, message: `请求失败: ${(err as Error).message}` };
  }
}

// ---------- 连通性测试 ----------
integrationsRouter.post(
  '/:id/test',
  ah(async (req, res) => {
    requireApp(req);
    const int = getIntegrationOr404(req);
    const started = Date.now();
    const body = int.type === 'webhook' ? { test: true, appId: req.params.appId, sentAt: new Date().toISOString() } : undefined;
    const result = await callIntegration(int, body);
    res.json({ ...result, durationMs: Date.now() - started });
  }),
);
