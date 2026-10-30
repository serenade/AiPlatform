'use client';

/** 平台设置 · 用户管理（需求1）：管理员直接录入成员，应用共享平台用户体系。 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Member {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
  createdAt: string;
}

const ROLES = ['owner', 'admin', 'member', 'viewer', 'app_user'] as const;

export function UsersPanel() {
  const { t } = useI18n();
  const [users, setUsers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ displayName: '', email: '', password: '', role: 'member' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ users: Member[] }>('/users');
      setUsers(data.users);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch('/users', { method: 'POST', body: JSON.stringify(form) });
      setShowForm(false);
      setForm({ displayName: '', email: '', password: '', role: 'member' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function patchUser(id: string, body: Record<string, unknown>) {
    try {
      await apiFetch(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeUser(id: string) {
    if (!confirm(t('users.removeConfirm'))) return;
    try {
      await apiFetch(`/users/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{t('users.title')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('users.desc')}</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700"
        >
          {showForm ? t('common.cancel') : t('users.add')}
        </button>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

      {showForm && (
        <form onSubmit={createUser} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
          <input
            required
            placeholder={t('users.namePlaceholder')}
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <input
            required
            type="email"
            placeholder={t('users.emailPlaceholder')}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <input
            required
            type="password"
            placeholder={t('users.passwordPlaceholder')}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <div className="flex gap-2">
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`users.role.${r}`)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
            >
              {t('common.create')}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-500">
              <th className="px-4 py-2.5 font-medium">{t('users.th.member')}</th>
              <th className="px-4 py-2.5 font-medium">{t('users.th.role')}</th>
              <th className="px-4 py-2.5 font-medium">{t('users.th.status')}</th>
              <th className="px-4 py-2.5 font-medium">{t('users.th.joinedAt')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t('users.th.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-400">
                  {t('common.loading')}
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-400">
                  {t('users.empty')}
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-800">{u.displayName ?? '—'}</div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={u.role}
                      onChange={(e) => patchUser(u.id, { role: e.target.value })}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`users.role.${r}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        u.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {u.status === 'active' ? t('common.enabled') : t('users.statusDisabled')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-2 text-xs">
                      <button
                        onClick={() => patchUser(u.id, { status: u.status === 'active' ? 'disabled' : 'active' })}
                        className="text-slate-500 transition hover:text-indigo-600"
                      >
                        {u.status === 'active' ? t('common.disabled') : t('common.enabled')}
                      </button>
                      <button
                        onClick={() => {
                          const pwd = prompt(t('users.resetPasswordPrompt'));
                          if (pwd && pwd.length >= 6) void patchUser(u.id, { password: pwd });
                        }}
                        className="text-slate-500 transition hover:text-indigo-600"
                      >
                        {t('users.resetPassword')}
                      </button>
                      {u.role !== 'owner' && (
                        <button onClick={() => removeUser(u.id)} className="text-slate-500 transition hover:text-red-600">
                          {t('users.remove')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        {t('users.sharedApiPrefix')}
        <code className="rounded bg-slate-100 px-1">GET /api/apps/:appId/users</code>
        {t('users.sharedApiSuffix')}
      </p>
    </div>
  );
}
