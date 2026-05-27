import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { LoginForm } from './login-form';
import { LanguageSwitcher } from '@/components/lang-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.login');
  return { title: t('title') };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}): Promise<React.ReactElement> {
  const sp = await searchParams;
  return (
    <div className="relative flex min-h-screen flex-col">
      {/* 极轻微的背景纹理 — dot grid（双主题自适应） */}
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

      {/* 顶部右侧：主题 + 语言 */}
      <div className="flex justify-end gap-1 p-4">
        <ThemeToggle className="h-8 w-8" />
        <LanguageSwitcher />
      </div>

      {/* 中央表单 */}
      <div className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-[360px] animate-in-fade">
          <LoginForm redirectTo={sp.redirect ?? null} />
        </div>
      </div>

      {/* 底部状态栏 */}
      <footer className="flex items-center justify-between border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-1.5 text-[11px] text-[hsl(var(--muted-fg))]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-[hsl(var(--color-success))]" />
            connected
          </span>
          <span className="wordmark-metallic font-semibold tracking-wide">StarsAlign</span>
        </div>
        <div className="flex items-center gap-3">
          <span>v0.1.0</span>
          <span className="opacity-50">·</span>
          <span>aligning ideas · crafting worlds</span>
        </div>
      </footer>
    </div>
  );
}
