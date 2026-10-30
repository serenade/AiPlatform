'use client';

/** 平台设置 · 团队设置（需求3）：Skills 管理 / MCP 管理 / 智能能力（模型配置）。 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type Sub = 'skills' | 'mcp' | 'ai';

export function TeamPanel({ sub }: { sub: Sub }) {
  if (sub === 'skills') return <SkillsPanel />;
  if (sub === 'mcp') return <McpPanel />;
  return <AiProfilesPanel />;
}

/* ---------------- Skills ---------------- */
interface Skill {
  id: string;
  name: string;
  title: string;
  description: string | null;
  content: string;
  version: string;
  status: string;
}

function SkillsPanel() {
  const { t } = useI18n();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Skill | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ skills: Skill[] }>('/team/skills');
      setSkills(data.skills);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      const body = JSON.stringify(editing);
      if (editing.id) await apiFetch(`/team/skills/${editing.id}`, { method: 'PATCH', body });
      else await apiFetch('/team/skills', { method: 'POST', body });
      setEditing(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{t('sk.title')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('sk.desc')}</p>
        </div>
        <button
          onClick={() => setEditing({ id: '', name: '', title: '', description: '', content: t('sk.contentDefault'), version: '0.1.0', status: 'enabled' })}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700"
        >
          {t('sk.new')}
        </button>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

      {editing && (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <input required placeholder={t('sk.namePlaceholder')} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            <input required placeholder={t('sk.titlePlaceholder')} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            <input placeholder={t('sk.versionPlaceholder')} pattern="\d+\.\d+\.\d+" value={editing.version} onChange={(e) => setEditing({ ...editing, version: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none">
              <option value="enabled">{t('common.enabled')}</option>
              <option value="disabled">{t('common.disabled')}</option>
            </select>
          </div>
          <input placeholder={t('sk.descPlaceholder')} value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
          <textarea rows={8} placeholder={t('sk.contentPlaceholder')} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-indigo-500 focus:outline-none" />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50">
              {t('common.save')}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-600 transition hover:bg-slate-50">
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {skills.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-xs text-slate-400">{t('sk.empty')}</p>
        )}
        {skills.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-800">{s.title}</span>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{s.name}</code>
                <span className="text-[10px] text-slate-400">v{s.version}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${s.status === 'enabled' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                  {s.status === 'enabled' ? t('common.enabled') : t('common.disabled')}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-400">{s.description || '—'}</p>
            </div>
            <div className="flex shrink-0 gap-2 text-xs">
              <button onClick={() => setEditing(s)} className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600">
                {t('common.edit')}
              </button>
              <button
                onClick={async () => {
                  await apiFetch(`/team/skills/${s.id}`, { method: 'PATCH', body: JSON.stringify({ status: s.status === 'enabled' ? 'disabled' : 'enabled' }) });
                  await load();
                }}
                className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600"
              >
                {s.status === 'enabled' ? t('common.disabled') : t('common.enabled')}
              </button>
              <button
                onClick={async () => {
                  if (!confirm(t('sk.deleteConfirm'))) return;
                  await apiFetch(`/team/skills/${s.id}`, { method: 'DELETE' });
                  await load();
                }}
                className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-500 transition hover:border-red-300 hover:text-red-600"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- MCP ---------------- */
interface McpServer {
  id: string;
  slug: string;
  name: string;
  endpoint: string;
  headers: Record<string, string>;
  status: string;
  tools: { name: string; description?: string }[] | null;
  lastTestMessage: string | null;
}

function McpPanel() {
  const { t } = useI18n();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [busy, setBusy] = useState('');
  const [toolsOf, setToolsOf] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ servers: McpServer[] }>('/team/mcp');
      setServers(data.servers);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy('save');
    try {
      const body = JSON.stringify(editing);
      if (editing.id) await apiFetch(`/team/mcp/${editing.id}`, { method: 'PATCH', body });
      else await apiFetch('/team/mcp', { method: 'POST', body });
      setEditing(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function test(s: McpServer) {
    setBusy(`test-${s.id}`);
    try {
      await apiFetch(`/team/mcp/${s.id}/test`, { method: 'POST', body: JSON.stringify({}) });
      setToolsOf(s.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{t('mcp.title')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('mcp.desc')}</p>
        </div>
        <button
          onClick={() => setEditing({ id: '', slug: '', name: '', endpoint: '', headers: {}, status: 'untested', tools: null, lastTestMessage: null })}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700"
        >
          {t('mcp.new')}
        </button>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

      {editing && (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input required placeholder={t('mcp.slugPlaceholder')} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={editing.slug}
              onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            <input required placeholder={t('mcp.namePlaceholder')} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            <input required placeholder={t('mcp.endpointPlaceholder')} type="url" value={editing.endpoint}
              onChange={(e) => setEditing({ ...editing, endpoint: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          <input placeholder={t('mcp.headersPlaceholder')} value={JSON.stringify(editing.headers)}
            onChange={(e) => {
              try {
                setEditing({ ...editing, headers: JSON.parse(e.target.value || '{}') });
              } catch {
                /* 输入过程中容忍非法 JSON */
              }
            }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-indigo-500 focus:outline-none" />
          <div className="flex gap-2">
            <button type="submit" disabled={busy === 'save'} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50">
              {t('common.save')}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-600 transition hover:bg-slate-50">
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {servers.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-xs text-slate-400">{t('mcp.empty')}</p>
        )}
        {servers.map((s) => (
          <div key={s.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-800">{s.name}</span>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{s.slug}</code>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      s.status === 'ok' ? 'bg-emerald-50 text-emerald-600' : s.status === 'error' ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {s.status === 'ok' ? t('mcp.statusOk') : s.status === 'error' ? t('mcp.statusError') : t('mcp.statusUntested')}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-400">
                  {s.endpoint}
                  {s.lastTestMessage && ` · ${s.lastTestMessage}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                <button onClick={() => test(s)} disabled={busy === `test-${s.id}`}
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50">
                  {t('mcp.test')}
                </button>
                <button onClick={() => setEditing(s)} className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600">
                  {t('common.edit')}
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(t('mcp.deleteConfirm'))) return;
                    await apiFetch(`/team/mcp/${s.id}`, { method: 'DELETE' });
                    await load();
                  }}
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-500 transition hover:border-red-300 hover:text-red-600"
                >
                  {t('common.delete')}
                </button>
              </div>
            </div>
            {toolsOf === s.id && s.tools && s.tools.length > 0 && (
              <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3">
                <p className="text-[10px] font-medium uppercase text-slate-400">{t('mcp.tools', { n: s.tools.length })}</p>
                {s.tools.map((tool) => (
                  <div key={tool.name} className="text-xs text-slate-600">
                    <code className="rounded bg-white px-1">{tool.name}</code>
                    {tool.description && <span className="ml-2 text-slate-400">{tool.description}</span>}
                  </div>
                ))}
              </div>
            )}
            {toolsOf === s.id && s.status === 'ok' && (!s.tools || s.tools.length === 0) && (
              <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-400">{t('mcp.noTools')}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- AI Profiles ---------------- */
interface AiProfile {
  id: string;
  name: string;
  purpose: 'chat' | 'vision' | 'speech';
  provider: string;
  model: string;
  apiBase: string | null;
  hasApiKey: boolean;
  enabled: boolean;
  lastTestAt: string | null;
  lastTestMessage: string | null;
}

interface TestResult {
  ok: boolean;
  message: string;
  reply?: string | null;
  latencyMs?: number | null;
}

const PURPOSE_KEY: Record<string, string> = { chat: 'ai.purpose.chat', vision: 'ai.purpose.vision', speech: 'ai.purpose.speech' };

function AiProfilesPanel() {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<(AiProfile & { apiKey?: string }) | null>(null);
  const [busy, setBusy] = useState('');
  const [testResult, setTestResult] = useState<Record<string, TestResult>>({});

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ profiles: AiProfile[] }>('/team/ai-profiles');
      setProfiles(data.profiles);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy('save');
    try {
      const body = JSON.stringify(editing);
      if (editing.id) await apiFetch(`/team/ai-profiles/${editing.id}`, { method: 'PATCH', body });
      else await apiFetch('/team/ai-profiles', { method: 'POST', body });
      setEditing(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function test(p: AiProfile) {
    setBusy(`test-${p.id}`);
    try {
      const r = await apiFetch<TestResult>(`/team/ai-profiles/${p.id}/test`, { method: 'POST', body: JSON.stringify({}) });
      setTestResult((m) => ({ ...m, [p.id]: r }));
      await load();
    } catch (err) {
      setTestResult((m) => ({ ...m, [p.id]: { ok: false, message: (err as Error).message } }));
    } finally {
      setBusy('');
    }
  }

  async function activate(p: AiProfile) {
    setBusy(`activate-${p.id}`);
    try {
      await apiFetch(`/team/ai-profiles/${p.id}/activate`, { method: 'POST', body: JSON.stringify({}) });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{t('ai.title')}</h2>
          <p className="mt-1 text-xs text-slate-500">
            {t('ai.desc')}
          </p>
        </div>
        <button
          onClick={() => setEditing({ id: '', name: '', purpose: 'chat', provider: 'openai_compatible', model: '', apiBase: '', apiKey: '', hasApiKey: false, enabled: false, lastTestAt: null, lastTestMessage: null })}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700"
        >
          {t('ai.add')}
        </button>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

      {editing && (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <input required placeholder={t('ai.namePlaceholder')} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            <select value={editing.purpose} onChange={(e) => setEditing({ ...editing, purpose: e.target.value as AiProfile['purpose'] })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none">
              <option value="chat">{t('ai.purpose.chat')}</option>
              <option value="vision">{t('ai.purpose.vision')}</option>
              <option value="speech">{t('ai.purpose.speech')}</option>
            </select>
            <input required placeholder={t('ai.modelPlaceholder')} value={editing.model} onChange={(e) => setEditing({ ...editing, model: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            <input required placeholder={t('ai.endpointPlaceholder')} type="url" value={editing.apiBase ?? ''} onChange={(e) => setEditing({ ...editing, apiBase: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input type="password" placeholder={editing.hasApiKey ? t('ai.apiKeySaved') : 'API Key'} value={editing.apiKey ?? ''}
              onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            <p className="self-center text-xs text-slate-400">{t('ai.formHint')}</p>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy === 'save'} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50">
              {t('common.save')}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-600 transition hover:bg-slate-50">
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {profiles.length === 0 && (
          <p className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-xs text-slate-400">
            {t('ai.empty')}
          </p>
        )}
        {profiles.map((p) => {
          const tr = testResult[p.id];
          return (
            <div key={p.id} className={`rounded-xl border bg-white p-4 ${p.enabled ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-800">{p.name}</span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600">{t(PURPOSE_KEY[p.purpose] ?? p.purpose)}</span>
                  {p.enabled && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">{t('ai.defaultBadge')}</span>}
                </div>
                <div className="flex gap-2 text-xs">
                  <button
                    onClick={() => activate(p)}
                    disabled={busy === `activate-${p.id}` || p.enabled}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 transition hover:border-emerald-400 hover:text-emerald-600 disabled:opacity-40"
                  >
                    {p.enabled ? t('ai.enabledBtn') : t('ai.setDefault')}
                  </button>
                  <button onClick={() => test(p)} disabled={busy === `test-${p.id}`}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50">
                    {busy === `test-${p.id}` ? t('common.testing') : t('common.test')}
                  </button>
                  <button onClick={() => setEditing({ ...p, apiKey: '' })} className="text-slate-500 transition hover:text-indigo-600">
                    {t('common.edit')}
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(t('ai.deleteConfirm'))) return;
                      await apiFetch(`/team/ai-profiles/${p.id}`, { method: 'DELETE' });
                      await load();
                    }}
                    className="text-slate-500 transition hover:text-red-600"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
              <p className="mt-1.5 font-mono text-xs text-slate-500">{p.model}</p>
              <p className="text-xs text-slate-400">
                {p.apiBase || t('builder.models.noEndpoint')} · {p.hasApiKey ? t('ai.keyConfigured') : t('ai.keyMissing')}
              </p>
              {(tr || p.lastTestMessage) && (
                <p className={`mt-2 rounded-lg px-2.5 py-1.5 text-xs ${tr ? (tr.ok ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500') : 'bg-slate-50 text-slate-500'}`}>
                  {tr ? (
                    <>
                      {tr.message}
                      {tr.reply ? ` · ${t('ai.reply')}${tr.reply}` : ''}
                    </>
                  ) : (
                    `${t('ai.lastTest')}${p.lastTestMessage}`
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
