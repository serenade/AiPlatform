import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { db, verifyPassword } from './db.js';
import { RuntimeRequestError, ah } from './errors.js';
import { newId } from './ids.js';

const SESSION_TTL_DAYS = 14;

export interface SessionContext {
  userId: string;
  tenantId: string;
  role: string;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessionCtx?: SessionContext;
    }
  }
}

const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token';

// ---------- cookie ----------
export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function setSessionCookies(res: Response, sessionToken: string, csrfToken: string) {
  const maxAge = SESSION_TTL_DAYS * 24 * 3600;
  res.setHeader('Set-Cookie', [
    `air_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
    `air_csrf=${csrfToken}; Path=/; SameSite=Lax; Max-Age=${maxAge}`,
  ]);
}

function clearSessionCookies(res: Response) {
  res.setHeader('Set-Cookie', [
    'air_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    'air_csrf=; Path=/; SameSite=Lax; Max-Age=0',
  ]);
}

// ---------- 中间件 ----------
/** 会话校验：air_session cookie 或服务间 internal token。 */
export function requireSession(req: Request, _res: Response, next: NextFunction) {
  const internal = req.headers['x-internal-token'];
  if (typeof internal === 'string' && internal.length > 0) {
    if (internal !== INTERNAL_TOKEN) return next(RuntimeRequestError.forbidden('内部服务令牌无效'));
    // 服务间调用：以系统身份放行，tenant 由路径/调用参数约束
    req.sessionCtx = { userId: 'internal', tenantId: '', role: 'system', sessionId: 'internal' };
    return next();
  }

  const token = parseCookies(req)['air_session'];
  if (!token) return next(RuntimeRequestError.auth());

  const row = db
    .prepare(
      `SELECT s.id, s.user_id, s.tenant_id, s.expires_at, m.role
       FROM sessions s JOIN memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id
       WHERE s.id = ?`,
    )
    .get(token) as { id: string; user_id: string; tenant_id: string; expires_at: string; role: string } | undefined;

  if (!row) return next(RuntimeRequestError.auth('会话无效或已过期，请重新登录'));
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    return next(RuntimeRequestError.auth('会话已过期，请重新登录'));
  }

  req.sessionCtx = { userId: row.user_id, tenantId: row.tenant_id, role: row.role, sessionId: row.id };
  next();
}

/** CSRF 双提交校验：所有非 GET 请求（除登录）必须携带 x-csrf-token === air_csrf cookie。 */
export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'OPTIONS') return next();
  if (req.sessionCtx?.sessionId === 'internal') return next();
  // internal token 服务间调用（requireSession 尚未执行，这里直接检查头）
  if (req.headers['x-internal-token'] === INTERNAL_TOKEN) return next();
  if (req.path === '/api/auth/login' || req.path === '/login') return next();

  const cookies = parseCookies(req);
  const header = req.headers['x-csrf-token'];
  if (!cookies['air_csrf'] || header !== cookies['air_csrf']) {
    return next(RuntimeRequestError.forbidden('CSRF 校验失败'));
  }
  next();
}

// ---------- 响应组装 ----------
function authPayload(userId: string, tenantId: string) {
  const user = db
    .prepare('SELECT id, email, display_name, avatar_url FROM users WHERE id = ?')
    .get(userId) as { id: string; email: string; display_name: string | null; avatar_url: string | null };
  const tenant = db
    .prepare('SELECT id, name, slug, avatar_url FROM tenants WHERE id = ?')
    .get(tenantId) as { id: string; name: string; slug: string; avatar_url: string | null };
  const membership = db
    .prepare('SELECT role, status FROM memberships WHERE user_id = ? AND tenant_id = ?')
    .get(userId, tenantId) as { role: string; status: string };
  const tenants = db
    .prepare(
      `SELECT t.id, t.name, t.slug, t.avatar_url AS avatarUrl, m.role, m.status, m.is_current AS isCurrent
       FROM tenants t JOIN memberships m ON m.tenant_id = t.id WHERE m.user_id = ?`,
    )
    .all(
      userId,
    ) as { id: string; name: string; slug: string; avatarUrl: string | null; role: string; status: string; isCurrent: number }[];

  return {
    user: { id: user.id, email: user.email, displayName: user.display_name, avatarUrl: user.avatar_url },
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, avatarUrl: tenant.avatar_url },
    membership: { role: membership.role, status: membership.status },
    tenants: tenants.map((t) => ({ ...t, isCurrent: t.isCurrent === 1 })),
    authContext: {
      actorId: user.id,
      tenantId: tenant.id,
      roles: [membership.role],
      subjectType: 'platform_user',
    },
  };
}

// ---------- 路由 ----------
export const authRouter = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post(
  '/login',
  ah(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw RuntimeRequestError.invalid('请提供合法的邮箱与密码');
    }
    const { email, password } = parsed.data;

    const user = db
      .prepare('SELECT id, password_hash FROM users WHERE lower(email) = lower(?)')
      .get(email.trim()) as { id: string; password_hash: string } | undefined;
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new RuntimeRequestError('AUTHENTICATION_REQUIRED', 401, '邮箱或密码不正确');
    }

    const member = db
      .prepare('SELECT tenant_id FROM memberships WHERE user_id = ? ORDER BY is_current DESC LIMIT 1')
      .get(user.id) as { tenant_id: string };
    const tenantId = member.tenant_id;

    const sessionToken = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000).toISOString();

    db.prepare(
      'INSERT INTO sessions (id, user_id, tenant_id, csrf_token, expires_at, created_at) VALUES (?,?,?,?,?,?)',
    ).run(sessionToken, user.id, tenantId, csrfToken, expiresAt, new Date().toISOString());

    setSessionCookies(res, sessionToken, csrfToken);
    res.json(authPayload(user.id, tenantId));
  }),
);

authRouter.get(
  '/me',
  requireSession,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    if (ctx.sessionId === 'internal') throw RuntimeRequestError.auth('内部令牌不能用于 /auth/me');
    res.json(authPayload(ctx.userId, ctx.tenantId));
  }),
);

authRouter.post(
  '/logout',
  requireSession,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    if (ctx.sessionId !== 'internal') {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(ctx.sessionId);
    }
    clearSessionCookies(res);
    res.status(204).send();
  }),
);
