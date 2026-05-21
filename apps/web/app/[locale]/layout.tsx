/**
 * Locale-aware layout — 包裹 next-intl 与 tRPC Provider
 */
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { SUPPORTED_LOCALES } from '@ss/i18n';

import { TrpcProvider } from '@/lib/trpc/provider';
import { Toaster } from '@/components/ui/toaster';
import { THEME_INIT_SCRIPT } from '@/components/theme-toggle';

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
    <html lang={locale} suppressHydrationWarning>
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
