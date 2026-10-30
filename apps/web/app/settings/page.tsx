'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { UsersPanel } from './UsersPanel';
import { DatabasesPanel } from './DatabasesPanel';
import { TeamPanel } from './TeamPanel';
import { apiFetch } from '@/lib/api';
import { LangToggle, useI18n } from '@/lib/i18n';

interface ApiHealth {
  ok: boolean;
  service: string;
}
interface AgentHealth {
  ok: boolean;
  service: string;
  llm: { mode: string; model: string | null };
}

const TABS = [
  { key: 'status' },
  { key: 'users' },
  { key: 'databases' },
  { key: 'skills' },
  { key: 'mcp' },
  { key: 'ai' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function SettingsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>('status');
  const [api, setApi] = useState<ApiHealth | null>(null);
  const [agent, setAgent] = useState<AgentHealth | null>(null);

  useEffect(() => {
    apiFetch<ApiHealth>('/health').then(setApi).catch(() => setApi({ ok: false, service: 'platform-api' }));
    fetch('/agent/health')
      .then((r) => r.json())
      .then(setAgent)
      .catch(() => setAgent({ ok: false, service: 'agent-server', llm: { mode: 'unknown', model: null } }));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Link href="/apps" className="text-sm text-slate-400 transition hover:text-slate-700">
              {t('settings.back')}
            </Link>
            <span className="text-sm font-semibold text-slate-800">{t('settings.title')}</span>
            <div className="ml-auto">
              <LangToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl gap-6 px-6 py-8">
        {/* 左侧导航 */}
        <nav className="w-52 shrink-0 space-y-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                tab === item.key
                  ? 'bg-indigo-600 font-medium text-white shadow-sm'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              {t(`settings.tab.${item.key}`)}
            </button>
          ))}
        </nav>

        {/* 右侧内容 */}
        <section className="min-w-0 flex-1">
          {tab === 'status' && <StatusPanel api={api} agent={agent} />}
          {tab === 'users' && <UsersPanel />}
          {tab === 'databases' && <DatabasesPanel />}
          {tab === 'skills' && <TeamPanel sub="skills" />}
          {tab === 'mcp' && <TeamPanel sub="mcp" />}
          {tab === 'ai' && <TeamPanel sub="ai" />}
        </section>
      </main>
    </div>
  );
}

function StatusPanel({ api, agent }: { api: ApiHealth | null; agent: AgentHealth | null }) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-slate-800">{t('settings.tab.status')}</h2>
      <div className="mt-4 space-y-3 text-sm">
        <StatusRow name="Platform API (Express)" ok={api?.ok} detail={api?.ok ? (t('run.running')) : 'N/A'} />
        <StatusRow name="Agent Server (FastAPI)" ok={agent?.ok} detail={agent?.ok ? (t('run.running')) : 'N/A'} />
        <StatusRow
          name="LLM Mode"
          ok={agent?.llm?.mode === 'real'}
          detail={
            agent?.llm?.mode === 'real'
              ? `${t('run.running')} · ${agent.llm.model}`
              : agent?.llm?.mode === 'mock'
                ? t('settings.mockMode')
                : t('settings.unknown')
          }
        />
      </div>
      <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
        {t('settings.statusHint')}
      </p>
    </div>
  );
}

function StatusRow({ name, ok, detail }: { name: string; ok?: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-400'}`} />
      <span className="w-48 text-slate-700">{name}</span>
      <span className="text-xs text-slate-500">{detail}</span>
    </div>
  );
}
