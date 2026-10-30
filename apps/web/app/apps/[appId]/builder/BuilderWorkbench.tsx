'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { LangToggle, useI18n } from '@/lib/i18n';
import { ChatPanel } from './ChatPanel';
import { FloatingAI } from '@/components/FloatingAI';
import { DatabasePanel } from './DatabasePanel';
import { IntegrationPanel } from './IntegrationPanel';
import { AutomationPanel } from './AutomationPanel';
import { ReleasePanel } from './ReleasePanel';
import { UsersPanel } from './UsersPanel';
import type { BuilderSpec } from './specSave';

interface AppDto {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active';
  aiProfileId: string | null;
}

const MODULES = ['workbench', 'models', 'database', 'integration', 'automation', 'release', 'users', 'config'] as const;
type ModuleKey = (typeof MODULES)[number];

/* ---------- 模型选择（需求3）：为本应用选择 AI 对话使用的模型（平台「智能能力/模型配置」中配置） ---------- */
interface AiProfileLite {
  id: string;
  name: string;
  purpose: string;
  model: string;
  apiBase: string | null;
  enabled: boolean;
}

function ModelSelectPanel({
  appId,
  currentProfileId,
  onChanged,
}: {
  appId: string;
  currentProfileId: string | null;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<AiProfileLite[] | null>(null);
  const [selected, setSelected] = useState<string | null>(currentProfileId);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ profiles: AiProfileLite[] }>('/team/ai-profiles');
      setProfiles(data.profiles.filter((p) => p.purpose === 'chat'));
    } catch {
      setProfiles([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelected(currentProfileId);
  }, [currentProfileId]);

  async function save(profileId: string | null) {
    setSaving(true);
    setMessage('');
    try {
      await apiFetch(`/apps/${appId}`, {
        method: 'PATCH',
        body: JSON.stringify({ aiProfileId: profileId }),
      });
      setSelected(profileId);
      setMessage(profileId ? t('builder.models.savedApp') : t('builder.models.savedFollow'));
      onChanged();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">{t('builder.module.models')}</h2>
        <p className="mt-1 text-xs text-slate-500">{t('builder.models.desc')}</p>
      </div>
      {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-600">{message}</p>}

      {profiles === null ? (
        <div className="py-12 text-center text-sm text-slate-400">{t('common.loading')}</div>
      ) : (
        <div className="space-y-2">
          <label
            className={`flex cursor-pointer items-center gap-3 rounded-xl border bg-white px-4 py-3 transition ${
              selected === null ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="ai-profile"
              checked={selected === null}
              onChange={() => save(null)}
              disabled={saving}
            />
            <div>
              <p className="text-sm font-medium text-slate-800">{t('builder.models.follow')}</p>
              <p className="text-xs text-slate-400">{t('builder.models.followDesc')}</p>
            </div>
          </label>

          {profiles.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-xs text-slate-400">
              {t('builder.models.empty')}
            </p>
          )}

          {profiles.map((p) => (
            <label
              key={p.id}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border bg-white px-4 py-3 transition ${
                selected === p.id ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="ai-profile"
                checked={selected === p.id}
                onChange={() => save(p.id)}
                disabled={saving}
              />
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  {p.name}
                  {p.enabled && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                      {t('builder.models.platformDefault')}
                    </span>
                  )}
                </p>
                <p className="truncate font-mono text-xs text-slate-400">
                  {p.model} · {p.apiBase || t('builder.models.noEndpoint')}
                </p>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function BuilderWorkbench({ appId }: { appId: string }) {
  const { t } = useI18n();
  const [app, setApp] = useState<AppDto | null>(null);
  const [spec, setSpec] = useState<BuilderSpec | null>(null);
  const [module, setModule] = useState<ModuleKey>('workbench');
  const [showJson, setShowJson] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const loadSpec = useCallback(async () => {
    try {
      const [appDto, specData] = await Promise.all([
        apiFetch<AppDto>(`/apps/${appId}`),
        apiFetch<BuilderSpec>(`/apps/${appId}/spec`),
      ]);
      setApp(appDto);
      setSpec(specData);
    } catch {
      /* 401 已跳转 */
    }
  }, [appId]);

  useEffect(() => {
    loadSpec();
  }, [loadSpec]);

  async function handlePublish() {
    setPublishing(true);
    try {
      await apiFetch(`/apps/${appId}/publish`, { method: 'POST' });
      await loadSpec();
    } catch {
      /* ignore */
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      {/* 顶栏 */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <Link href="/apps" className="text-sm text-slate-400 transition hover:text-slate-700">
          {t('builder.back')}
        </Link>
        <span className="text-sm font-semibold text-slate-800">{app?.name ?? '…'}</span>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600">
          {t('builder.development')}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
          {t('builder.specVersion')}{spec?._meta?.version ?? '-'} · {spec?.specVersion ?? ''}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <LangToggle />
          {/* 实时预览：运行页读取草稿 spec，新窗口打开即可看到最新变更 */}
          <button
            onClick={() => window.open(`/apps/${appId}/run?preview=1`, '_blank')}
            title={t('builder.previewTip')}
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-100"
          >
            {t('builder.preview')}
          </button>
          {app?.status === 'active' ? (
            <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-600">
              {t('builder.published')}
            </span>
          ) : (
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-60"
            >
              {publishing ? t('builder.publishing') : t('builder.publish')}
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左侧模块导航 */}
        <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-slate-200 bg-white p-2">
          {MODULES.map((m) => (
            <button
              key={m}
              onClick={() => setModule(m)}
              className={`rounded-lg px-3 py-2 text-left text-sm transition ${
                module === m
                  ? 'bg-indigo-50 font-medium text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t(`builder.module.${m}`)}
            </button>
          ))}
        </nav>

        {/* 中央工作区 */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50 p-5">
          {module === 'models' ? (
            <ModelSelectPanel appId={appId} currentProfileId={app?.aiProfileId ?? null} onChanged={loadSpec} />
          ) : module === 'database' ? (
            <DatabasePanel appId={appId} spec={spec} onSpecChanged={loadSpec} />
          ) : module === 'integration' ? (
            <IntegrationPanel appId={appId} spec={spec} onSpecChanged={loadSpec} />
          ) : module === 'automation' ? (
            <AutomationPanel appId={appId} spec={spec} onSpecChanged={loadSpec} />
          ) : module === 'release' ? (
            <ReleasePanel appId={appId} spec={spec} onSpecChanged={loadSpec} />
          ) : module === 'users' ? (
            <UsersPanel appId={appId} spec={spec} onSpecChanged={loadSpec} />
          ) : spec === null ? (
            <div className="py-24 text-center text-sm text-slate-400">{t('common.loading')}</div>
          ) : showJson ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{t('builder.json')}</span>
                <button
                  onClick={() => setShowJson(false)}
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
                >
                  {t('builder.cardView')}
                </button>
              </div>
              <pre className="max-h-[70vh] overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
                {JSON.stringify(
                  { ...spec, _meta: undefined },
                  null,
                  2,
                )}
              </pre>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">{t('builder.overview')}</h2>
                <button
                  onClick={() => setShowJson(true)}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
                >
                  {t('builder.viewJson')}
                </button>
              </div>

              <section>
                <h3 className="mb-2 text-xs font-medium text-slate-400">{t('builder.modelsCount', { n: spec.models.length })}</h3>
                {spec.models.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-xs text-slate-400">
                    {t('builder.modelsEmpty')}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {spec.models.map((m) => (
                      <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-slate-800">{m.name}</span>
                          <code className="text-[10px] text-slate-400">{m.id}</code>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(m.fields ?? []).map((f) => (
                            <span
                              key={String(f.id)}
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
                            >
                              {String(f.name)}
                              <span className="ml-1 text-slate-400">{String(f.type)}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-medium text-slate-400">{t('builder.pagesCount', { n: spec.pages.length })}</h3>
                {spec.pages.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-xs text-slate-400">
                    {t('builder.pagesEmpty')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {spec.pages.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-xs">
                          {p.type === 'table' ? '▦' : '§'}
                        </span>
                        <span className="text-sm text-slate-800">{p.title}</span>
                        <code className="text-[10px] text-slate-400">{p.id}</code>
                        {p.modelId && (
                          <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                            {p.modelId}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-medium text-slate-400">
                  {t('builder.navCount', { n: spec.navigation.items.length })}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {spec.navigation.items.length === 0 ? (
                    <span className="text-xs text-slate-400">{t('builder.navEmpty')}</span>
                  ) : (
                    spec.navigation.items.map((n) => (
                      <span
                        key={n.id}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700"
                      >
                        {n.label}
                      </span>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </main>

        {/* 右侧 AI 对话栏 */}
        <aside className="hidden w-96 shrink-0 lg:block">
          <ChatPanel appId={appId} onSpecChanged={loadSpec} />
        </aside>
      </div>

      {/* 浮动 AI 调度球（需求4）：小窗对话，工具作用域限定当前应用；上移 48px 避让右侧对话栏 */}
      <FloatingAI appId={appId} onSpecChanged={loadSpec} liftPx={48} />
    </div>
  );
}
