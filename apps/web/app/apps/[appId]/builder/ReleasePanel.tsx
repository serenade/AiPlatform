'use client';

/** Builder 发布中心：发布状态 / 发布与下架 / 运行入口 / spec 版本恢复 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { BuilderSpec } from './specSave';

interface AppDto {
  id: string;
  status: 'draft' | 'active';
  currentDraftSpecVersionId: string;
  currentPublishedVersionId: string | null;
}

interface SpecVersionRow {
  id: string;
  version: number;
  source: string;
  createdBy: string;
  createdAt: string;
}

export function ReleasePanel({
  appId,
  spec,
  onSpecChanged,
}: {
  appId: string;
  spec: BuilderSpec | null;
  onSpecChanged: () => void;
}) {
  const { t } = useI18n();
  const [app, setApp] = useState<AppDto | null>(null);
  const [versions, setVersions] = useState<SpecVersionRow[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      const [appDto, versionRows] = await Promise.all([
        apiFetch<AppDto>(`/apps/${appId}`),
        apiFetch<SpecVersionRow[]>(`/apps/${appId}/spec-versions`),
      ]);
      setApp(appDto);
      setVersions(versionRows);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      await fn();
      setMsg(message);
      await load();
      onSpecChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const publish = () =>
    action(
      () => apiFetch(`/apps/${appId}/publish`, { method: 'POST' }),
      t('builder.release.published'),
    );
  const unpublish = () => {
    if (!window.confirm(t('builder.release.unpublishConfirm'))) return;
    return action(
      () => apiFetch(`/apps/${appId}/unpublish`, { method: 'POST' }),
      t('builder.release.unpublished'),
    );
  };
  const restore = (v: number) => {
    if (!window.confirm(t('builder.release.restoreConfirm', { n: v }))) return;
    return action(
      () => apiFetch(`/apps/${appId}/spec-versions/${v}/restore`, { method: 'POST' }),
      t('builder.release.restored', { n: v }),
    );
  };

  function sourceLabel(s: string): string {
    const map: Record<string, string> = {
      manual: t('builder.release.sourceManual'),
      agent_patch: t('builder.release.sourceAgentPatch'),
      restore: t('builder.release.sourceRestore'),
    };
    return map[s] ?? s;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">{t('builder.module.release')}</h2>
        <p className="mt-1 text-xs text-slate-500">{t('builder.release.desc')}</p>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-600">{msg}</p>}

      {/* 发布状态 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-sm font-medium text-slate-800">
              {app?.status === 'active' ? t('builder.release.published') : t('builder.release.notPublished')}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {t('builder.release.currentDraft', {
                n: spec?._meta?.version ?? versions[0]?.version ?? 0,
              })}
              {app?.currentPublishedVersionId &&
                ` · ${t('builder.release.publishedVersion', {
                  n: versions.find((v) => v.id === app.currentPublishedVersionId)?.version ?? '-',
                })}`}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {app?.status === 'active' ? (
              <>
                <Link
                  href={`/apps/${appId}/run`}
                  target="_blank"
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500"
                >
                  {t('builder.release.runApp')} ↗
                </Link>
                <button
                  onClick={unpublish}
                  disabled={busy}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {t('builder.release.unpublish')}
                </button>
              </>
            ) : (
              <button
                onClick={publish}
                disabled={busy}
                className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
              >
                {t('builder.release.publish')}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 版本列表 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-800">
          {t('builder.release.versionsTitle', { n: versions.length })}
        </h3>
        {versions.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">{t('builder.release.versionsEmpty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {versions.map((v) => (
              <li
                key={v.id}
                className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
                  v.id === app?.currentDraftSpecVersionId ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-100'
                }`}
              >
                <span className="font-mono text-xs font-medium text-slate-700">v{v.version}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                  {sourceLabel(v.source)}
                </span>
                {v.id === app?.currentDraftSpecVersionId && (
                  <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-600">
                    {t('builder.release.draftTag')}
                  </span>
                )}
                {v.id === app?.currentPublishedVersionId && (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-600">
                    {t('builder.release.publishedTag')}
                  </span>
                )}
                <span className="text-[11px] text-slate-400">
                  {v.createdBy} · {new Date(v.createdAt).toLocaleString()}
                </span>
                {v.id !== app?.currentDraftSpecVersionId && (
                  <button
                    onClick={() => void restore(v.version)}
                    disabled={busy}
                    className="ml-auto text-[11px] text-amber-600 hover:underline disabled:opacity-40"
                  >
                    {t('builder.release.restore')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
