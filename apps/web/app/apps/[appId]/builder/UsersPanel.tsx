'use client';

/** Builder 用户与权限模块：应用用户列表（平台共享用户）+ 四角色数据权限矩阵（存 spec.policy.roleDefinitions） */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { saveSpec, type BuilderSpec, type RoleDefinition } from './specSave';

interface AppUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
}

type Perm = 'data:read' | 'data:write' | 'data:delete';
const ROLES: Array<'owner' | 'admin' | 'member' | 'viewer'> = ['owner', 'admin', 'member', 'viewer'];
const PERMS: Perm[] = ['data:read', 'data:write', 'data:delete'];
const DEFAULT_PERMS: Record<string, Perm[]> = {
  owner: ['data:read', 'data:write', 'data:delete'],
  admin: ['data:read', 'data:write', 'data:delete'],
  member: ['data:read', 'data:write'],
  viewer: ['data:read'],
};

export function UsersPanel({
  appId,
  spec,
  onSpecChanged,
}: {
  appId: string;
  spec: BuilderSpec | null;
  onSpecChanged: () => void;
}) {
  const { t } = useI18n();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [saving, setSaving] = useState(false);
  // 矩阵编辑态：undefined 行使用默认映射
  const [matrix, setMatrix] = useState<Record<string, Perm[] | null>>({});

  const defs = ((Array.isArray(spec?.policy?.roleDefinitions) ? spec!.policy!.roleDefinitions : []) ??
    []) as RoleDefinition[];

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await apiFetch<{ users: AppUser[] }>(`/apps/${appId}/users`);
      setUsers(data.users);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  // spec 变化时同步矩阵显示（已定义角色显示定义值，未定义显示 null=默认映射）
  useEffect(() => {
    const next: Record<string, Perm[] | null> = {};
    for (const role of ROLES) {
      const def = defs.find((d) => d.role === role);
      next[role] = def ? ([...def.permissions] as Perm[]) : null;
    }
    setMatrix(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);

  function permsOf(role: string): Perm[] {
    return matrix[role] ?? DEFAULT_PERMS[role] ?? [];
  }

  function toggle(role: string, perm: Perm) {
    if (role === 'owner') return; // owner 锁定全权，防自锁
    setMatrix((prev) => {
      const cur = prev[role] ?? DEFAULT_PERMS[role] ?? [];
      const next = cur.includes(perm) ? cur.filter((p) => p !== perm) : [...cur, perm];
      return { ...prev, [role]: next };
    });
  }

  async function save() {
    if (!spec) return;
    setSaving(true);
    setError('');
    try {
      const definitions: RoleDefinition[] = ROLES.filter((r) => r !== 'owner').map((role) => ({
        role,
        permissions: matrix[role] ?? DEFAULT_PERMS[role] ?? [],
      }));
      definitions.unshift({ role: 'owner', permissions: ['data:read', 'data:write', 'data:delete'] });
      const policy = { ...(spec.policy ?? {}), roleDefinitions: definitions };
      await saveSpec(appId, { ...spec, policy }, '[builder] 更新角色权限');
      setSavedMsg(t('builder.perm.saved'));
      onSpecChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function roleBadge(role: string): string {
    const map: Record<string, string> = {
      owner: 'bg-violet-50 text-violet-600',
      admin: 'bg-indigo-50 text-indigo-600',
      member: 'bg-slate-100 text-slate-600',
      viewer: 'bg-amber-50 text-amber-700',
    };
    const label: Record<string, string> = {
      owner: t('builder.perm.roleOwner'),
      admin: t('builder.perm.roleAdmin'),
      member: t('builder.perm.roleMember'),
      viewer: t('builder.perm.roleViewer'),
    };
    return label[role] ?? role;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">{t('builder.module.users')}</h2>
        <p className="mt-1 text-xs text-slate-500">{t('builder.perm.desc')}</p>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      {savedMsg && !saving && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-600">{savedMsg}</p>}

      {/* 用户列表 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-800">
          {t('builder.perm.usersTitle', { n: users?.length ?? 0 })}
        </h3>
        {users === null ? (
          <p className="py-4 text-center text-xs text-slate-400">{t('common.loading')}</p>
        ) : users.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">{t('builder.perm.usersEmpty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
                <span className="text-sm text-slate-800">{u.displayName || u.email}</span>
                <span className="text-[11px] text-slate-400">{u.email}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${roleBadge(u.role)}`}>
                  {roleBadge(u.role)}
                </span>
                <span
                  className={`ml-auto rounded px-1.5 py-0.5 text-[10px] ${
                    u.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {u.status === 'active' ? t('builder.perm.statusActive') : u.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 角色权限矩阵 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-medium text-slate-800">{t('builder.perm.rolesTitle')}</h3>
        <p className="mb-3 mt-1 text-xs text-slate-500">{t('builder.perm.rolesDesc')}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="px-2 py-1.5 font-medium">{t('builder.perm.colRole')}</th>
                {PERMS.map((p) => (
                  <th key={p} className="px-2 py-1.5 font-medium">
                    {p === 'data:read'
                      ? t('builder.perm.permRead')
                      : p === 'data:write'
                        ? t('builder.perm.permWrite')
                        : t('builder.perm.permDelete')}
                  </th>
                ))}
                <th className="px-2 py-1.5 font-medium">{t('builder.perm.colSource')}</th>
              </tr>
            </thead>
            <tbody>
              {ROLES.map((role) => (
                <tr key={role} className="border-b border-slate-50">
                  <td className="px-2 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${roleBadge(role)}`}>
                      {roleBadge(role)}
                    </span>
                  </td>
                  {PERMS.map((perm) => (
                    <td key={perm} className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={permsOf(role).includes(perm)}
                        onChange={() => toggle(role, perm)}
                        disabled={role === 'owner' || saving}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-2 text-[10px] text-slate-400">
                    {matrix[role] === null ? t('builder.perm.defaultSource') : t('builder.perm.customSource')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">{t('builder.perm.defaultNote')}</p>
        <div className="mt-3 flex justify-end">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {t('common.save')}
          </button>
        </div>
      </section>
    </div>
  );
}
