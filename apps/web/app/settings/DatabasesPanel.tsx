'use client';

/** 平台设置 · 数据库管理（需求2）：统一外部数据库服务器（MySQL/PostgreSQL）+ 应用数据存储绑定。 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface DbServer {
  id: string;
  name: string;
  dbType: 'mysql' | 'postgresql';
  host: string;
  port: number;
  username: string;
  ssl: boolean;
  status: string;
  lastTestAt: string | null;
  lastTestMessage: string | null;
  appCount: number;
}

interface Binding {
  appId: string;
  mode: string;
  dbServerId: string | null;
  dbServerName?: string | null;
  databaseName: string | null;
  updatedAt: string | null;
}

export function DatabasesPanel() {
  const { t } = useI18n();
  const [servers, setServers] = useState<DbServer[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({ name: '', dbType: 'mysql', host: '127.0.0.1', port: 3306, username: 'root', password: '' });
  const [bindTarget, setBindTarget] = useState<{ appId: string; serverId: string; databaseName: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([
        apiFetch<{ servers: DbServer[] }>('/databases/servers'),
        apiFetch<{ bindings: Binding[] }>('/databases/bindings'),
      ]);
      setServers(s.servers);
      setBindings(b.bindings);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createServer(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create');
    try {
      await apiFetch('/databases/servers', { method: 'POST', body: JSON.stringify({ ...form, port: Number(form.port) }) });
      setShowForm(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function testServer(id: string) {
    setBusy(`test-${id}`);
    try {
      await apiFetch(`/databases/servers/${id}/test`, { method: 'POST', body: JSON.stringify({}) });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function removeServer(id: string) {
    if (!confirm(t('db.deleteConfirm'))) return;
    try {
      await apiFetch(`/databases/servers/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveBinding(e: React.FormEvent) {
    e.preventDefault();
    if (!bindTarget) return;
    setBusy('bind');
    try {
      await apiFetch(`/databases/bindings/${bindTarget.appId}`, {
        method: 'PUT',
        body: JSON.stringify({ mode: 'external', dbServerId: bindTarget.serverId, databaseName: bindTarget.databaseName }),
      });
      setBindTarget(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function setSqlite(appId: string) {
    setBusy(`bind-${appId}`);
    try {
      await apiFetch(`/databases/bindings/${appId}`, { method: 'PUT', body: JSON.stringify({ mode: 'sqlite' }) });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">{t('db.serversTitle')}</h2>
            <p className="mt-1 text-xs text-slate-500">{t('db.serversDesc')}</p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700"
          >
            {showForm ? t('common.cancel') : t('db.addServer')}
          </button>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

        {showForm && (
          <form onSubmit={createServer} className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
            <input required placeholder={t('db.namePlaceholder')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            <select value={form.dbType} onChange={(e) => setForm({ ...form, dbType: e.target.value, port: e.target.value === 'mysql' ? 3306 : 5432 })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none">
              <option value="mysql">MySQL</option>
              <option value="postgresql">PostgreSQL</option>
            </select>
            <input required placeholder={t('db.hostPlaceholder')} value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            <input required type="number" placeholder={t('db.portPlaceholder')} value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            <input required placeholder={t('db.usernamePlaceholder')} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            <input type="password" placeholder={t('db.passwordPlaceholder')} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            <button type="submit" disabled={busy === 'create'}
              className="col-span-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50 sm:col-span-3">
              {t('common.save')}
            </button>
          </form>
        )}

        <div className="mt-3 space-y-3">
          {servers.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-xs text-slate-400">
              {t('db.empty')}
            </p>
          )}
          {servers.map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{s.name}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase text-slate-500">{s.dbType}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        s.status === 'ok' ? 'bg-emerald-50 text-emerald-600' : s.status === 'error' ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {s.status === 'ok' ? t('db.statusOk') : s.status === 'error' ? t('db.statusError') : t('db.statusUntested')}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-400">
                    {s.dbType}://{s.username}@{s.host}:{s.port} · {t('db.usedBy', { n: s.appCount })}
                    {s.lastTestMessage && ` · ${s.lastTestMessage}`}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2 text-xs">
                  <button onClick={() => testServer(s.id)} disabled={busy === `test-${s.id}`}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50">
                    {t('db.test')}
                  </button>
                  <button onClick={() => removeServer(s.id)} className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-500 transition hover:border-red-300 hover:text-red-600">
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-800">{t('db.bindingsTitle')}</h2>
        <p className="mt-1 text-xs text-slate-500">{t('db.bindingsDesc')}</p>
        <div className="mt-3 space-y-2">
          {bindings.map((b) => (
            <div key={b.appId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800">{b.appId}</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {b.mode === 'external' ? (
                    <>
                      {t('db.externalPrefix')}{b.dbServerName} / <code className="rounded bg-slate-100 px-1">{b.databaseName}</code>
                    </>
                  ) : (
                    t('db.sqliteBinding')
                  )}
                </div>
              </div>
              <div className="flex gap-2 text-xs">
                {b.mode === 'sqlite' ? (
                  <button
                    onClick={() => setBindTarget({ appId: b.appId, serverId: servers[0]?.id ?? '', databaseName: `air_app_${b.appId.slice(4, 12)}` })}
                    disabled={servers.length === 0}
                    title={servers.length === 0 ? t('db.needServerFirst') : ''}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40"
                  >
                    {t('db.migrateExternal')}
                  </button>
                ) : (
                  <button onClick={() => setSqlite(b.appId)} disabled={busy === `bind-${b.appId}`}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50">
                    {t('db.backToSqlite')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {bindTarget && (
        <form onSubmit={saveBinding} className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
          <h3 className="text-sm font-medium text-slate-800">{t('db.createBindingTitle')}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <select value={bindTarget.serverId} onChange={(e) => setBindTarget({ ...bindTarget, serverId: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" required>
              <option value="" disabled>
                {t('db.selectServer')}
              </option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}（{s.dbType}）
                </option>
              ))}
            </select>
            <input required pattern="[a-zA-Z_][a-zA-Z0-9_]*" title={t('db.dbNameTitle')}
              value={bindTarget.databaseName} onChange={(e) => setBindTarget({ ...bindTarget, databaseName: e.target.value })}
              placeholder={t('db.dbNamePlaceholder')}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            <button type="submit" disabled={busy === 'bind'}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50">
              {t('db.createBind')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
