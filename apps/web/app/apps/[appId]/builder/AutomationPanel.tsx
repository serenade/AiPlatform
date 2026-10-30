'use client';

/** Builder 自动化模块：workflow 规则配置（触发器+动作）+ 手动运行 */
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { panelId, saveSpec, type BuilderSpec, type SpecWorkflow } from './specSave';

interface RunResult {
  ok: boolean;
  results: Array<{ actionIndex: number; type: string; ok: boolean; detail: string }>;
  durationMs: number;
}

export function AutomationPanel({
  appId,
  spec,
  onSpecChanged,
}: {
  appId: string;
  spec: BuilderSpec | null;
  onSpecChanged: () => void;
}) {
  const { t } = useI18n();
  const items = (Array.isArray(spec?.workflows) ? spec!.workflows : []) as SpecWorkflow[];
  const models = spec?.models ?? [];
  const [editing, setEditing] = useState<SpecWorkflow | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<Record<string, RunResult>>({});

  function triggerText(wf: SpecWorkflow): string {
    const modelName = models.find((m) => m.id === wf.trigger?.modelId)?.name ?? wf.trigger?.modelId ?? '-';
    return wf.trigger?.type === 'record_updated'
      ? t('builder.auto.triggerUpdatedDesc', { model: modelName })
      : t('builder.auto.triggerCreatedDesc', { model: modelName });
  }

  function actionText(wf: SpecWorkflow): string {
    return (wf.actions ?? [])
      .map((a) =>
        a.type === 'webhook'
          ? `→ ${t('builder.auto.actionWebhook')}: ${
              ((Array.isArray(spec?.integrations) ? spec!.integrations : []) as Array<{ id: string; name: string }>).find(
                (i) => i.id === a.integrationId,
              )?.name ?? a.integrationId
            }`
          : `→ ${t('builder.auto.actionCreateRecord')}: ${models.find((m) => m.id === a.modelId)?.name ?? a.modelId}`,
      )
      .join('  ');
  }

  async function persist(next: SpecWorkflow[], message: string) {
    if (!spec) return;
    setSaving(true);
    setError('');
    try {
      await saveSpec(appId, { ...spec, workflows: next }, message);
      setSavedMsg(t('builder.auto.saved'));
      onSpecChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(wf: SpecWorkflow) {
    const next = items.map((i) => (i.id === wf.id ? { ...i, enabled: i.enabled === false } : i));
    await persist(next, `[builder] 更新自动化流程 ${wf.name}`);
  }

  async function remove(wf: SpecWorkflow) {
    if (!window.confirm(t('builder.auto.deleteConfirm'))) return;
    await persist(
      items.filter((i) => i.id !== wf.id),
      `[builder] 删除自动化流程 ${wf.name}`,
    );
  }

  async function run(wf: SpecWorkflow) {
    setRunning(wf.id);
    try {
      const res = await apiFetch<RunResult>(`/apps/${appId}/workflows/${wf.id}/run`, { method: 'POST' });
      setRunResults((prev) => ({ ...prev, [wf.id]: res }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{t('builder.module.automation')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('builder.auto.desc')}</p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500"
        >
          + {t('builder.auto.add')}
        </button>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      {savedMsg && !saving && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-600">{savedMsg}</p>}
      {saving && <p className="text-xs text-slate-400">{t('common.saving')}</p>}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center text-sm text-slate-400">
          {t('builder.auto.empty')}
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((wf) => {
            const rr = runResults[wf.id];
            return (
              <li key={wf.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{wf.name}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {triggerText(wf)}
                  </span>
                  <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-500">
                    <input
                      type="checkbox"
                      checked={wf.enabled !== false}
                      onChange={() => void toggleEnabled(wf)}
                      disabled={saving}
                    />
                    {t('builder.auto.enabled')}
                  </label>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-500">{actionText(wf)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => void run(wf)}
                    disabled={running === wf.id}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                  >
                    {running === wf.id ? t('builder.auto.running') : t('builder.auto.run')}
                  </button>
                  <button
                    onClick={() => setEditing(wf)}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50"
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    onClick={() => void remove(wf)}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] text-red-500 transition hover:bg-red-50"
                  >
                    {t('common.delete')}
                  </button>
                </div>
                {rr && (
                  <div
                    className={`mt-2 space-y-1 rounded-lg px-3 py-2 text-[11px] ${
                      rr.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    <span className="font-medium">
                      {rr.ok ? t('builder.auto.runOk') : t('builder.auto.runFailed')} · {rr.durationMs}ms
                    </span>
                    {rr.results.map((r) => (
                      <p key={r.actionIndex}>
                        #{r.actionIndex + 1} [{r.type}] {r.ok ? '✓' : '✕'} {r.detail}
                      </p>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing !== null && (
        <WorkflowForm
          appId={appId}
          spec={spec}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function WorkflowForm({
  appId,
  spec,
  initial,
  onClose,
}: {
  appId: string;
  spec: BuilderSpec | null;
  initial: SpecWorkflow | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const models = spec?.models ?? [];
  const integrations = (Array.isArray(spec?.integrations) ? spec!.integrations : []) as Array<{
    id: string;
    name: string;
  }>;
  const [name, setName] = useState(initial?.name ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled !== false);
  const [triggerType, setTriggerType] = useState<'record_created' | 'record_updated'>(
    initial?.trigger?.type ?? 'record_created',
  );
  const [triggerModel, setTriggerModel] = useState(initial?.trigger?.modelId ?? models[0]?.id ?? '');
  type Action = { key: string; type: 'webhook' | 'create_record'; integrationId: string; modelId: string; dataText: string };
  const [actions, setActions] = useState<Action[]>(
    (initial?.actions ?? []).map((a, idx) => ({
      key: `a${idx}`,
      type: a.type,
      integrationId: a.type === 'webhook' ? a.integrationId : '',
      modelId: a.type === 'create_record' ? a.modelId : models[0]?.id ?? '',
      dataText: a.type === 'create_record' ? JSON.stringify(a.data ?? {}, null, 2) : '{}',
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function addAction() {
    setActions((prev) => [
      ...prev,
      { key: `a${Date.now()}`, type: 'webhook', integrationId: integrations[0]?.id ?? '', modelId: models[0]?.id ?? '', dataText: '{}' },
    ]);
  }

  function updateAction(key: string, patch: Partial<Action>) {
    setActions((prev) => prev.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  }

  async function submit() {
    setError('');
    if (!name.trim()) {
      setError(t('builder.int.required'));
      return;
    }
    if (!triggerModel) {
      setError(t('builder.auto.needTriggerModel'));
      return;
    }
    const parsedActions: SpecWorkflow['actions'] = [];
    for (const a of actions) {
      if (a.type === 'webhook') {
        if (!a.integrationId) {
          setError(t('builder.auto.needIntegration'));
          return;
        }
        parsedActions.push({ type: 'webhook', integrationId: a.integrationId });
      } else {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(a.dataText || '{}');
        } catch {
          setError(t('builder.auto.invalidDataJson'));
          return;
        }
        if (!a.modelId) {
          setError(t('builder.auto.needTargetModel'));
          return;
        }
        parsedActions.push({ type: 'create_record', modelId: a.modelId, data });
      }
    }
    if (!spec) return;
    setSaving(true);
    const item: SpecWorkflow = {
      id: initial?.id ?? panelId('wf'),
      name: name.trim(),
      enabled,
      trigger: { type: triggerType, modelId: triggerModel },
      actions: parsedActions,
    };
    const list = (Array.isArray(spec.workflows) ? spec.workflows : []) as SpecWorkflow[];
    const next = initial ? list.map((i) => (i.id === initial.id ? item : i)) : [...list, item];
    try {
      await saveSpec(appId, { ...spec, workflows: next }, `[builder] 更新自动化流程 ${item.name}`);
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
        className="max-h-[85vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 className="text-sm font-semibold text-slate-800">
          {initial ? t('builder.auto.edit') : t('builder.auto.add')}
        </h4>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('builder.auto.namePlaceholder')}
            className="flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
          />
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-slate-500">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {t('builder.auto.enabled')}
          </label>
        </div>

        {/* 触发器 */}
        <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
          <p className="mb-2 text-xs font-medium text-slate-600">{t('builder.auto.trigger')}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={triggerType === 'record_created'} onChange={() => setTriggerType('record_created')} />
              {t('builder.auto.triggerCreated')}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={triggerType === 'record_updated'} onChange={() => setTriggerType('record_updated')} />
              {t('builder.auto.triggerUpdated')}
            </label>
            <select
              value={triggerModel}
              onChange={(e) => setTriggerModel(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
            >
              {models.length === 0 && <option value="">-</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 动作列表 */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600">{t('builder.auto.actions')}</p>
          {actions.map((a) => (
            <div key={a.key} className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
              <div className="flex items-center gap-2">
                <select
                  value={a.type}
                  onChange={(e) => updateAction(a.key, { type: e.target.value as Action['type'] })}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                >
                  <option value="webhook">{t('builder.auto.actionWebhook')}</option>
                  <option value="create_record">{t('builder.auto.actionCreateRecord')}</option>
                </select>
                <button
                  onClick={() => setActions((prev) => prev.filter((x) => x.key !== a.key))}
                  className="ml-auto text-[11px] text-red-500 hover:underline"
                >
                  {t('builder.auto.removeAction')}
                </button>
              </div>
              {a.type === 'webhook' ? (
                <select
                  value={a.integrationId}
                  onChange={(e) => updateAction(a.key, { integrationId: e.target.value })}
                  className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                >
                  <option value="">{t('builder.auto.actionIntegration')}</option>
                  {integrations.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="space-y-1.5">
                  <select
                    value={a.modelId}
                    onChange={(e) => updateAction(a.key, { modelId: e.target.value })}
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                  >
                    <option value="">{t('builder.auto.actionTargetModel')}</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={a.dataText}
                    onChange={(e) => updateAction(a.key, { dataText: e.target.value })}
                    placeholder={t('builder.auto.dataPlaceholder')}
                    rows={4}
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 font-mono text-[11px]"
                  />
                  <p className="text-[10px] text-slate-400">{t('builder.auto.dataHint')}</p>
                </div>
              )}
            </div>
          ))}
          <button
            onClick={addAction}
            className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
          >
            + {t('builder.auto.addAction')}
          </button>
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
