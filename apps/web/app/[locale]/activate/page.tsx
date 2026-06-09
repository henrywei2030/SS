import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ActivateForm } from './activate-form';
import { LanguageSwitcher } from '@/components/lang-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { isActivated, isDesktopActivationRequired } from '@/lib/auth/activation';

export const metadata: Metadata = { title: '激活 · StarsAlign Studio' };

export default async function ActivatePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  // 非桌面态 / 已激活 → 不该停在激活页
  if (!isDesktopActivationRequired() || (await isActivated())) {
    redirect(`/${locale}/login`);
  }
  return (
    <div className="relative flex min-h-screen flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, hsl(var(--border)) 1px, transparent 0)',
          backgroundSize: '24px 24px',
          opacity: 0.5,
          maskImage: 'radial-gradient(ellipse 80% 50% at 50% 50%, black, transparent)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 50% at 50% 50%, black, transparent)',
        }}
      />
      <div className="flex justify-end gap-1 p-4">
        <ThemeToggle className="h-8 w-8" />
        <LanguageSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-[360px] animate-in-fade">
          <ActivateForm locale={locale} />
        </div>
      </div>
    </div>
  );
}
