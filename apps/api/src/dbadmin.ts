import { Router } from 'express';
import type { NextFunction, Request } from 'express';
import mysql from 'mysql2/promise';
import pg from 'pg';
import { z } from 'zod';
import { db } from './db.js';
import { RuntimeRequestError, ah } from './errors.js';
import { newId } from './ids.js';
import { requireSession } from './auth.js';
import type { DbServerRow } from './dbtypes.js';

export { testServerConnection, ensureDatabase } from './dbops.js';

export const dbAdminRouter = Router();
dbAdminRouter.use(requireSession);

const MANAGER_ROLES = new Set(['owner', 'admin']);

function requireAdmin(req: Request, _res: unknown, next: NextFunction) {
  const ctx = req.sessionCtx!;
  if (ctx.role === 'system') return next();
  if (!MANAGER_ROLES.has(ctx.role)) return next(RuntimeRequestError.forbidden('仅所有者/管理员可管理数据库服务器'));
  next();
}

function toDto(r: DbServerRow, redact = true) {
  return {
    id: r.id,
    name: r.name,
    dbType: r.db_type,
    host: r.host,
    port: r.port,
    username: r.username,
    ssl: r.ssl === 1,
    status: r.status,
    lastTestAt: r.last_test_at,
    lastTestMessage: r.last_test_message,
    createdAt: r.created_at,
    ...(redact ? {} : { password: r.password }),
  };
}

function getServerOr404(tenantId: string, id: string): DbServerRow {
  const row = db
    .prepare('SELECT * FROM db_servers WHERE id = ? AND tenant_id = ?')
    .get(id, tenantId) as DbServerRow | undefined;
  if (!row) throw RuntimeRequestError.notFound('数据库服务器不存在');
  return row;
}

// ---------- 服务器列表 / 创建 ----------
dbAdminRouter.get(
  '/servers',
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const rows = db
      .prepare('SELECT * FROM db_servers WHERE tenant_id = ? ORDER BY created_at')
      .all(ctx.tenantId) as DbServerRow[];
    // 附带使用该服务器的应用数
    const usage = db
      .prepare('SELECT db_server_id, COUNT(*) AS c FROM app_data_bindings WHERE db_server_id IS NOT NULL GROUP BY db_server_id')
      .all() as { db_server_id: string; c: number }[];
    const usageMap = new Map(usage.map((u) => [u.db_server_id, u.c]));
    res.json({
      servers: rows.map((r) => ({ ...toDto(r), appCount: usageMap.get(r.id) ?? 0 })),
    });
  }),
);

const serverSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  dbType: z.enum(['mysql', 'postgresql']),
  host: z.string().min(1, '主机不能为空'),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().default(''),
  ssl: z.boolean().default(false),
});

dbAdminRouter.post(
  '/servers',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const parsed = serverSchema.safeParse(req.body);
    if (!parsed.success) throw RuntimeRequestError.invalid(parsed.error.issues[0]?.message ?? '参数非法');
    const s = parsed.data;
    const id = newId('dbserver');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO db_servers (id, tenant_id, name, db_type, host, port, username, password, ssl, status, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, ctx.tenantId, s.name, s.dbType, s.host, s.port, s.username, s.password, s.ssl ? 1 : 0, 'unknown', ctx.userId, now);
    res.status(201).json(toDto(getServerOr404(ctx.tenantId, id)));
  }),
);

// ---------- 服务器详情 / 更新 / 删除 ----------
dbAdminRouter.get(
  '/servers/:id',
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    res.json(toDto(getServerOr404(ctx.tenantId, req.params.id)));
  }),
);

dbAdminRouter.patch(
  '/servers/:id',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const row = getServerOr404(ctx.tenantId, req.params.id);
    const parsed = serverSchema.partial().safeParse(req.body);
    if (!parsed.success) throw RuntimeRequestError.invalid(parsed.error.issues[0]?.message ?? '参数非法');
    const s = { ...parsed.data };
    db.prepare(
      `UPDATE db_servers SET name=?, db_type=?, host=?, port=?, username=?,
        password=?, ssl=?, status='unknown', last_test_at=NULL, last_test_message=NULL WHERE id=?`,
    ).run(
      s.name ?? row.name,
      s.dbType ?? row.db_type,
      s.host ?? row.host,
      s.port ?? row.port,
      s.username ?? row.username,
      s.password ?? row.password,
      (s.ssl ?? row.ssl === 1) ? 1 : 0,
      row.id,
    );
    res.json(toDto(getServerOr404(ctx.tenantId, row.id)));
  }),
);

dbAdminRouter.delete(
  '/servers/:id',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const row = getServerOr404(ctx.tenantId, req.params.id);
    const used = db
      .prepare("SELECT COUNT(*) AS c FROM app_data_bindings WHERE db_server_id = ? AND mode = 'external'")
      .get(row.id) as { c: number };
    if (used.c > 0) throw RuntimeRequestError.invalid(`仍有 ${used.c} 个应用绑定在该服务器上，请先解除绑定`);
    db.prepare('DELETE FROM db_servers WHERE id = ?').run(row.id);
    res.status(204).send();
  }),
);

// ---------- 测试连接 ----------
dbAdminRouter.post(
  '/servers/:id/test',
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const row = getServerOr404(ctx.tenantId, req.params.id);
    const { testServerConnection } = await import('./dbops.js');
    const result = await testServerConnection(row);
    const now = new Date().toISOString();
    db.prepare('UPDATE db_servers SET status=?, last_test_at=?, last_test_message=? WHERE id=?').run(
      result.ok ? 'ok' : 'error',
      now,
      result.message,
      row.id,
    );
    res.json({ ok: result.ok, message: result.message, testedAt: now });
  }),
);

