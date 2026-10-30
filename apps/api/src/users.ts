import { Router } from 'express';
import type { NextFunction, Request } from 'express';
import { z } from 'zod';
import { db, hashPassword } from './db.js';
import { RuntimeRequestError, ah } from './errors.js';
import { newId } from './ids.js';
import { requireSession } from './auth.js';

export const usersRouter = Router();
usersRouter.use(requireSession);

/** 角色五档，对齐原版平台：所有者/管理员/成员/只读/应用用户 */
export const TENANT_ROLES = ['owner', 'admin', 'member', 'viewer', 'app_user'] as const;
const MANAGER_ROLES = new Set(['owner', 'admin']);

function requireAdmin(req: Request, _res: unknown, next: NextFunction) {
  const ctx = req.sessionCtx!;
  if (ctx.role === 'system') return next(); // 服务间调用
  if (!MANAGER_ROLES.has(ctx.role)) return next(RuntimeRequestError.forbidden('仅所有者/管理员可管理成员'));
  next();
}

interface MemberRow {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
  created_at: string;
}

function toDto(r: MemberRow) {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    role: r.role,
    status: r.status,
    createdAt: r.created_at,
  };
}

function listMembers(tenantId: string): MemberRow[] {
  return db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.avatar_url, m.role, m.status, u.created_at
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.tenant_id = ? ORDER BY
         CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 WHEN 'viewer' THEN 3 ELSE 4 END,
         u.created_at`,
    )
    .all(tenantId) as MemberRow[];
}

// ---------- 成员列表（本租户） ----------
usersRouter.get(
  '/',
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const tenantId = ctx.role === 'system' ? String(req.query.tenantId ?? '') : ctx.tenantId;
    if (!tenantId) throw RuntimeRequestError.invalid('内部调用需提供 tenantId 查询参数');
    res.json({ users: listMembers(tenantId).map(toDto) });
  }),
);

// ---------- 管理员直接录入成员 ----------
const createSchema = z.object({
  displayName: z.string().min(1, '姓名不能为空'),
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(6, '密码至少 6 位'),
  role: z.enum(TENANT_ROLES).default('member'),
});

usersRouter.post(
  '/',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw RuntimeRequestError.invalid(parsed.error.issues[0]?.message ?? '参数非法');
    const { displayName, email, password, role } = parsed.data;
    const tenantId = ctx.role === 'system' ? String(req.body.tenantId ?? '') : ctx.tenantId;
    if (!tenantId) throw RuntimeRequestError.invalid('内部调用需提供 tenantId');

    const exists = db
      .prepare(
        `SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id
         WHERE m.tenant_id = ? AND lower(u.email) = lower(?)`,
      )
      .get(tenantId, email.trim());
    if (exists) throw RuntimeRequestError.invalid('该邮箱已是本团队成员');

    // 用户可能已存在于其他租户（私有化部署通常单租户，这里仍做兼容）
    let userId = (
      db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email.trim()) as
        | { id: string }
        | undefined
    )?.id;
    const now = new Date().toISOString();
    if (!userId) {
      userId = newId('user');
      db.prepare(
        'INSERT INTO users (id, email, password_hash, display_name, avatar_url, created_at) VALUES (?,?,?,?,?,?)',
      ).run(userId, email.trim(), hashPassword(password), displayName, null, now);
    }
    db.prepare(
      'INSERT INTO memberships (user_id, tenant_id, role, status, is_current) VALUES (?,?,?,?,0)',
    ).run(userId, tenantId, role, 'active');

    const row = listMembers(tenantId).find((u) => u.id === userId)!;
    res.status(201).json(toDto(row));
  }),
);

// ---------- 更新成员（角色/状态/资料/重置密码） ----------
const patchSchema = z.object({
  displayName: z.string().min(1).optional(),
  role: z.enum(TENANT_ROLES).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  password: z.string().min(6, '密码至少 6 位').optional(),
});

usersRouter.patch(
  '/:userId',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) throw RuntimeRequestError.invalid(parsed.error.issues[0]?.message ?? '参数非法');
    const { displayName, role, status, password } = parsed.data;

    const member = db
      .prepare('SELECT user_id FROM memberships WHERE user_id = ? AND tenant_id = ?')
      .get(req.params.userId, ctx.tenantId);
    if (!member) throw RuntimeRequestError.notFound('成员不存在');
    if (role === 'owner' && ctx.role !== 'owner' && ctx.role !== 'system') {
      throw RuntimeRequestError.forbidden('仅所有者可授予所有者角色');
    }

    if (displayName !== undefined) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, req.params.userId);
    }
    if (password !== undefined) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.params.userId);
    }
    if (role !== undefined) {
      db.prepare('UPDATE memberships SET role = ? WHERE user_id = ? AND tenant_id = ?').run(
        role,
        req.params.userId,
        ctx.tenantId,
      );
    }
    if (status !== undefined) {
      db.prepare('UPDATE memberships SET status = ? WHERE user_id = ? AND tenant_id = ?').run(
        status,
        req.params.userId,
        ctx.tenantId,
      );
      if (status === 'disabled') {
        // 停用即踢出全部会话
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.userId);
      }
    }
    const row = listMembers(ctx.tenantId).find((u) => u.id === req.params.userId);
    if (!row) throw RuntimeRequestError.notFound('成员不存在');
    res.json(toDto(row));
  }),
);

// ---------- 移除成员 ----------
usersRouter.delete(
  '/:userId',
  requireAdmin,
  ah(async (req, res) => {
    const ctx = req.sessionCtx!;
    const userId = req.params.userId;
    if (userId === ctx.userId) throw RuntimeRequestError.invalid('不能移除自己');

    const member = db
      .prepare('SELECT role FROM memberships WHERE user_id = ? AND tenant_id = ?')
      .get(userId, ctx.tenantId) as { role: string } | undefined;
    if (!member) throw RuntimeRequestError.notFound('成员不存在');
    if (member.role === 'owner' && ctx.role !== 'system') {
      throw RuntimeRequestError.forbidden('不能移除所有者');
    }

    db.prepare('DELETE FROM memberships WHERE user_id = ? AND tenant_id = ?').run(userId, ctx.tenantId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    // 用户不属于任何租户时彻底删除账号
    const left = db.prepare('SELECT COUNT(*) AS c FROM memberships WHERE user_id = ?').get(userId) as { c: number };
    if (left.c === 0) db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.status(204).send();
  }),
);
