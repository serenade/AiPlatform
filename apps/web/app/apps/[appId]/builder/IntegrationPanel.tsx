'use client';

/** Builder 集成模块：Webhook/API 集成配置管理 + 服务端连通性测试 */
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { panelId, saveSpec, type BuilderSpec, type SpecIntegration } from './specSave';

interface TestResult {
  ok: boolean;
  status: number | null;
  durationMs: number;
  message: string;
}

export function IntegrationPanel({
  appId,
  spec,
  onSpecChanged,
}: {
  appId: string;
  spec: BuilderSpec | null;
  onSpecChanged: () => void;
}) {
  const { t } = useI18n();
  const items = (Array.isArray(spec?.integrations) ? spec!.integrations : []) as SpecIntegration[];
  const [editing, setEditing] = useState<SpecIntegration | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  async function persist(next: SpecIntegration[], message: string) {
    if (!spec) return;
    setSaving(true);
    setError('');
    try {
      await saveSpec(appId, { ...spec, integrations: next }, message);
      setSavedMsg(t('builder.int.saved'));
      onSpecChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(item: SpecIntegration) {
    const next = items.map((i) => (i.id === item.id ? { ...i, enabled: i.enabled === false } : i));
    await persist(next, `[builder] 更新集成配置 ${item.name}`);
  }

  async function remove(item: SpecIntegration) {
    if (!window.confirm(t('builder.int.deleteConfirm'))) return;
    await persist(
      items.filter((i) => i.id !== item.id),
      `[builder] 删除集成 ${item.name}`,
    );
  }

  async function test(item: SpecIntegration) {
    setTesting(item.id);
    try {
      const res = await apiFetch<TestResult>(`/apps/${appId}/integrations/${item.id}/test`, { method: 'POST' });
      setTestResults((prev) => ({ ...prev, [item.id]: res }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [item.id]: { ok: false, status: null, durationMs: 0, message: (err as Error).message },
      }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{t('builder.module.integration')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('builder.int.desc')}</p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500"
        >
          + {t('builder.int.add')}
        </button>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      {savedMsg && !saving && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-600">{savedMsg}</p>}
      {saving && <p className="text-xs text-slate-400">{t('common.saving')}</p>}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center text-sm text-slate-400">
          {t('builder.int.empty')}
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const tr = testResults[item.id];
            return (
              <li key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      item.type === 'webhook' ? 'bg-violet-50 text-violet-600' : 'bg-sky-50 text-sky-600'
                    }`}
                  >
                    {item.type === 'webhook' ? t('builder.int.typeWebhook') : t('builder.int.typeApi')}
                  </span>
                  <span className="text-sm font-medium text-slate-800">{item.name}</span>
                  <code className="truncate text-[11px] text-slate-400">
                    {(item.method ?? (item.type === 'webhook' ? 'POST' : 'GET')).toUpperCase()} {item.url}
                  </code>
                  <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-500">
                    <input
                      type="checkbox"
                      checked={item.enabled !== false}
                      onChange={() => void toggleEnabled(item)}
                      disabled={saving}
                    />
                    {t('builder.int.enabled')}
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => void test(item)}
                    disabled={testing === item.id || item.enabled === false}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                  >
                    {testing === item.id ? t('builder.int.testing') : t('builder.int.test')}
                  </button>
                  <button
                    onClick={() => setEditing(item)}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50"
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    onClick={() => void remove(item)}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] text-red-500 transition hover:bg-red-50"
                  >
                    {t('common.delete')}
                  </button>
                  {tr && (
                    <span
                      className={`ml-auto text-[11px] ${
                        tr.ok ? 'text-emerald-600' : 'text-red-500'
                      }`}
                    >
                      {tr.ok ? t('builder.int.testOk') : t('builder.int.testFailed')} ·{' '}
                      {tr.status ?? '-'} · {tr.durationMs}ms · {tr.message}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing !== null && (
        <IntegrationForm
          appId={appId}
          spec={spec}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function IntegrationForm({
  appId,
  spec,
  initial,
  onClose,
}: {
  appId: string;
  spec: BuilderSpec | null;
  initial: SpecIntegration | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<'webhook' | 'api'>(initial?.type ?? 'webhook');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [method, setMethod] = useState(initial?.method ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!name.trim() || !url.trim()) {
      setError(t('builder.int.required'));
      return;
    }
    try {
      new URL(url);
    } catch {
      setError(t('builder.int.invalidUrl'));
      return;
    }
    if (!spec) return;
    setSaving(true);
    const list = (Array.isArray(spec.integrations) ? spec.integrations : []) as SpecIntegration[];
    const item: SpecIntegration = {
      id: initial?.id ?? panelId('int'),
      name: name.trim(),
      type,
      url: url.trim(),
      method: method.trim() || undefined,
      enabled: initial?.enabled ?? true,
    };
    const next = initial ? list.map((i) => (i.id === initial.id ? item : i)) : [...list, item];
    try {
      await saveSpec(appId, { ...spec, integrations: next }, `[builder] 更新集成配置 ${item.name}`);
      onClose();
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
          {initial ? t('builder.int.edit') : t('builder.int.add')}
        </h4>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
        <div className="space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('builder.int.namePlaceholder')}
            className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
          />
          <div className="flex gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'webhook' | 'api')}
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            >
              <option value="webhook">{t('builder.int.typeWebhook')}</option>
              <option value="api">{t('builder.int.typeApi')}</option>
            </select>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            >
              <option value="">{t('builder.int.methodAuto')}</option>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('builder.int.urlPlaceholder')}
            className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-xs"
          />
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
