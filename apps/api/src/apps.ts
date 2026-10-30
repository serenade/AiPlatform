import { Router } from 'express';
import type { Request } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { db } from './db.js';
import { RuntimeRequestError, ah } from './errors.js';
import { newId } from './ids.js';
import { requireSession } from './auth.js';
import { appDataRouter } from './data-routes.js';
import { syncAppSeeds, backupAppDb, buildSchemaSql, loadAppSpec } from './appdata.js';
import { commitSpec, listRevisions, readRevision, findSessionBase, RevisionError } from './revisions.js';
import { integrationsRouter } from './integrations.js';
import { workflowsRouter } from './workflows.js';

export const appsRouter = Router();
appsRouter.use(requireSession);
// 应用数据（需求2）：/api/apps/:appId/data/*
appsRouter.use('/:appId/data', appDataRouter);
// 集成 / 自动化（Builder 五模块）：配置存 spec，此处为测试与运行路由
appsRouter.use('/:appId/integrations', integrationsRouter);
appsRouter.use('/:appId/workflows', workflowsRouter);

// ---------- AppSpec ----------
export function emptySpec(appId: string, name: string, description: string | null, tenantId: string, userId: string) {
  const now = new Date().toISOString();
  return {
    specVersion: '0.3',
    app: {
      id: appId,
      name,
      description: description ?? '',
      metadata: { tenantId, createdBy: userId, createdAt: now, updatedAt: now },
    },
    models: [],
    seeds: [],
    pages: [],
    actions: [],
    policy: { roleDefinitions: [], attributeDefinitions: [], rules: [], publicAccess: { allowPublicSignup: false } },
    identityProfiles: [],
    integrations: [],
    workflows: [],
    sharedResources: [],
    sharedBindings: [],
    navigation: { items: [] },
    shell: { mode: 'workspace' },
    runtimeCapabilities: { ai: true, speech: false, documents: false },
  };
}

function nextVersion(appId: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM spec_versions WHERE app_id = ?')
    .get(appId) as { v: number };
  return row.v + 1;
}

function insertSpecVersion(appId: string, spec: unknown, userId: string, source: string) {
  const id = newId('specver');
  const version = nextVersion(appId);
  db.prepare(
    'INSERT INTO spec_versions (id, app_id, version, spec_json, created_by, created_at, source) VALUES (?,?,?,?,?,?,?)',
  ).run(id, appId, version, JSON.stringify(spec), userId, new Date().toISOString(), source);
  return { id, version };
}

// ---------- DTO ----------
function toAppDto(row: Record<string, unknown>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    iconAssetId: row.icon_asset_id,
    status: row.status,
    currentDraftSpecVersionId: row.current_draft_spec_version_id,
    currentPublishedVersionId: row.current_published_spec_version_id,
    aiProfileId: row.ai_profile_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getAppOr404(req: Request) {
  const row = db
    .prepare('SELECT * FROM apps WHERE id = ? AND tenant_id = ?')
    .get(req.params.appId, req.sessionCtx!.tenantId) as Record<string, unknown> | undefined;
  // internal 调用无 tenant 约束
  const rowAny =
    row ??
    (req.sessionCtx!.role === 'system'
      ? (db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.appId) as Record<string, unknown> | undefined)
      : undefined);
  if (!rowAny) throw RuntimeRequestError.notFound('应用不存在');
  return rowAny;
}

// ---------- 路由 ----------
const createSchema = z.object({
  name: z.string().trim().min(1, '应用名称不能为空').max(60),
  description: z.string().trim().max(500).optional().nullable(),
});

appsRouter.get(
  '/',
  ah(async (req, res) => {
    const rows = db
      .prepare('SELECT * FROM apps WHERE tenant_id = ? ORDER BY updated_at DESC')
      .all(req.sessionCtx!.tenantId) as Record<string, unknown>[];
    res.json(rows.map(toAppDto));
  }),
);

appsRouter.post(
  '/',
  ah(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw RuntimeRequestError.invalid(parsed.error.issues[0]?.message ?? '参数不合法');
    const { name, description } = parsed.data;
    const ctx = req.sessionCtx!;
    const now = new Date().toISOString();
    const appId = newId('app');

    const spec = emptySpec(appId, name, description ?? null, ctx.tenantId, ctx.userId);

    db.prepare(
      `INSERT INTO apps (id, tenant_id, name, description, icon_asset_id, status,
        current_draft_spec_version_id, current_published_spec_version_id, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,'draft',NULL,NULL,?,?,?)`,
    ).run(appId, ctx.tenantId, name, description ?? null, null, ctx.userId, now, now);

    const sv = insertSpecVersion(appId, spec, ctx.userId, 'manual');
    db.prepare('UPDATE apps SET current_draft_spec_version_id = ? WHERE id = ?').run(sv.id, appId);

    // git 版本基线（失败不阻断创建）
    try {
      await commitSpec(appId, spec, 'baseline');
    } catch (err) {
      console.error('[api] git baseline commit failed:', err);
    }

    res.status(201).json(toAppDto(db.prepare('SELECT * FROM apps WHERE id = ?').get(appId) as Record<string, unknown>));
  }),
);

