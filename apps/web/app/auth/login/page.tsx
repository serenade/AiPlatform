'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { LangToggle, useI18n } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      router.push('/apps');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('login.networkError'));
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-white to-indigo-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex w-full items-center justify-end">
            <LangToggle />
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white shadow-lg shadow-indigo-200">
            AIR
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-slate-900">{t('login.title')}</h1>
            <p className="mt-1 text-sm text-slate-500">{t('login.subtitle')}</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <label className="block text-sm font-medium text-slate-700">{t('login.email')}</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />

          <label className="mt-4 block text-sm font-medium text-slate-700">{t('login.password')}</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('login.passwordPlaceholder')}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />

          {error && (
            <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? t('login.submitting') : t('login.submit')}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">{t('login.seedAccount')}</p>
      </div>
    </div>
  );
}
