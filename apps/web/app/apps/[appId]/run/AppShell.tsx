'use client';

/**
 * 极简应用运行时壳（需求4）：按 AppSpec 渲染导航与 table 页面，
 * 数据走平台 appdata 接口（私有 SQLite 或外部专属库）；壳内带浮动 AI 调度。
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { isDraftChanged, isPreviewSearch, resolvePageId } from '@/lib/preview';
import { LangToggle, useI18n } from '@/lib/i18n';
import { FloatingAI } from '@/components/FloatingAI';

interface SpecField {
  id: string;
  name?: string;
  label?: string;
  type: string;
  options?: string[];
}

interface SpecModel {
  id: string;
  name: string;
  fields: SpecField[];
}

interface AppSpec {
  app?: { name?: string; description?: string };
  models: SpecModel[];
  pages: Array<{ id: string; title: string; type: string; modelId?: string }>;
  navigation: { items: Array<{ id: string; label: string; pageId: string }> };
  _meta?: { version: number; specVersionId?: string };
}

type RecordRow = Record<string, unknown>;

export function AppShell({ appId }: { appId: string }) {
  const { t } = useI18n();
  const [spec, setSpec] = useState<AppSpec | null>(null);
  const [appName, setAppName] = useState('');
  const [pageId, setPageId] = useState<string | null>(null);
  const [error, setError] = useState('');
  // 预览模式（?preview=1，Builder 顶栏打开）：展示草稿实时效果，轮询草稿 spec 自动同步变更
  const [preview, setPreview] = useState(false);
  const specVerRef = useRef<string | null>(null);

  const loadSpec = useCallback(async () => {
    try {
      const [app, specData] = await Promise.all([
        apiFetch<{ name: string }>(`/apps/${appId}`),
        apiFetch<AppSpec>(`/apps/${appId}/spec`),
      ]);
      setAppName(app.name);
      setSpec(specData);
      specVerRef.current = specData._meta?.specVersionId ?? null;
      const nav = specData.navigation?.items ?? [];
      setPageId(nav[0]?.pageId ?? specData.pages?.[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [appId]);

  useEffect(() => {
    void loadSpec();
  }, [loadSpec]);

  useEffect(() => {
    if (!isPreviewSearch(window.location.search)) return;
    setPreview(true);
    const timer = setInterval(async () => {
      try {
        const data = await apiFetch<AppSpec>(`/apps/${appId}/spec`);
        const ver = data._meta?.specVersionId ?? null;
        if (!isDraftChanged(specVerRef.current, ver)) return; // 草稿无变化
        specVerRef.current = ver;
        setSpec(data);
        setError('');
        setPageId((pid) => resolvePageId(data, pid));
      } catch {
        /* 轮询失败静默，下轮重试 */
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [appId]);

  const currentPage = spec?.pages?.find((p) => p.id === pageId) ?? null;

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <Link href="/apps" className="text-sm text-slate-400 transition hover:text-slate-700">
          {t('builder.back')}
        </Link>
        <span className="text-sm font-semibold text-slate-800">{appName || '…'}</span>
        {preview ? (
          <>
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-600">
              {t('run.previewBadge')}
            </span>
            <span className="hidden text-[11px] text-slate-400 md:inline">{t('run.previewHint')}</span>
          </>
        ) : (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
            {t('run.running')}
          </span>
        )}
        {spec?._meta?.version !== undefined && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">spec v{spec._meta.version}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <LangToggle />
          {preview && (
            <button
              onClick={() => void loadSpec()}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition hover:border-violet-300 hover:text-violet-600"
            >
              {t('run.refreshNow')}
            </button>
          )}
          <Link
            href={`/apps/${appId}/builder`}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
          >
            {t('run.openBuilder')}
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 应用导航（spec.navigation） */}
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-slate-200 bg-white p-2">
          {(spec?.navigation?.items ?? []).length === 0 && (spec?.pages?.length ?? 0) === 0 ? (
            <p className="px-3 py-6 text-xs text-slate-400">
              {t('run.pagesEmpty')}
            </p>
          ) : (
            (spec?.navigation?.items ?? spec!.pages.map((p) => ({ id: p.id, label: p.title, pageId: p.id }))).map((n) => {
              const page = spec!.pages.find((p) => p.id === n.pageId);
              return (
                <button
                  key={n.id}
                  onClick={() => setPageId(n.pageId)}
                  className={`rounded-lg px-3 py-2 text-left text-sm transition ${
                    pageId === n.pageId
                      ? 'bg-indigo-50 font-medium text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {page?.type === 'table' ? '▦ ' : '§ '}
                  {n.label}
                </button>
              );
            })
          )}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto p-5">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
          {!spec ? (
            <div className="py-24 text-center text-sm text-slate-400">{t('common.loading')}</div>
          ) : currentPage ? (
            currentPage.type === 'table' && currentPage.modelId ? (
              <ModelTable appId={appId} model={spec.models.find((m) => m.id === currentPage.modelId) ?? null} />
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-6">
                <h2 className="text-sm font-semibold text-slate-800">{currentPage.title}</h2>
                <p className="mt-2 text-xs text-slate-400">{t('run.pageSimplified', { type: currentPage.type })}</p>
              </div>
            )
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-24 text-center text-sm text-slate-400">
              {t('run.selectPage')}
            </div>
          )}
        </main>
      </div>

      {/* 壳内浮动 AI：可调度当前应用的数据功能 */}
      <FloatingAI appId={appId} onSpecChanged={loadSpec} hint={t('run.aiHint')} />
    </div>
  );
}

function ModelTable({ appId, model }: { appId: string; model: SpecModel | null }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RecordRow>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!model) return;
    setLoading(true);
    try {
      const data = await apiFetch<{ records: RecordRow[]; total: number }>(
        `/apps/${appId}/data/${model.id}${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      );
      setRows(data.records);
      setTotal(data.total);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [appId, model, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo(() => (model?.fields ?? []).slice(0, 6), [model]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!model) return;
    try {
      await apiFetch(`/apps/${appId}/data/${model.id}`, { method: 'POST', body: JSON.stringify({ data: form }) });
      setForm({});
      setShowForm(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: unknown) {
    if (!model || !confirm(t('run.deleteConfirm'))) return;
    try {
      await apiFetch(`/apps/${appId}/data/${model.id}/${String(id)}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!model) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center text-sm text-slate-400">
        {t('run.modelMissing')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{model.name}</h2>
          <p className="mt-0.5 text-xs text-slate-400">{t('run.totalRecords', { n: total })}</p>
        </div>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('run.searchPlaceholder')}
            className="w-44 rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-indigo-400 focus:outline-none"
          />
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700"
          >
            {showForm ? t('common.cancel') : t('run.newRecordBtn')}
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

      {showForm && (
        <form onSubmit={create} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
          {model.fields.map((f) => (
            <FieldInput key={f.id} field={f} value={form[f.id]} onChange={(v) => setForm({ ...form, [f.id]: v })} />
          ))}
          <div className="sm:col-span-3">
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-700">
              {t('common.save')}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-500">
              {columns.map((f) => (
                <th key={f.id} className="px-4 py-2.5 font-medium">
                  {f.name ?? f.label ?? f.id}
                </th>
              ))}
              <th className="px-4 py-2.5 text-right font-medium">{t('run.operations')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-xs text-slate-400">
                  {t('common.loading')}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-xs text-slate-400">
                  {t('run.noRecords')}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={String(r.id)} className="border-b border-slate-50 last:border-0">
                  {columns.map((f) => (
                    <td key={f.id} className="px-4 py-2.5 text-slate-700">
                      {renderCell(r[f.id], f.type)}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => remove(r.id)} className="text-xs text-slate-400 transition hover:text-red-600">
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: SpecField; value: unknown; onChange: (v: unknown) => void }) {
  const label = field.name ?? field.label ?? field.id;
  const cls = 'rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none';
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  }
  if (field.type === 'select' && field.options?.length) {
    return (
      <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={cls}>
        <option value="">{label}…</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      placeholder={label}
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      className={cls}
    />
  );
}

function renderCell(v: unknown, type: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (type === 'checkbox') return v === 1 || v === true ? '✓' : '—';
  if (type === 'relation') return String(v).slice(0, 12);
  return String(v);
}