// ---------- 应用共享用户接口（需求1）：应用运行时可直接接入平台用户/团队 ----------
appsRouter.get(
  '/:appId/users',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    const members = db
      .prepare(
        `SELECT u.id, u.email, u.display_name AS displayName, u.avatar_url AS avatarUrl, m.role, m.status
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.tenant_id = ? AND m.status = 'active'
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 WHEN 'viewer' THEN 3 ELSE 4 END`,
      )
      .all(row.tenant_id);
    res.json({ tenantId: row.tenant_id, users: members });
  }),
);

// ---------- 应用 LLM 配置解析（供 agent-server internal 调用）：应用绑定 → 平台激活 profile ----------
interface AiProfileCfgRow {
  id: string;
  name: string;
  model: string;
  api_base: string | null;
  api_key: string | null;
}

appsRouter.get(
  '/:appId/llm-config',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    let profile: AiProfileCfgRow | undefined;
    if (row.ai_profile_id) {
      // 应用级绑定优先（不要求该 profile 是平台默认）
      profile = db
        .prepare('SELECT id, name, model, api_base, api_key FROM ai_profiles WHERE id = ?')
        .get(row.ai_profile_id) as AiProfileCfgRow | undefined;
    }
    if (!profile) {
      // 平台默认（「智能能力/模型配置」中启用的 chat profile）
      profile = db
        .prepare(
          "SELECT id, name, model, api_base, api_key FROM ai_profiles WHERE purpose = 'chat' AND enabled = 1 ORDER BY updated_at DESC LIMIT 1",
        )
        .get() as AiProfileCfgRow | undefined;
    }
    if (!profile || !profile.api_base || !profile.model) {
      res.json({ source: 'none', profile: null });
      return;
    }
    res.json({
      source: 'profile',
      profile: {
        id: profile.id,
        name: profile.name,
        model: profile.model,
        apiBase: profile.api_base,
        apiKey: profile.api_key ?? '',
      },
    });
  }),
);

appsRouter.get(
  '/:appId',
  ah(async (req, res) => {
    res.json(toAppDto(getAppOr404(req)));
  }),
);

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  status: z.enum(['draft', 'active']).optional(),
  aiProfileId: z.string().nullable().optional(),
});

