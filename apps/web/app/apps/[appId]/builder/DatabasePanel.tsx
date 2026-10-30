'use client';

/** Builder 数据库模块：绑定切换 / 模型表与记录数 / 记录管理 / DDL 预览 / 备份下载 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { type BuilderSpec, type BuilderSpecField } from './specSave';

interface DbServerLite {
  id: string;
  name: string;
  dbType: string;
  host: string;
  port: number;
}

interface Overview {
  binding: { mode: string; dbServerId: string | null; databaseName: string | null; updatedAt: string | null };
  models: Array<{ id: string; name: string; fields: BuilderSpecField[]; recordCount: number }>;
}

interface RecordRow extends Record<string, unknown> {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export function DatabasePanel({
  appId,
  spec,
  onSpecChanged,
}: {
  appId: string;
  spec: BuilderSpec | null;
  onSpecChanged: () => void;
}) {
  const { t } = useI18n();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [showBindingForm, setShowBindingForm] = useState(false);
  const [servers, setServers] = useState<DbServerLite[] | null>(null);
  const [formMode, setFormMode] = useState<'sqlite' | 'external'>('sqlite');
  const [serverId, setServerId] = useState('');
  const [databases, setDatabases] = useState<Array<{ name: string; boundAppName: string | null }> | null>(null);
  const [dbName, setDbName] = useState('');
  const [bindingSaving, setBindingSaving] = useState(false);
  const [bindingMsg, setBindingMsg] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  const [activeModel, setActiveModel] = useState<string | null>(null);

  const [ddl, setDdl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      setError('');
      setOverview(await apiFetch<Overview>(`/apps/${appId}/data`));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [appId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function openBindingForm() {
    setShowBindingForm(true);
    setBindingMsg(null);
    setFormMode(overview?.binding.mode === 'external' ? 'external' : 'sqlite');
    setServerId(overview?.binding.dbServerId ?? '');
    setDbName(overview?.binding.databaseName ?? '');
    try {
      const data = await apiFetch<{ servers: DbServerLite[] }>('/databases/servers');
      setServers(data.servers);
      if (!serverId && data.servers.length > 0) setServerId(data.servers[0].id);
    } catch {
      setServers([]);
    }
  }

  async function pickServer(id: string) {
    setServerId(id);
    setDatabases(null);
    if (!id) return;
    try {
      const data = await apiFetch<{ databases: Array<{ name: string; boundAppName: string | null }> }>(
        `/databases/servers/${id}/databases`,
      );
      setDatabases(data.databases);
    } catch {
      setDatabases([]);
    }
  }

  async function saveBinding() {
    setBindingSaving(true);
    setBindingMsg(null);
    try {
      const body =
        formMode === 'sqlite'
          ? { mode: 'sqlite' }
          : { mode: 'external', dbServerId: serverId, databaseName: dbName };
      const res = await apiFetch<{ warning?: string }>(`/databases/bindings/${appId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setShowBindingForm(false);
      if (res.warning) {
        setBindingMsg({ kind: 'warn', text: res.warning });
      } else {
        setBindingMsg({ kind: 'ok', text: t('builder.db.bindingSaved') });
      }
      await loadOverview();
    } catch (err) {
      setBindingMsg({ kind: 'warn', text: (err as Error).message });
    } finally {
      setBindingSaving(false);
    }
  }

  async function loadDdl() {
    try {
      const data = await apiFetch<{ schemaSql: string }>(`/apps/${appId}/db/schema`);
      setDdl(data.schemaSql);
      setCopied(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const activeModelDef = overview?.models.find((m) => m.id === activeModel) ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">{t('builder.module.database')}</h2>
        <p className="mt-1 text-xs text-slate-500">{t('builder.db.desc')}</p>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      {bindingMsg && (
        <p
          className={`rounded-lg px-3 py-2 text-xs ${
            bindingMsg.kind === 'ok' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {bindingMsg.text}
        </p>
      )}

      {/* 绑定模式 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-slate-800">{t('builder.db.bindingTitle')}</h3>
            <p className="mt-1 text-xs text-slate-500">
              {overview
                ? overview.binding.mode === 'external'
                  ? `${t('builder.db.modeExternal')} · ${overview.binding.databaseName ?? '-'}`
                  : t('builder.db.modeSqlite')
                : t('common.loading')}
            </p>
          </div>
          <button
            onClick={openBindingForm}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
          >
            {t('builder.db.switchBinding')}
          </button>
        </div>

        {showBindingForm && (
          <div className="mt-4 space-y-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="radio" checked={formMode === 'sqlite'} onChange={() => setFormMode('sqlite')} />
              {t('builder.db.modeSqlite')}
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="radio" checked={formMode === 'external'} onChange={() => setFormMode('external')} />
              {t('builder.db.modeExternal')}
            </label>
            {formMode === 'external' && (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <select
                  value={serverId}
                  onChange={(e) => void pickServer(e.target.value)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                >
                  <option value="">{t('builder.db.selectServer')}</option>
                  {(servers ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}（{s.dbType}://{s.host}:{s.port}）
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <select
                    value={databases?.some((d) => d.name === dbName) ? dbName : ''}
                    onChange={(e) => setDbName(e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="">{t('builder.db.selectDatabase')}</option>
                    {(databases ?? []).map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                        {d.boundAppName ? ` (${d.boundAppName})` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    value={dbName}
                    onChange={(e) => setDbName(e.target.value)}
                    placeholder={t('builder.db.newDatabaseName')}
                    className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                  />
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={saveBinding}
                disabled={bindingSaving || (formMode === 'external' && (!serverId || !dbName))}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {t('builder.db.saveBinding')}
              </button>
              <button
                onClick={() => setShowBindingForm(false)}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 记录管理子视图 */}
      {activeModel && activeModelDef ? (
        <RecordsView appId={appId} model={activeModelDef} onBack={() => setActiveModel(null)} />
      ) : (
        <>
          {/* 模型表 */}
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-medium text-slate-800">
              {t('builder.db.modelsTitle', { n: overview?.models.length ?? 0 })}
            </h3>
            {!overview || overview.models.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">{t('builder.modelsEmpty')}</p>
            ) : (
              <ul className="space-y-2">
                {overview.models.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
                    <span className="text-sm text-slate-800">{m.name}</span>
                    <code className="text-[10px] text-slate-400">t_{m.id}</code>
                    <span className="text-[11px] text-slate-400">
                      {t('builder.db.fieldsCount', { n: (m.fields ?? []).length })} ·{' '}
                      {t('builder.db.recordCount', { n: m.recordCount })}
                    </span>
                    <button
                      onClick={() => setActiveModel(m.id)}
                      className="ml-auto rounded-md border border-slate-200 px-2 py-1 text-[11px] text-indigo-600 transition hover:bg-indigo-50"
                    >
                      {t('builder.db.manageRecords')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* DDL + 备份 */}
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={loadDdl}
                className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
              >
                {t('builder.db.viewDdl')}
              </button>
              <button
                onClick={() => window.open(`/api/apps/${appId}/db/backup`, '_blank')}
                className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
              >
                {t('builder.db.downloadBackup')}
              </button>
              {overview?.binding.mode === 'external' && (
                <span className="text-[11px] text-amber-600">{t('builder.db.backupExternalNote')}</span>
              )}
            </div>
            {ddl !== null && (
              <div className="mt-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-600">{t('builder.db.ddlTitle')}</span>
                  <span className="text-[10px] text-slate-400">sqlite</span>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(ddl);
                      setCopied(true);
                    }}
                    className="ml-auto rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50"
                  >
                    {copied ? t('builder.db.copied') : t('builder.db.copyDdl')}
                  </button>
                  <button
                    onClick={() => setDdl(null)}
                    className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50"
                  >
                    ✕
                  </button>
                </div>
                <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
                  {ddl}
                </pre>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/* ---------- 记录管理子视图 ---------- */
function RecordsView({
  appId,
  model,
  onBack,
}: {
  appId: string;
  model: { id: string; name: string; fields: BuilderSpecField[] };
  onBack: () => void;
}) {
  const { t } = useI18n();
  const fields = (model.fields ?? []).filter((f) => f.id !== 'id');
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<RecordRow | 'new' | null>(null);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
      if (q) params.set('q', q);
      const data = await apiFetch<{ records: RecordRow[]; total: number }>(
        `/apps/${appId}/data/${model.id}?${params}`,
      );
      setRows(data.records);
      setTotal(data.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [appId, model.id, page, q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: RecordRow) {
    if (!window.confirm(t('builder.db.deleteConfirm'))) return;
    try {
      await apiFetch(`/apps/${appId}/data/${model.id}/${row.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={onBack} className="text-xs text-slate-400 transition hover:text-slate-700">
          ← {t('builder.db.backToModels')}
        </button>
        <span className="text-sm font-medium text-slate-800">{model.name}</span>
        <span className="text-[11px] text-slate-400">{t('builder.db.recordCount', { n: total })}</span>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder={t('builder.db.searchPlaceholder')}
            className="w-40 rounded-md border border-slate-200 px-2 py-1 text-xs"
          />
          <button
            onClick={() => setEditing('new')}
            className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-indigo-500"
          >
            + {t('builder.db.addRecord')}
          </button>
        </div>
      </div>
      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      {loading ? (
        <p className="py-6 text-center text-xs text-slate-400">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">{t('builder.db.noRecords')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                {fields.map((f) => (
                  <th key={f.id} className="px-2 py-1.5 font-medium">
                    {String(f.label ?? f.name ?? f.id)}
                  </th>
                ))}
                <th className="px-2 py-1.5 font-medium">{t('builder.db.colUpdatedAt')}</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 text-slate-700">
                  {fields.map((f) => (
                    <td key={f.id} className="max-w-40 truncate px-2 py-1.5">
                      {String(row[f.id] ?? '')}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-400">
                    {new Date(row.updatedAt).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    <button onClick={() => setEditing(row)} className="mr-2 text-indigo-600 hover:underline">
                      {t('common.edit')}
                    </button>
                    <button onClick={() => void remove(row)} className="text-red-500 hover:underline">
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-slate-500">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="rounded border border-slate-200 px-2 py-0.5 disabled:opacity-40"
          >
            ←
          </button>
          <span>
            {page + 1} / {pages}
          </span>
          <button
            disabled={page >= pages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-slate-200 px-2 py-0.5 disabled:opacity-40"
          >
            →
          </button>
        </div>
      )}
      {editing !== null && (
        <RecordForm
          appId={appId}
          model={model}
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

/* ---------- 新增/编辑记录表单 ---------- */
function RecordForm({
  appId,
  model,
  row,
  onClose,
  onSaved,
}: {
  appId: string;
  model: { id: string; name: string; fields: BuilderSpecField[] };
  row: RecordRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const fields = (model.fields ?? []).filter((f) => f.id !== 'id');
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of fields) init[f.id] = row ? (row[f.id] ?? '') : '';
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setSaving(true);
    setError('');
    try {
      const body = JSON.stringify({ data: values });
      if (row) {
        await apiFetch(`/apps/${appId}/data/${model.id}/${row.id}`, { method: 'PUT', body });
      } else {
        await apiFetch(`/apps/${appId}/data/${model.id}`, { method: 'POST', body });
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 className="text-sm font-semibold text-slate-800">
          {row ? t('builder.db.editRecord') : t('builder.db.addRecord')} · {model.name}
        </h4>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {fields.map((f) => {
            const label = String(f.label ?? f.name ?? f.id);
            return (
              <div key={f.id} className="flex items-center gap-2">
                <label className="w-24 shrink-0 text-xs text-slate-500">
                  {label}
                  {f.required && <span className="text-red-400"> *</span>}
                </label>
                {f.type === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={values[f.id] === true || values[f.id] === 1}
                    onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.checked }))}
                  />
                ) : f.type === 'select' && Array.isArray(f.options) ? (
                  <select
                    value={String(values[f.id] ?? '')}
                    onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                    className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                  >
                    <option value="">-</option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    value={String(values[f.id] ?? '')}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [f.id]: f.type === 'number' ? e.target.value : e.target.value }))
                    }
                    className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
