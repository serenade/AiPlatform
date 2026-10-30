import { Router } from 'express';
import { db } from './db.js';
import { ah } from './errors.js';
import { requireSession } from './auth.js';

export const tenantsRouter = Router();

tenantsRouter.get(
  '/',
  requireSession,
  ah(async (req, res) => {
    const userId = req.sessionCtx!.userId;
    interface TenantRow {
      id: string;
      name: string;
      slug: string;
      avatarUrl: string | null;
      role: string;
      status: string;
      isCurrent: number;
    }

    const tenants = db
      .prepare(
        `SELECT t.id, t.name, t.slug, t.avatar_url AS avatarUrl, m.role, m.status, m.is_current AS isCurrent
         FROM tenants t JOIN memberships m ON m.tenant_id = t.id
         WHERE m.user_id = ? ORDER BY m.is_current DESC`,
      )
      .all(userId) as TenantRow[];
    res.json({ tenants: tenants.map((t) => ({ ...t, isCurrent: t.isCurrent === 1 })) });
  }),
);
