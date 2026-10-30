import type { Metadata } from 'next';
import { I18nProvider } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ai智能企业应用平台',
  description: 'AppSpec-first 的 AI 对话式应用搭建平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-slate-50 text-slate-900 antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
