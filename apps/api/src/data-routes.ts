/**
 * 应用数据 REST 路由：/api/apps/:appId/data/*
 * 供应用壳 / Builder / agent-server 工具（x-internal-token）调用。
 */
import { Router } from 'express';
import type { Request } from 'express';
import { db } from './db.js';
import { RuntimeRequestError, ah } from './errors.js';
import { requireSession } from './auth.js';
import type { SpecModel } from './dbtypes.js';
import { loadAppSpec, resolveBackend } from './appdata.js';
import { runWorkflowsForEvent } from './workflows.js';

export const appDataRouter = Router({ mergeParams: true });
appDataRouter.use(requireSession);

interface LooseRequest {
  params: { [key: string]: string | undefined };
  sessionCtx?: { tenantId: string; role: string };
}

// 角色权限默认映射（spec.policy.roleDefinitions 未定义该角色时生效）
const DEFAULT_DATA_PERMS: Record<string, string[]> = {
  owner: ['data:read', 'data:write', 'data:delete'],
  admin: ['data:read', 'data:write', 'data:delete'],
  member: ['data:read', 'data:write'],
  viewer: ['data:read'],
  system: ['data:read', 'data:write', 'data:delete'],
};

/** 数据权限拦截：按请求者平台角色查应用 roleDefinitions，未定义回退默认映射；internal token 放行。 */
function requireDataPerm(req: LooseRequest, perm: string) {
  const role = req.sessionCtx?.role ?? '';
  if (role === 'system') return;
  const spec = loadAppSpec(req.params.appId!);
  const policy = spec.policy as { roleDefinitions?: Array<{ role?: string; permissions?: string[] }> } | undefined;
  const defs = Array.isArray(policy?.roleDefinitions) ? policy!.roleDefinitions! : [];
  const perms = defs.find((d) => d && d.role === role)?.permissions ?? DEFAULT_DATA_PERMS[role] ?? [];
  if (!perms.includes(perm)) throw RuntimeRequestError.forbidden(`当前角色无 ${perm} 权限`);
}

function requireApp(req: LooseRequest) {
  const tenantId = req.sessionCtx?.tenantId ?? '';
  const role = req.sessionCtx?.role ?? '';
  const app = db
    .prepare('SELECT id FROM apps WHERE id = ? AND tenant_id = ?')
    .get(req.params.appId, tenantId) as { id: string } | undefined;
  const found =
    app ??
    (role === 'system'
      ? (db.prepare('SELECT id FROM apps WHERE id = ?').get(req.params.appId) as { id: string } | undefined)
      : undefined);
  if (!found) throw RuntimeRequestError.notFound('应用不存在');
}

function getModelOr404(req: LooseRequest): SpecModel {
  const spec = loadAppSpec(req.params.appId!);
  const model = (spec.models ?? []).find((m) => m.id === req.params.modelId);
  if (!model) throw RuntimeRequestError.notFound(`模型不存在: ${req.params.modelId}`);
  return model;
}

// ---------- 绑定概览 + 各模型记录数 ----------
appDataRouter.get(
  '/',
  ah(async (req, res) => {
    requireApp(req);
    requireDataPerm(req, 'data:read');
    const binding = db.prepare('SELECT * FROM app_data_bindings WHERE app_id = ?').get(req.params.appId) as
      | { mode: string; db_server_id: string | null; database_name: string | null; updated_at: string }
      | undefined;
    const spec = loadAppSpec(req.params.appId);
    const backend = await resolveBackend(req.params.appId);
    try {
      const counts = await backend.countAll();
      res.json({
        binding: binding
          ? {
              mode: binding.mode,
              dbServerId: binding.db_server_id,
              databaseName: binding.database_name,
              updatedAt: binding.updated_at,
            }
          : { mode: 'sqlite', dbServerId: null, databaseName: null, updatedAt: null },
        models: (spec.models ?? []).map((m) => ({
          id: m.id,
          name: m.name,
          fields: m.fields ?? [],
          recordCount: counts[m.id] ?? 0,
        })),
      });
    } finally {
      await backend.dispose();
    }
  }),
);

