'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { LangToggle, useI18n } from '@/lib/i18n';

interface AppDto {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active';
  createdAt: string;
  updatedAt: string;
}

interface AuthMe {
  user: { displayName: string | null; email: string };
  tenant: { name: string };
}

export default function AppsPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [apps, setApps] = useState<AppDto[] | null>(null);
  const [me, setMe] = useState<AuthMe | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [meData, appsData] = await Promise.all([
        apiFetch<AuthMe>('/auth/me'),
        apiFetch<AppDto[]>('/apps'),
      ]);
      setMe(meData);
      setApps(appsData);
    } catch {
      /* 401 已由 apiFetch 跳转 */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const app = await apiFetch<AppDto>('/apps', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || null }),
      });
      setShowCreate(false);
      router.push(`/apps/${app.id}/builder`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('apps.createFailed'));
      setCreating(false);
    }
  }

  async function handleLogout() {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    router.push('/auth/login');
  }

  return (
    <div className="min-h-screen">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
              AIR
            </div>
            <span className="text-sm font-semibold text-slate-800">{t('common.brand')}</span>
            <span className="ml-2 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">
              {me?.tenant.name ?? '…'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <LangToggle />
            <a href="/settings" className="text-slate-500 transition hover:text-slate-800">
              {t('common.settings')}
            </a>
            <span className="text-slate-300">|</span>
            <span className="text-slate-600">{me?.user.displayName ?? me?.user.email ?? ''}</span>
            <button onClick={handleLogout} className="text-slate-400 transition hover:text-red-500">
              {t('common.logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{t('apps.title')}</h1>
            <p className="mt-0.5 text-sm text-slate-500">{t('apps.subtitle')}</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            {t('apps.new')}
          </button>
        </div>

        {apps === null ? (
          <div className="py-24 text-center text-sm text-slate-400">{t('common.loading')}</div>
        ) : apps.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 py-24 text-center">
            <p className="text-sm text-slate-500">{t('apps.empty')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {apps.map((app) => (
              <div
                key={app.id}
                className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
              >
                <button onClick={() => router.push(`/apps/${app.id}/builder`)} className="w-full text-left">
                  <div className="flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-bold text-white">
                      {app.name.slice(0, 2)}
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        app.status === 'active'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {app.status === 'active' ? t('apps.published') : t('apps.draft')}
                    </span>
                  </div>
                  <h3 className="mt-3 font-medium text-slate-900 group-hover:text-indigo-600">
                    {app.name}
                  </h3>
                  <p className="mt-1 line-clamp-2 min-h-10 text-sm text-slate-500">
                    {app.description || t('apps.noDesc')}
                  </p>
                  <p className="mt-3 text-xs text-slate-400">
                    {t('apps.createdAt')} {new Date(app.createdAt).toLocaleDateString('zh-CN')}
                  </p>
                </button>
                <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3 text-xs">
                  <button
                    onClick={() => router.push(`/apps/${app.id}/builder`)}
                    className="flex-1 rounded-lg border border-slate-200 py-1.5 text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
                  >
                    {t('apps.edit')}
                  </button>
                  <button
                    onClick={() => router.push(`/apps/${app.id}/run`)}
                    className="flex-1 rounded-lg bg-slate-900 py-1.5 font-medium text-white transition hover:bg-slate-700"
                  >
                    {t('apps.open')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 新建应用弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4" onClick={() => setShowCreate(false)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreate}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-base font-semibold text-slate-900">{t('apps.createTitle')}</h2>
            <label className="mt-4 block text-sm font-medium text-slate-700">{t('apps.name')}</label>
            <input
              autoFocus
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('apps.namePlaceholder')}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
            <label className="mt-3 block text-sm font-medium text-slate-700">{t('apps.desc')}</label>
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={2}
              placeholder={t('apps.descPlaceholder')}
              className="mt-1.5 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
            {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-100"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
              >
                {creating ? t('common.creating') : t('apps.createAndEnter')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
