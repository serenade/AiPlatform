/**
 * 团队设置（需求3）：Skills 管理 / MCP 管理 / 智能能力（模型配置）。
 * MCP「测试并读取工具」通过 internal token 代理到 agent-server 的 MCP discover。
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { RuntimeRequestError, ah } from './errors.js';
import { newId } from './ids.js';
import { requireSession } from './auth.js';

export const teamRouter = Router();
teamRouter.use(requireSession);

const MANAGER_ROLES = new Set(['owner', 'admin']);
const AGENT_URL = process.env.AGENT_SERVER_URL ?? 'http://localhost:8100';
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token';

function requireAdmin(req: { sessionCtx?: { role: string } }, res: unknown, next: (e?: unknown) => void) {
  const ctx = req.sessionCtx!;
  if (ctx.role === 'system') return next();
  if (!MANAGER_ROLES.has(ctx.role)) return next(RuntimeRequestError.forbidden('仅所有者/管理员可修改团队设置'));
  next();
}

const now = () => new Date().toISOString();

// ================= Skills =================
interface SkillRow {
  id: string;
  tenant_id: string;
  name: string;
  title: string;
  description: string | null;
  content: string;
  version: string;
  status: string;
  created_at: string;
  updated_at: string;
}

const skillDto = (r: SkillRow) => ({
  id: r.id,
  name: r.name,
  title: r.title,
  description: r.description,
  content: r.content,
  version: r.version,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

teamRouter.get(
  '/skills',
  ah(async (_req, res) => {
    const ctx = _req.sessionCtx!;
    const rows = db
      .prepare('SELECT * FROM skills WHERE tenant_id = ? ORDER BY created_at')
      .all(ctx.tenantId) as SkillRow[];
    res.json({ skills: rows.map(skillDto) });
  }),
);

const skillSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, '标识需为 kebab-case（小写字母数字与连字符）'),
  title: z.string().min(1, '名称不能为空'),
  description: z.string().optional().default(''),
  content: z.string().default(''),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, '版本需为 x.y.z').default('0.1.0'),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

teamRouter.post(
  '/skills',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const parsed = skillSchema.safeParse(req.body);
    if (!parsed.success) throw RuntimeRequestError.invalid(parsed.error.issues[0]?.message ?? '参数非法');
    const s = parsed.data;
    const dup = db.prepare('SELECT id FROM skills WHERE tenant_id = ? AND name = ?').get(ctx.tenantId, s.name);
    if (dup) throw RuntimeRequestError.invalid(`标识已存在: ${s.name}`);
    const id = newId('skill');
    const ts = now();
    db.prepare(
      'INSERT INTO skills (id, tenant_id, name, title, description, content, version, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ).run(id, ctx.tenantId, s.name, s.title, s.description, s.content, s.version, s.status, ctx.userId, ts, ts);
    res.status(201).json(skillDto(db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow));
  }),
);

teamRouter.patch(
  '/skills/:id',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const row = db.prepare('SELECT * FROM skills WHERE id = ? AND tenant_id = ?').get(req.params.id, ctx.tenantId) as
      | SkillRow
      | undefined;
    if (!row) throw RuntimeRequestError.notFound('Skill 不存在');
    const parsed = skillSchema.partial().safeParse(req.body);
    if (!parsed.success) throw RuntimeRequestError.invalid(parsed.error.issues[0]?.message ?? '参数非法');
    const s = parsed.data;
    db.prepare(
      'UPDATE skills SET name=?, title=?, description=?, content=?, version=?, status=?, updated_at=? WHERE id=?',
    ).run(
      s.name ?? row.name,
      s.title ?? row.title,
      s.description ?? row.description,
      s.content ?? row.content,
      s.version ?? row.version,
      s.status ?? row.status,
      now(),
      row.id,
    );
    res.json(skillDto(db.prepare('SELECT * FROM skills WHERE id = ?').get(row.id) as SkillRow));
  }),
);

teamRouter.delete(
  '/skills/:id',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const info = db.prepare('DELETE FROM skills WHERE id = ? AND tenant_id = ?').run(req.params.id, ctx.tenantId);
    if (info.changes === 0) throw RuntimeRequestError.notFound('Skill 不存在');
    res.status(204).send();
  }),
);

// ================= MCP Servers =================
interface McpRow {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  endpoint: string;
  headers_json: string | null;
  status: string;
  tools_json: string | null;
  last_test_at: string | null;
  last_test_message: string | null;
  created_at: string;
  updated_at: string;
}

const mcpDto = (r: McpRow) => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  endpoint: r.endpoint,
  headers: r.headers_json ? JSON.parse(r.headers_json) : {},
  status: r.status,
  tools: r.tools_json ? JSON.parse(r.tools_json) : null,
  lastTestAt: r.last_test_at,
  lastTestMessage: r.last_test_message,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

teamRouter.get(
  '/mcp',
  ah(async (_req, res) => {
    const ctx = _req.sessionCtx!;
    const rows = db
      .prepare('SELECT * FROM mcp_servers WHERE tenant_id = ? ORDER BY created_at')
      .all(ctx.tenantId) as McpRow[];
    res.json({ servers: rows.map(mcpDto) });
  }),
);

const mcpSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, '标识需为 kebab-case'),
  name: z.string().min(1, '名称不能为空'),
  endpoint: z.string().url('端点需为合法 URL'),
  headers: z.record(z.string()).default({}),
});

teamRouter.post(
  '/mcp',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const parsed = mcpSchema.safeParse(req.body);
    if (!parsed.success) throw RuntimeRequestError.invalid(parsed.error.issues[0]?.message ?? '参数非法');
    const s = parsed.data;
    const dup = db.prepare('SELECT id FROM mcp_servers WHERE tenant_id = ? AND slug = ?').get(ctx.tenantId, s.slug);
    if (dup) throw RuntimeRequestError.invalid(`标识已存在: ${s.slug}`);
    const id = newId('mcp');
    const ts = now();
    db.prepare(
      'INSERT INTO mcp_servers (id, tenant_id, slug, name, endpoint, headers_json, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(id, ctx.tenantId, s.slug, s.name, s.endpoint, JSON.stringify(s.headers), 'untested', ctx.userId, ts, ts);
    res.status(201).json(mcpDto(db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpRow));
  }),
);

teamRouter.patch(
  '/mcp/:id',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ? AND tenant_id = ?').get(req.params.id, ctx.tenantId) as
      | McpRow
      | undefined;
    if (!row) throw RuntimeRequestError.notFound('MCP 服务不存在');
    const parsed = mcpSchema.partial().safeParse(req.body);
    if (!parsed.success) throw RuntimeRequestError.invalid(parsed.error.issues[0]?.message ?? '参数非法');
    const s = parsed.data;
    db.prepare(
      "UPDATE mcp_servers SET slug=?, name=?, endpoint=?, headers_json=?, status='untested', tools_json=NULL, last_test_at=NULL, last_test_message=NULL, updated_at=? WHERE id=?",
    ).run(s.slug ?? row.slug, s.name ?? row.name, s.endpoint ?? row.endpoint,
      s.headers ? JSON.stringify(s.headers) : row.headers_json, now(), row.id);
    res.json(mcpDto(db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(row.id) as McpRow));
  }),
);

teamRouter.delete(
  '/mcp/:id',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const info = db.prepare('DELETE FROM mcp_servers WHERE id = ? AND tenant_id = ?').run(req.params.id, ctx.tenantId);
    if (info.changes === 0) throw RuntimeRequestError.notFound('MCP 服务不存在');
    res.status(204).send();
  }),
);

/** 测试并读取工具：代理到 agent-server 的 MCP discover（initialize + tools/list）。 */
teamRouter.post(
  '/mcp/:id/test',
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ? AND tenant_id = ?').get(req.params.id, ctx.tenantId) as
      | McpRow
      | undefined;
    if (!row) throw RuntimeRequestError.notFound('MCP 服务不存在');

    let result: { ok: boolean; message: string; tools?: unknown };
    try {
      const resp = await fetch(`${AGENT_URL}/agent/internal/mcp/discover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
        body: JSON.stringify({ endpoint: row.endpoint, headers: row.headers_json ? JSON.parse(row.headers_json) : {} }),
        signal: AbortSignal.timeout(15000),
      });
      const body = (await resp.json()) as { ok?: boolean; message?: string; tools?: unknown; detail?: string };
      result = {
        ok: resp.ok && body.ok !== false,
        message: body.message ?? body.detail ?? (resp.ok ? '连接成功' : `HTTP ${resp.status}`),
        tools: body.tools,
      };
    } catch (e) {
      result = { ok: false, message: `探测失败: ${(e as Error).message}` };
    }

    const ts = now();
    db.prepare(
      "UPDATE mcp_servers SET status=?, tools_json=?, last_test_at=?, last_test_message=?, updated_at=? WHERE id=?",
    ).run(result.ok ? 'ok' : 'error', result.tools ? JSON.stringify(result.tools) : null, ts, result.message, ts, row.id);
    res.json({ ok: result.ok, message: result.message, tools: result.tools ?? null, testedAt: ts });
  }),
);

// ================= AI Profiles（智能能力 / 模型配置） =================
interface AiProfileRow {
  id: string;
  tenant_id: string;
  name: string;
  purpose: string;
  provider: string;
  model: string;
  api_base: string | null;
  api_key: string | null;
  enabled: number;
  last_test_at: string | null;
  last_test_message: string | null;
  created_at: string;
  updated_at: string;
}

const aiDto = (r: AiProfileRow, redact = true) => ({
  id: r.id,
  name: r.name,
  purpose: r.purpose,
  provider: r.provider,
  model: r.model,
  apiBase: r.api_base,
  hasApiKey: Boolean(r.api_key),
  enabled: r.enabled === 1,
  lastTestAt: r.last_test_at,
  lastTestMessage: r.last_test_message,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

teamRouter.get(
  '/ai-profiles',
  ah(async (_req, res) => {
    const ctx = _req.sessionCtx!;
    const rows = db
      .prepare('SELECT * FROM ai_profiles WHERE tenant_id = ? ORDER BY created_at')
      .all(ctx.tenantId) as AiProfileRow[];
    res.json({ profiles: rows.map((r) => aiDto(r)) });
  }),
);

const aiSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  purpose: z.enum(['chat', 'vision', 'speech']).default('chat'),
  provider: z.literal('openai_compatible').default('openai_compatible'),
  model: z.string().min(1, '模型不能为空'),
  apiBase: z.string().optional(),
  apiKey: z.string().optional(),
  enabled: z.boolean().default(true),
});

teamRouter.post(
  '/ai-profiles',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const parsed = aiSchema.safeParse(req.body);
    if (!parsed.success) throw RuntimeRequestError.invalid(parsed.error.issues[0]?.message ?? '参数非法');
    const s = parsed.data;
    const id = newId('aiprofile');
    const ts = now();
    db.prepare(
      'INSERT INTO ai_profiles (id, tenant_id, name, purpose, provider, model, api_base, api_key, enabled, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(id, ctx.tenantId, s.name, s.purpose, s.provider, s.model, s.apiBase ?? null, s.apiKey ?? null, s.enabled ? 1 : 0, ctx.userId, ts, ts);
    res.status(201).json(aiDto(db.prepare('SELECT * FROM ai_profiles WHERE id = ?').get(id) as AiProfileRow));
  }),
);

teamRouter.patch(
  '/ai-profiles/:id',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const row = db.prepare('SELECT * FROM ai_profiles WHERE id = ? AND tenant_id = ?').get(req.params.id, ctx.tenantId) as
      | AiProfileRow
      | undefined;
    if (!row) throw RuntimeRequestError.notFound('模型配置不存在');
    const parsed = aiSchema.partial().safeParse(req.body);
    if (!parsed.success) throw RuntimeRequestError.invalid(parsed.error.issues[0]?.message ?? '参数非法');
    const s = parsed.data;
    db.prepare(
      'UPDATE ai_profiles SET name=?, purpose=?, provider=?, model=?, api_base=?, api_key=?, enabled=?, updated_at=? WHERE id=?',
    ).run(
      s.name ?? row.name,
      s.purpose ?? row.purpose,
      s.provider ?? row.provider,
      s.model ?? row.model,
      s.apiBase ?? row.api_base,
      s.apiKey ?? row.api_key,
      (s.enabled ?? row.enabled === 1) ? 1 : 0,
      now(),
      row.id,
    );
    res.json(aiDto(db.prepare('SELECT * FROM ai_profiles WHERE id = ?').get(row.id) as AiProfileRow));
  }),
);

teamRouter.delete(
  '/ai-profiles/:id',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const info = db.prepare('DELETE FROM ai_profiles WHERE id = ? AND tenant_id = ?').run(req.params.id, ctx.tenantId);
    if (info.changes === 0) throw RuntimeRequestError.notFound('模型配置不存在');
    res.status(204).send();
  }),
);

/** 测试模型可用性：直连 OpenAI 兼容端点发一次最小补全。 */
teamRouter.post(
  '/ai-profiles/:id/test',
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const row = db.prepare('SELECT * FROM ai_profiles WHERE id = ? AND tenant_id = ?').get(req.params.id, ctx.tenantId) as
      | AiProfileRow
      | undefined;
    if (!row) throw RuntimeRequestError.notFound('模型配置不存在');

    const base = (row.api_base ?? '').trim().replace(/\/+$/, '');
    let ok = false;
    let message: string;
    let reply: string | undefined;
    let latencyMs: number | undefined;
    if (!base) {
      message = '未配置 API Base，无法测试';
    } else {
      const started = Date.now();
      try {
        const resp = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(row.api_key ? { authorization: `Bearer ${row.api_key}` } : {}),
          },
          body: JSON.stringify({
            model: row.model,
            messages: [{ role: 'user', content: '请只回复两个字：正常' }],
            max_tokens: 16,
            stream: false,
          }),
          signal: AbortSignal.timeout(20000),
        });
        latencyMs = Date.now() - started;
        const body = (await resp.json().catch(() => ({}))) as {
          choices?: Array<{ message?: { content?: string } }>;
          error?: { message?: string };
        };
        if (resp.ok && body.choices?.[0]?.message) {
          ok = true;
          reply = (body.choices[0].message.content ?? '').trim().slice(0, 80);
          message = `测试通过 · ${row.model} · ${latencyMs}ms`;
        } else {
          message = `HTTP ${resp.status}${body.error?.message ? ` · ${body.error.message}` : ''}`.slice(0, 300);
        }
      } catch (e) {
        latencyMs = Date.now() - started;
        message = `连接失败: ${(e as Error).message}`.slice(0, 300);
      }
    }

    const ts = now();
    db.prepare('UPDATE ai_profiles SET last_test_at = ?, last_test_message = ?, updated_at = ? WHERE id = ?').run(
      ts,
      message,
      ts,
      row.id,
    );
    res.json({ ok, message, reply: reply ?? null, latencyMs: latencyMs ?? null, testedAt: ts });
  }),
);

/** 设为该用途的默认模型（同 purpose 内互斥启用）。 */
teamRouter.post(
  '/ai-profiles/:id/activate',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const row = db.prepare('SELECT * FROM ai_profiles WHERE id = ? AND tenant_id = ?').get(req.params.id, ctx.tenantId) as
      | AiProfileRow
      | undefined;
    if (!row) throw RuntimeRequestError.notFound('模型配置不存在');
    const ts = now();
    db.prepare('UPDATE ai_profiles SET enabled = 0, updated_at = ? WHERE tenant_id = ? AND purpose = ? AND id != ?').run(
      ts,
      ctx.tenantId,
      row.purpose,
      row.id,
    );
    db.prepare('UPDATE ai_profiles SET enabled = 1, updated_at = ? WHERE id = ?').run(ts, row.id);
    res.json(aiDto(db.prepare('SELECT * FROM ai_profiles WHERE id = ?').get(row.id) as AiProfileRow));
  }),
);
