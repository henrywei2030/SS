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
  themeColor: '#121212',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return children as React.ReactElement;
}