// ---------- 记录列表 ----------
appDataRouter.get(
  '/:modelId',
  ah(async (req, res) => {
    requireApp(req);
    requireDataPerm(req, 'data:read');
    const model = getModelOr404(req);
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    const offset = Number(req.query.offset ?? 0) || 0;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const backend = await resolveBackend(req.params.appId);
    try {
      await backend.ensureTable(model);
      const { rows, total } = await backend.list(model, { limit, offset, q });
      res.json({
        records: rows.map((r) => {
          const out: Record<string, unknown> = { id: r.id, createdAt: r.created_at, updatedAt: r.updated_at };
          for (const f of model.fields ?? []) if (f.id !== 'id') out[f.id] = r[`c_${f.id}`];
          return out;
        }),
        total,
        limit,
        offset,
      });
    } finally {
      await backend.dispose();
    }
  }),
);

// ---------- 创建记录 ----------
appDataRouter.post(
  '/:modelId',
  ah(async (req, res) => {
    requireApp(req);
    requireDataPerm(req, 'data:write');
    const model = getModelOr404(req);
    const data = (req.body?.data ?? req.body) as Record<string, unknown>;
    if (typeof data !== 'object' || data === null) throw RuntimeRequestError.invalid('请求体需为 { data: {...} }');
    const backend = await resolveBackend(req.params.appId);
    let out: Record<string, unknown>;
    try {
      await backend.ensureTable(model);
      const row = await backend.create(model, data);
      out = { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
      for (const f of model.fields ?? []) if (f.id !== 'id') out[f.id] = row[`c_${f.id}`];
      res.status(201).json(out);
    } finally {
      await backend.dispose();
    }
    // 触发自动化（fire-and-forget，失败内部吞掉）
    void runWorkflowsForEvent(req.params.appId!, { type: 'record_created', modelId: req.params.modelId!, record: out });
  }),
);

// ---------- 单条记录 ----------
appDataRouter.get(
  '/:modelId/:recordId',
  ah(async (req, res) => {
    requireApp(req);
    requireDataPerm(req, 'data:read');
    const model = getModelOr404(req);
    const backend = await resolveBackend(req.params.appId);
    try {
      const row = await backend.get(model, req.params.recordId);
      if (!row) throw RuntimeRequestError.notFound('记录不存在');
      const out: Record<string, unknown> = { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
      for (const f of model.fields ?? []) if (f.id !== 'id') out[f.id] = row[`c_${f.id}`];
      res.json(out);
    } finally {
      await backend.dispose();
    }
  }),
);

appDataRouter.put(
  '/:modelId/:recordId',
  ah(async (req, res) => {
    requireApp(req);
    requireDataPerm(req, 'data:write');
    const model = getModelOr404(req);
    const data = (req.body?.data ?? req.body) as Record<string, unknown>;
    const backend = await resolveBackend(req.params.appId);
    let out: Record<string, unknown>;
    try {
      await backend.ensureTable(model);
      const row = await backend.update(model, req.params.recordId, data);
      out = { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
      for (const f of model.fields ?? []) if (f.id !== 'id') out[f.id] = row[`c_${f.id}`];
      res.json(out);
    } catch (e) {
      if ((e as Error).message === '记录不存在') throw RuntimeRequestError.notFound('记录不存在');
      throw e;
    } finally {
      await backend.dispose();
    }
    // 触发自动化（fire-and-forget，失败内部吞掉）
    void runWorkflowsForEvent(req.params.appId!, { type: 'record_updated', modelId: req.params.modelId!, record: out });
  }),
);

appDataRouter.delete(
  '/:modelId/:recordId',
  ah(async (req, res) => {
    requireApp(req);
    requireDataPerm(req, 'data:delete');
    const model = getModelOr404(req);
    const backend = await resolveBackend(req.params.appId);
    try {
      await backend.remove(model, req.params.recordId);
      res.status(204).send();
    } catch (e) {
      if ((e as Error).message === '记录不存在') throw RuntimeRequestError.notFound('记录不存在');
      throw e;
    } finally {
      await backend.dispose();
    }
  }),
);