// ---------- 应用专属库管理 ----------
dbAdminRouter.get(
  '/servers/:id/databases',
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const row = getServerOr404(ctx.tenantId, req.params.id);
    const { listDatabases } = await import('./dbops.js');
    const names = await listDatabases(row);
    // 标注哪些库已被应用绑定
    const bound = db
      .prepare("SELECT app_id, database_name FROM app_data_bindings WHERE db_server_id = ? AND mode = 'external'")
      .all(row.id) as { app_id: string; database_name: string }[];
    const apps = db.prepare('SELECT id, name FROM apps').all() as { id: string; name: string }[];
    const appMap = new Map(apps.map((a) => [a.id, a.name]));
    res.json({
      databases: names.map((n) => {
        const b = bound.find((x) => x.database_name === n);
        return {
          name: n,
          boundAppId: b?.app_id ?? null,
          boundAppName: b ? (appMap.get(b.app_id) ?? b.app_id) : null,
        };
      }),
    });
  }),
);

const createDbSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, '库名需为字母/下划线开头，仅含字母数字下划线'),
});

dbAdminRouter.post(
  '/servers/:id/databases',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const row = getServerOr404(ctx.tenantId, req.params.id);
    const parsed = createDbSchema.safeParse(req.body);
    if (!parsed.success) throw RuntimeRequestError.invalid(parsed.error.issues[0]?.message ?? '参数非法');
    const { ensureDatabase } = await import('./dbops.js');
    await ensureDatabase(row, parsed.data.name);
    res.status(201).json({ name: parsed.data.name });
  }),
);

// ---------- 应用数据绑定 ----------
function getBinding(appId: string) {
  return db.prepare('SELECT * FROM app_data_bindings WHERE app_id = ?').get(appId) as
    | {
        app_id: string;
        mode: string;
        db_server_id: string | null;
        database_name: string | null;
        updated_at: string;
        updated_by: string | null;
      }
    | undefined;
}

function bindingDto(appId: string, apps: { id: string; name: string }[]) {
  const b = getBinding(appId);
  const app = apps.find((a) => a.id === appId);
  if (!b) {
    return { appId, mode: 'sqlite', dbServerId: null, databaseName: null, updatedAt: null, appName: app?.name ?? null };
  }
  const server = b.db_server_id
    ? (db.prepare('SELECT name, db_type, host, port FROM db_servers WHERE id = ?').get(b.db_server_id) as
        | { name: string; db_type: string; host: string; port: number }
        | undefined)
    : undefined;
  return {
    appId,
    mode: b.mode,
    dbServerId: b.db_server_id,
    dbServerName: server ? `${server.name}（${server.db_type}://${server.host}:${server.port}）` : null,
    databaseName: b.database_name,
    updatedAt: b.updated_at,
    appName: app?.name ?? null,
  };
}

dbAdminRouter.get(
  '/bindings',
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const apps = db.prepare('SELECT id, name FROM apps WHERE tenant_id = ? ORDER BY name').all(ctx.tenantId) as {
      id: string;
      name: string;
    }[];
    res.json({ bindings: apps.map((a) => bindingDto(a.id, apps)) });
  }),
);

const bindSchema = z.object({
  mode: z.enum(['sqlite', 'external']),
  dbServerId: z.string().min(1).optional(),
  databaseName: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).optional(),
});

dbAdminRouter.put(
  '/bindings/:appId',
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    let app = db
      .prepare('SELECT id FROM apps WHERE id = ? AND tenant_id = ?')
      .get(req.params.appId, ctx.tenantId) as { id: string } | undefined;
    if (!app && ctx.role === 'system') {
      app = db.prepare('SELECT id FROM apps WHERE id = ?').get(req.params.appId) as { id: string } | undefined;
    }
    if (!app) throw RuntimeRequestError.notFound('应用不存在');

    const parsed = bindSchema.safeParse(req.body);
    if (!parsed.success) throw RuntimeRequestError.invalid(parsed.error.issues[0]?.message ?? '参数非法');
    const { mode, dbServerId, databaseName } = parsed.data;
    if (mode === 'external') {
      if (!dbServerId) throw RuntimeRequestError.invalid('external 模式必须选择数据库服务器');
      if (!databaseName) throw RuntimeRequestError.invalid('external 模式必须指定数据库名');
      const server = db.prepare('SELECT * FROM db_servers WHERE id = ?').get(dbServerId) as DbServerRow | undefined;
      if (!server) throw RuntimeRequestError.notFound('数据库服务器不存在');

      const existing = getBinding(app.id);
      const isNewDatabase = !existing || existing.mode !== 'external' || existing.database_name !== databaseName;
      if (isNewDatabase) {
        // 创建（或确认）应用专属库并初始化表结构
        const { ensureDatabase } = await import('./dbops.js');
        await ensureDatabase(server, databaseName);
      }
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO app_data_bindings (app_id, mode, db_server_id, database_name, updated_at, updated_by)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(app_id) DO UPDATE SET mode=excluded.mode, db_server_id=excluded.db_server_id,
         database_name=excluded.database_name, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
    ).run(app.id, mode, mode === 'external' ? dbServerId : null, mode === 'external' ? databaseName : null, now, ctx.userId);

    // 绑定后立即按当前 spec 同步表结构
    const { syncAppSchema } = await import('./appdata.js');
    try {
      await syncAppSchema(app.id);
    } catch (e) {
      // 表结构同步失败不阻断绑定（例如外部库暂不可达），但提示
      res.json({ ...bindingDto(app.id, []), warning: `绑定成功，但同步表结构失败: ${(e as Error).message}` });
      return;
    }
    res.json(bindingDto(app.id, []));
  }),
);
