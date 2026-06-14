/**
 * Root layout — 提供 viewport 与 metadata
 */
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '星垣工坊 · StarsAlign Studio',
    template: '%s · StarsAlign Studio',
  },
  description: 'AI 短剧生产平台 — Aligning ideas, crafting worlds.',
  applicationName: 'StarsAlign Studio',
  authors: [{ name: 'StarsAlign Studio' }],
  openGraph: {
    title: 'StarsAlign Studio · 星垣工坊',
    description: 'Aligning ideas, crafting worlds. AI 短剧生产平台',
    siteName: 'StarsAlign Studio',
    images: ['/logo.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#1F1F1F', // 对齐实际暗底 #1F1F1F(原 #121212),移动浏览器 chrome 与 app 无缝
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // 启用 env(safe-area-inset-*) — 刘海/灵动岛/Home Indicator
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return children as React.ReactElement;
}