appsRouter.patch(
  '/:appId',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) throw RuntimeRequestError.invalid('参数不合法');
    const { name, description, status, aiProfileId } = parsed.data;
    if (aiProfileId) {
      const p = db.prepare('SELECT id FROM ai_profiles WHERE id = ?').get(aiProfileId);
      if (!p) throw RuntimeRequestError.invalid('模型配置不存在');
    }

    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [new Date().toISOString()];
    if (name !== undefined) { sets.push('name = ?'); vals.push(name); }
    if (description !== undefined) { sets.push('description = ?'); vals.push(description); }
    if (status !== undefined) { sets.push('status = ?'); vals.push(status); }
    if (aiProfileId !== undefined) { sets.push('ai_profile_id = ?'); vals.push(aiProfileId); }
    vals.push(row.id);
    db.prepare(`UPDATE apps SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json(toAppDto(db.prepare('SELECT * FROM apps WHERE id = ?').get(row.id) as Record<string, unknown>));
  }),
);

appsRouter.delete(
  '/:appId',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    db.prepare('DELETE FROM spec_versions WHERE app_id = ?').run(row.id as string);
    db.prepare('DELETE FROM apps WHERE id = ?').run(row.id as string);
    res.status(204).send();
  }),
);

// ---------- Spec 版本 ----------
appsRouter.get(
  '/:appId/spec',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    const versionParam = req.query.version ? Number(req.query.version) : null;
    let sv: Record<string, unknown> | undefined;
    if (versionParam) {
      sv = db
        .prepare('SELECT * FROM spec_versions WHERE app_id = ? AND version = ?')
        .get(row.id, versionParam) as Record<string, unknown> | undefined;
    } else {
      sv = db
        .prepare('SELECT * FROM spec_versions WHERE id = ?')
        .get(row.current_draft_spec_version_id) as Record<string, unknown> | undefined;
    }
    if (!sv) throw RuntimeRequestError.notFound('Spec 版本不存在');
    const spec = JSON.parse(sv.spec_json as string);
    res.json({
      ...spec,
      _meta: {
        specVersionId: sv.id,
        version: sv.version,
        source: sv.source,
        createdBy: sv.created_by,
        createdAt: sv.created_at,
        status: row.status,
      },
    });
  }),
);

const putSpecSchema = z
  .object({ specVersion: z.string().min(1), message: z.string().trim().max(200).optional() })
  .passthrough();

appsRouter.put(
  '/:appId/spec',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    if (!putSpecSchema.safeParse(req.body).success) {
      throw RuntimeRequestError.invalid('spec 缺少 specVersion 字段');
    }
    // message 仅用于 git 提交说明，必须先剔除避免污染 spec_json
    const { message, ...spec } = req.body as Record<string, unknown> & { message?: string };
    const userId = req.sessionCtx!.sessionId === 'internal' ? 'agent' : req.sessionCtx!.userId;
    const source = req.query.source === 'agent_patch' ? 'agent_patch' : 'manual';
    const sv = insertSpecVersion(row.id as string, spec, userId, source);
    db.prepare('UPDATE apps SET current_draft_spec_version_id = ?, updated_at = ? WHERE id = ?').run(
      sv.id,
      new Date().toISOString(),
      row.id,
    );
    // spec 变更后同步 seeds 示例数据到应用数据表（失败不阻断保存）
    try {
      await syncAppSeeds(row.id as string);
    } catch (err) {
      console.error('[api] sync app seeds failed:', err);
    }
    // git 版本提交（失败不阻断保存）
    try {
      const msg =
        message ??
        (source === 'agent_patch' ? '[agent] spec patch' : `[manual] save v${sv.version}`);
      await commitSpec(row.id as string, spec, msg);
    } catch (err) {
      console.error('[api] git commit failed:', err);
    }
    res.status(201).json({ specVersionId: sv.id, version: sv.version, source });
  }),
);

appsRouter.get(
  '/:appId/spec-versions',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    const rows = db
      .prepare(
        'SELECT id, version, source, created_by AS createdBy, created_at AS createdAt FROM spec_versions WHERE app_id = ? ORDER BY version DESC',
      )
      .all(row.id);
    res.json(rows);
  }),
);

appsRouter.post(
  '/:appId/publish',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    if (!row.current_draft_spec_version_id) throw RuntimeRequestError.invalid('当前没有可发布的草稿版本');
    db.prepare(
      "UPDATE apps SET current_published_spec_version_id = ?, status = 'active', updated_at = ? WHERE id = ?",
    ).run(row.current_draft_spec_version_id, new Date().toISOString(), row.id);
    res.json({
      publishedSpecVersionId: row.current_draft_spec_version_id,
      status: 'active',
      publishedAt: new Date().toISOString(),
    });
  }),
);

// ---------- 版本控制（git，会话回滚） ----------
appsRouter.get(
  '/:appId/revisions',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    try {
      res.json({ revisions: await listRevisions(row.id as string) });
    } catch (err) {
      if (err instanceof RevisionError) throw RuntimeRequestError.invalid(err.message);
      throw err;
    }
  }),
);

appsRouter.post(
  '/:appId/revisions/:hash/restore',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    const userId = req.sessionCtx!.sessionId === 'internal' ? 'agent' : req.sessionCtx!.userId;
    let content;
    try {
      content = await readRevision(row.id as string, req.params.hash);
    } catch (err) {
      if (err instanceof RevisionError) throw RuntimeRequestError.notFound(err.message);
      throw err;
    }
    const sv = insertSpecVersion(row.id as string, content.spec, userId, 'restore');
    db.prepare('UPDATE apps SET current_draft_spec_version_id = ?, updated_at = ? WHERE id = ?').run(
      sv.id,
      new Date().toISOString(),
      row.id,
    );
    try {
      await syncAppSeeds(row.id as string);
    } catch (err) {
      console.error('[api] restore sync seeds failed:', err);
    }
    try {
      await commitSpec(row.id as string, content.spec, `[restore] rollback to ${req.params.hash.slice(0, 8)}`);
    } catch (err) {
      console.error('[api] restore git commit failed:', err);
    }
    res.json({ specVersionId: sv.id, version: sv.version, restoredFrom: req.params.hash });
  }),
);

appsRouter.post(
  '/:appId/sessions/:threadId/undo',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    const userId = req.sessionCtx!.sessionId === 'internal' ? 'agent' : req.sessionCtx!.userId;
    let base;
    try {
      base = await findSessionBase(row.id as string, req.params.threadId);
    } catch (err) {
      if (err instanceof RevisionError && err.message === 'THREAD_NO_COMMITS') {
        throw RuntimeRequestError.notFound('该会话没有可撤销的变更');
      }
      if (err instanceof RevisionError) throw RuntimeRequestError.invalid(err.message);
      throw err;
    }
    const sv = insertSpecVersion(row.id as string, base.spec, userId, 'restore');
    db.prepare('UPDATE apps SET current_draft_spec_version_id = ?, updated_at = ? WHERE id = ?').run(
      sv.id,
      new Date().toISOString(),
      row.id,
    );
    try {
      await syncAppSeeds(row.id as string);
    } catch (err) {
      console.error('[api] undo sync seeds failed:', err);
    }
    try {
      await commitSpec(
        row.id as string,
        base.spec,
        `[undo-session] revert ${req.params.threadId.slice(0, 12)} -> ${base.message.slice(0, 8)}`,
      );
    } catch (err) {
      console.error('[api] undo git commit failed:', err);
    }
    res.json({ specVersionId: sv.id, version: sv.version, restoredFrom: base.message });
  }),
);

appsRouter.get(
  '/:appId/revisions/:hash/export',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    let content;
    try {
      content = await readRevision(row.id as string, req.params.hash);
    } catch (err) {
      if (err instanceof RevisionError) throw RuntimeRequestError.notFound(err.message);
      throw err;
    }
    const payload = {
      appId: row.id,
      hash: req.params.hash,
      committedAt: content.committedAt,
      message: content.message,
      spec: content.spec,
      dbSchema: content.schemaSql,
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="revision-${req.params.hash.slice(0, 8)}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  }),
);

appsRouter.get(
  '/:appId/db/backup',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    let file: string;
    try {
      file = await backupAppDb(row.id as string);
    } catch (err) {
      if ((err as Error).message === 'EXTERNAL_DB') {
        throw RuntimeRequestError.invalid('应用绑定外部数据库，请使用数据库服务器自身的备份工具');
      }
      throw err;
    }
    res.download(file, `${row.id}-backup.db`, () => {
      fs.rmSync(file, { force: true });
    });
  }),
);

// DDL 预览（sqlite 方言目标态快照，与 git 提交物一致）
appsRouter.get(
  '/:appId/db/schema',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    res.json({ dialect: 'sqlite', schemaSql: buildSchemaSql(loadAppSpec(row.id as string)) });
  }),
);

// ---------- 发布中心：下架 ----------
appsRouter.post(
  '/:appId/unpublish',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    db.prepare(
      "UPDATE apps SET status = 'draft', current_published_spec_version_id = NULL, updated_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), row.id);
    res.json({ status: 'draft', unpublishedAt: new Date().toISOString() });
  }),
);

// ---------- 发布中心：恢复 draft 到历史版本 ----------
appsRouter.post(
  '/:appId/spec-versions/:version/restore',
  ah(async (req, res) => {
    const row = getAppOr404(req);
    const version = Number(req.params.version);
    if (!Number.isInteger(version) || version < 1) throw RuntimeRequestError.invalid('非法的版本号');
    const target = db
      .prepare('SELECT id, spec_json, version FROM spec_versions WHERE app_id = ? AND version = ?')
      .get(row.id, version) as { id: string; spec_json: string; version: number } | undefined;
    if (!target) throw RuntimeRequestError.notFound(`版本不存在: v${version}`);
    const userId = req.sessionCtx!.sessionId === 'internal' ? 'agent' : req.sessionCtx!.userId;
    const sv = insertSpecVersion(row.id as string, JSON.parse(target.spec_json), userId, 'restore');
    db.prepare('UPDATE apps SET current_draft_spec_version_id = ?, updated_at = ? WHERE id = ?').run(
      sv.id,
      new Date().toISOString(),
      row.id,
    );
    try {
      await syncAppSeeds(row.id as string);
    } catch (err) {
      console.error('[api] restore-version sync seeds failed:', err);
    }
    try {
      await commitSpec(row.id as string, JSON.parse(target.spec_json), `[restore] rollback to v${target.version}`);
    } catch (err) {
      console.error('[api] restore-version git commit failed:', err);
    }
    res.json({ specVersionId: sv.id, version: sv.version, restoredFrom: target.version });
  }),
);

// ---------- 桩数据（对齐原版路径） ----------
appsRouter.get('/:appId/workspace', ah(async (req, res) => {
  getAppOr404(req);
  res.json({
    id: 'ws_default',
    name: '默认工作区',
    environments: [
      { id: 'env_dev', key: 'development', name: '开发' },
      { id: 'env_prod', key: 'production', name: '生产' },
    ],
  });
}));

appsRouter.get('/:appId/environments', ah(async (req, res) => {
  getAppOr404(req);
  res.json([
    { id: 'env_dev', key: 'development', name: '开发', status: 'ready', current: true },
    { id: 'env_prod', key: 'production', name: '生产', status: 'ready', current: false },
  ]);
}));
