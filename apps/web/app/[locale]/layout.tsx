/**
 * Locale-aware layout — 包裹 next-intl 与 tRPC Provider
 */
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Inter, Noto_Sans_SC, JetBrains_Mono } from 'next/font/google';

import { SUPPORTED_LOCALES } from '@ss/i18n';

import { TrpcProvider } from '@/lib/trpc/provider';
import { Toaster } from '@/components/ui/toaster';
import { THEME_INIT_SCRIPT } from '@/components/theme-toggle';

// r10 fix:next/font/google self-host 替代 @import url(fonts.googleapis...)
// 优点:1) 不再触发 Turbopack 严格 @import 顺序检查 2) 无外部网络请求 + 国内可用
//      3) 自动 preload + display:swap 防 FOUT 4) production build 静态化
const fontSans = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});
const fontSansSC = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-noto-sc',
  display: 'swap',
});
const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'app' });
  return {
    title: {
      default: `${t('name')} · ${t('name_en')}`,
      template: `%s · ${t('name')}`,
    },
    description: t('tagline'),
  };
}

export function generateStaticParams(): { locale: string }[] {
  return (SUPPORTED_LOCALES as readonly string[]).map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) notFound();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontSansSC.variable} ${fontMono.variable}`}
    >
      <head>
        {/* 内联脚本：在 React 水合前同步设置 dark 类，避免主题闪烁 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Shanghai">
          <TrpcProvider>
            {children}
            <Toaster />
          </TrpcProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
