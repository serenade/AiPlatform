'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { applyProposal, chatkitStream, fetchProposal, fetchThreadMessages, Proposal, ThreadMessage } from '@/lib/chatkit-client';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
}

interface Revision {
  hash: string;
  committedAt: string;
  message: string;
  source: string;
  threadId: string | null;
}

export function ChatPanel({ appId, onSpecChanged }: { appId: string; onSpecChanged: () => void }) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [revLoading, setRevLoading] = useState(false);
  const [revError, setRevError] = useState('');
  // 只读浏览历史会话：记录对应版本项与拉取到的消息
  const [browse, setBrowse] = useState<{ title: string } | null>(null);
  const [browseMsgs, setBrowseMsgs] = useState<ThreadMessage[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const browseThreadRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, proposal]);

  const loadHistory = useCallback(async () => {
    setRevLoading(true);
    setRevError('');
    try {
      const data = await apiFetch<{ revisions: Revision[] }>(`/apps/${appId}/revisions`);
      setRevisions(data.revisions ?? []);
    } catch (e) {
      setRevError((e as Error).message || t('versions.loadFailed'));
    } finally {
      setRevLoading(false);
    }
  }, [appId, t]);

  function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next) void loadHistory();
  }

  /** 打开只读会话浏览弹层：按版本的 threadId 拉取该会话全部消息。 */
  async function openBrowse(r: Revision) {
    if (!r.threadId) return;
    const title = r.message.replace(/\s*\[thread:[^\]]+\]/g, '').trim() || t('chat.title');
    browseThreadRef.current = r.threadId;
    setBrowse({ title });
    setBrowseMsgs([]);
    setBrowseError('');
    setBrowseLoading(true);
    try {
      const msgs = await fetchThreadMessages(r.threadId);
      if (browseThreadRef.current === r.threadId) setBrowseMsgs(msgs);
    } catch (e) {
      if (browseThreadRef.current === r.threadId) setBrowseError((e as Error).message);
    } finally {
      if (browseThreadRef.current === r.threadId) setBrowseLoading(false);
    }
  }

  function closeBrowse() {
    browseThreadRef.current = null;
    setBrowse(null);
    setBrowseMsgs([]);
    setBrowseError('');
  }

  async function restore(hash: string) {
    if (!confirm(t('versions.restoreConfirm'))) return;
    try {
      await apiFetch(`/apps/${appId}/revisions/${hash}/restore`, { method: 'POST' });
      onSpecChanged();
      void loadHistory();
    } catch (e) {
      setRevError((e as Error).message);
    }
  }

  async function undoSession() {
    if (!threadId) return;
    if (!confirm(t('versions.undoConfirm'))) return;
    try {
      await apiFetch(`/apps/${appId}/sessions/${encodeURIComponent(threadId)}/undo`, { method: 'POST' });
      onSpecChanged();
      void loadHistory();
    } catch (e) {
      setRevError((e as Error).message);
    }
  }

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      setError(null);
      setProposal(null);
      setBusy(true);
      setInput('');
      setMessages((m) => [
        ...m,
        { role: 'user', text },
        { role: 'assistant', text: '', streaming: true },
      ]);

      let newThreadId = threadId;
      try {
        await chatkitStream(appId, threadId, text, (ev) => {
          if (ev.type === 'thread.created') {
            newThreadId = (ev.thread as { id: string }).id;
            setThreadId(newThreadId);
          } else if (ev.type === 'thread.item.updated') {
            const update = ev.update as { type: string; delta?: string };
            if (update?.type === 'assistant_message.content_part.text_delta' && update.delta) {
              setMessages((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                copy[copy.length - 1] = { ...last, text: last.text + update.delta };
                return copy;
              });
            }
          }
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : t('chat.failed'));
      }

      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, streaming: false };
        return copy;
      });
      setBusy(false);

      // 流结束后拉取 SpecPatch 提案
      if (newThreadId) {
        try {
          const p = await fetchProposal(newThreadId);
          if (p && p.status === 'pending') setProposal(p);
        } catch {
          /* 提案拉取失败不影响对话 */
        }
      }
    },
    [appId, threadId, busy, t],
  );

  async function handleApply() {
    if (!proposal || !threadId) return;
    setApplying(true);
    setError(null);
    try {
      await applyProposal(appId, threadId);
      setProposal(null);
      onSpecChanged();
      if (showHistory) void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('chat.applyFailed'));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="flex h-full flex-col border-l border-slate-200 bg-white">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-100 px-4">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-indigo-100 text-[10px] text-indigo-600">
          AI
        </span>
        <span className="text-sm font-medium text-slate-700">{t('chat.title')}</span>
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-400">
          {threadId ? threadId.slice(0, 14) : t('chat.newThread')}
        </span>
        <button
          onClick={toggleHistory}
          title={t('chat.history')}
          className={`rounded-md px-2 py-1 text-xs transition ${
            showHistory ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
          }`}
        >
          ⟲ {t('chat.history')}
        </button>
      </div>

      {showHistory && (
        <div className="max-h-72 shrink-0 overflow-y-auto border-b border-slate-100 bg-slate-50/70 p-3">
          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={undoSession}
              disabled={!threadId}
              className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 transition hover:bg-amber-100 disabled:opacity-40"
            >
              {t('versions.undoSession')}
            </button>
            <button
              onClick={() => window.open(`/api/apps/${appId}/db/backup`, '_blank')}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50"
            >
              {t('versions.backup')}
            </button>
            {revLoading && <span className="text-[11px] text-slate-400">…</span>}
          </div>
          {revError && <p className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-600">{revError}</p>}
          {revisions.length === 0 && !revLoading && !revError && (
            <p className="py-3 text-center text-[11px] text-slate-400">{t('versions.empty')}</p>
          )}
          <ul className="space-y-1.5">
            {revisions.map((r) => (
              <li key={r.hash} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      r.source === 'agent'
                        ? 'bg-indigo-50 text-indigo-600'
                        : r.source === 'restore' || r.source === 'undo-session'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {t(`versions.source.${r.source}`)}
                  </span>
                  <span className="truncate text-[11px] text-slate-600" title={r.message}>
                    {r.message.replace(/\s*\[thread:[^\]]+\]/g, '')}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                  <span>{new Date(r.committedAt).toLocaleString()}</span>
                  <span className="font-mono">{r.hash.slice(0, 8)}</span>
                  <span className="ml-auto flex gap-2">
                    <button
                      onClick={() => void openBrowse(r)}
                      disabled={!r.threadId}
                      title={r.threadId ? t('versions.browse') : t('versions.noSession')}
                      className="text-slate-500 transition hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-slate-500"
                    >
                      {t('versions.browse')}
                    </button>
                    <button
                      onClick={() => window.open(`/api/apps/${appId}/revisions/${r.hash}/export`, '_blank')}
                      className="text-slate-500 transition hover:text-indigo-600"
                    >
                      {t('versions.export')}
                    </button>
                    <button
                      onClick={() => restore(r.hash)}
                      className="text-slate-500 transition hover:text-amber-600"
                    >
                      {t('versions.restore')}
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="pt-6 text-center">
            <p className="text-sm text-slate-400">{t('chat.intro')}</p>
            <div className="mt-4 space-y-2">
              {[t('chat.suggest1'), t('chat.suggest2'), t('chat.suggest3')].map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-xs text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-800'
              }`}
            >
              {m.text}
              {m.streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-indigo-400 align-middle" />}
            </div>
          </div>
        ))}

        {proposal && (
          <ProposalCard proposal={proposal} applying={applying} onApply={handleApply} />
        )}

        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
      </div>

      <div className="shrink-0 border-t border-slate-100 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 p-2 focus-within:border-indigo-400">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={2}
            placeholder={t('chat.inputPlaceholder')}
            className="max-h-28 flex-1 resize-none bg-transparent px-1 text-sm outline-none"
          />
          <button
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? t('chat.generating') : t('chat.send')}
          </button>
        </div>
      </div>

      {/* 只读会话浏览弹层：临时查看历史会话记录，不可编辑不可续聊 */}
      {browse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={closeBrowse}>
          <div
            className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-100 px-4">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                {t('versions.browseBadge')}
              </span>
              <span className="truncate text-sm font-medium text-slate-700" title={browse.title}>
                {browse.title}
              </span>
              <button
                onClick={closeBrowse}
                className="ml-auto rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
              >
                ✕ {t('common.close')}
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {browseLoading && <p className="py-8 text-center text-xs text-slate-400">{t('common.loading')}</p>}
              {!browseLoading && browseError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{browseError}</p>
              )}
              {!browseLoading && !browseError && browseMsgs.length === 0 && (
                <p className="py-8 text-center text-xs text-slate-400">{t('versions.browseEmpty')}</p>
              )}
              {browseMsgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
            <div className="shrink-0 border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-center text-[11px] text-slate-400">
              {t('versions.browseHint')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  proposal,
  applying,
  onApply,
}: {
  proposal: Proposal;
  applying: boolean;
  onApply: () => void;
}) {
  const { t } = useI18n();
  const ops = proposal.proposal.operations;
  const models = ops.filter((o) => o.op === 'add_model');
  const pages = ops.filter((o) => o.op === 'add_page');
  const navs = ops.filter((o) => o.op === 'set_navigation');
  const others = ops.filter((o) => !['add_model', 'add_page', 'set_navigation'].includes(o.op));

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
          SpecPatch
        </span>
        <span className="text-xs font-medium text-indigo-900">{t('chat.proposalTitle')}</span>
      </div>
      <p className="mb-3 text-xs text-slate-600">{proposal.proposal.summary}</p>

      <div className="space-y-1.5 text-xs">
        {models.map((o, i) => (
          <div key={`m${i}`} className="rounded-lg bg-white px-2.5 py-2">
            <span className="font-medium text-slate-700">{t('chat.addModel')}</span>
            <span className="ml-1.5 text-slate-500">
              {o.model.name}（{o.model.id}，{o.model.fields.length} {t('chat.fieldsUnit')}）
            </span>
          </div>
        ))}
        {pages.map((o, i) => (
          <div key={`p${i}`} className="rounded-lg bg-white px-2.5 py-2">
            <span className="font-medium text-slate-700">{t('chat.addPage')}</span>
            <span className="ml-1.5 text-slate-500">{o.page.title}</span>
          </div>
        ))}
        {navs.map((_, i) => (
          <div key={`n${i}`} className="rounded-lg bg-white px-2.5 py-2">
            <span className="font-medium text-slate-700">{t('chat.updateNav')}</span>
            <span className="ml-1.5 text-slate-500">{_.items.length} {t('chat.entriesUnit')}</span>
          </div>
        ))}
        {others.map((o, i) => (
          <div key={`o${i}`} className="rounded-lg bg-white px-2.5 py-2">
            <span className="font-medium text-slate-700">{o.op}</span>
          </div>
        ))}
      </div>

      {proposal.errors.length > 0 && (
        <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700">
          {t('chat.warnings', { n: proposal.errors.length, first: proposal.errors[0] })}
        </div>
      )}

      <button
        onClick={onApply}
        disabled={applying}
        className="mt-3 w-full rounded-lg bg-indigo-600 py-2 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
      >
        {applying ? t('fai.applying') : t('fai.apply')}
      </button>
    </div>
  );
}
