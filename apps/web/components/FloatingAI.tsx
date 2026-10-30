'use client';

/**
 * 浮动 AI 调度球（需求4）：右下角浮动球 → 小对话窗。
 * AI 通过 function calling 调度当前应用的功能（数据查询/记录操作/SpecPatch 提案），
 * 作用域严格限定在 appId 对应的应用内。
 */
import { useEffect, useRef, useState } from 'react';
import { applyProposal, chatkitStream, fetchProposal, type Proposal } from '@/lib/chatkit-client';
import { useI18n } from '@/lib/i18n';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}

export function FloatingAI({
  appId,
  onSpecChanged,
  hint,
  liftPx = 0,
}: {
  appId: string;
  onSpecChanged?: () => void;
  hint?: string;
  /** 相对默认位置的垂直上移像素（Builder 界面传 48，避免遮挡右侧面板内容） */
  liftPx?: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, proposal]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || streaming) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: q }, { role: 'assistant', text: '' }]);
    setStreaming(true);
    setError('');
    setProposal(null);

    let acc = '';
    let tid = threadId;
    try {
      await chatkitStream(appId, threadId, q, (e) => {
        if (e.type === 'thread.created') {
          tid = String((e as { thread?: { id?: string } }).thread?.id ?? '');
          if (tid) setThreadId(tid);
        } else if (e.type === 'thread.item.updated') {
          const update = (e as { update?: { type?: string; delta?: string } }).update;
          if (update?.type === 'assistant_message.content_part.text_delta' && update.delta) {
            acc += update.delta;
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { role: 'assistant', text: acc };
              return copy;
            });
          }
        } else if (e.type === 'error') {
          setError(String((e as { message?: string }).message ?? t('fai.chatError')));
        }
      });
      // 流结束后取提案（工具调用 propose_spec_patch 或文本内嵌 patch）
      if (tid) {
        const p = await fetchProposal(tid).catch(() => null);
        if (p && p.status === 'pending') setProposal(p);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStreaming(false);
    }
  }

  async function apply() {
    if (!threadId || !proposal) return;
    setApplying(true);
    try {
      await applyProposal(appId, threadId);
      setProposal(null);
      onSpecChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      {/* 浮动球 */}
      <button
        onClick={() => setOpen((v) => !v)}
        title={t('fai.ballTitle')}
        style={{ bottom: `calc(1.5rem + ${liftPx}px)` }}
        className={`fixed right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all hover:scale-105 ${
          open ? 'rotate-45 bg-slate-700' : 'bg-gradient-to-br from-indigo-500 to-violet-600'
        } text-white`}
      >
        {open ? (
          <span className="text-lg leading-none">×</span>
        ) : (
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
            <path d="M12 2a7 7 0 0 1 7 7v1.1a5 5 0 0 1 2 4V15a5 5 0 0 1-5 5h-.6a4 4 0 0 1-6.8 0H8a5 5 0 0 1-5-5v-.9a5 5 0 0 1 2-4V9a7 7 0 0 1 7-7Zm-2 7a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 10 9Zm4 0a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 14 9Z" />
          </svg>
        )}
      </button>

      {/* 对话窗 */}
      {open && (
        <div className="fixed right-6 z-50 flex h-[540px] w-96 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          style={{ bottom: `calc(5.5rem + ${liftPx}px)` }}>
          <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-violet-50 px-4 py-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-[10px] text-white">
              AI
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-800">{t('fai.title')}</p>
              <p className="truncate text-[10px] text-slate-400">{hint}</p>
            </div>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-3">
            {messages.length === 0 && (
              <div className="mt-10 space-y-2 px-2 text-center">
                <p className="text-xs text-slate-400">{t('fai.askHint')}</p>
                {[t('fai.suggest1'), t('fai.suggest2'), t('fai.suggest3')].map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  {m.text || (streaming && i === messages.length - 1 ? '…' : '')}
                </div>
              </div>
            ))}

            {proposal && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">{t('fai.proposalTitle')}</p>
                <p className="mt-1 text-xs text-slate-700">{proposal.proposal.summary}</p>
                {proposal.errors.length > 0 ? (
                  <ul className="mt-1.5 space-y-0.5 text-[10px] text-red-500">
                    {proposal.errors.slice(0, 3).map((e, i) => (
                      <li key={i}>· {e}</li>
                    ))}
                  </ul>
                ) : (
                  <button
                    onClick={apply}
                    disabled={applying}
                    className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {applying ? t('fai.applying') : t('fai.applyOps', { n: proposal.proposal.operations.length })}
                  </button>
                )}
              </div>
            )}

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[10px] text-red-600">{error}</p>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2 border-t border-slate-100 bg-white p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={streaming ? t('fai.processing') : t('fai.placeholder')}
              disabled={streaming}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-indigo-400 focus:outline-none disabled:bg-slate-50"
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
            >
              {t('fai.send')}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
