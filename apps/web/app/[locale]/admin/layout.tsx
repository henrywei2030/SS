import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  LayoutDashboard,
  Database,
  Users,
  History,
  FileText,
  Brush,
  Palette,
  Server,
  Settings,
  KeyRound,
  ArrowLeft,
  Activity,
  Plug,
} from 'lucide-react';

import { requireAdminSession } from '@/lib/auth/session';
import { TopNav } from '@/components/top-nav';
import { LogoMark } from '@/components/brand/logo';

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const session = await requireAdminSession(locale);
  const t = await getTranslations('modules.admin');

  const groups = [
    {
      label: 'Overview',
      items: [
        { href: `/${locale}/admin`, icon: LayoutDashboard, label: t('dashboard') },
        { href: `/${locale}/admin/api-usage`, icon: Activity, label: t('apiUsage') },
      ],
    },
    {
      label: 'AI & Content',
      items: [
        {
          href: `/${locale}/admin/providers`,
          icon: KeyRound,
          label: t('providerConfig'),
          badge: 'KEY',
        },
        {
          href: `/${locale}/admin/bindings`,
          icon: Plug,
          label: '模型绑定',
        },
        { href: `/${locale}/admin/prompts`, icon: FileText, label: t('promptTemplates') },
        { href: `/${locale}/admin/styles`, icon: Palette, label: t('styleProfiles') },
        { href: `/${locale}/admin/presets`, icon: Brush, label: t('presetTemplates') },
      ],
    },
    {
      label: 'Team',
      items: [
        { href: `/${locale}/admin/users`, icon: Users, label: t('members') },
        { href: `/${locale}/admin/audit`, icon: History, label: t('operationLogs') },
        { href: `/${locale}/admin/reports`, icon: FileText, label: t('workReports') },
      ],
    },
    {
      label: 'System',
      items: [
        { href: `/${locale}/admin/db-explorer`, icon: Database, label: t('dbExplorer') },
        { href: `/${locale}/admin/settings`, icon: Settings, label: t('systemSettings') },
        { href: `/${locale}/admin/health`, icon: Server, label: 'Health' },
      ],
    },
  ];

  return (
    <div className="admin-pane min-h-screen">
      <TopNav user={session} />
      <div className="mx-auto grid max-w-[1920px] grid-cols-[240px_1fr]">
        {/* Cursor-style 极简侧栏 */}
        <aside className="sticky top-11 h-[calc(100vh-2.75rem)] overflow-y-auto border-r border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] p-2">
          <Link
            href={`/${locale}/projects`}
            className="mb-3 flex h-7 items-center gap-1.5 rounded px-2 text-[12px] text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary))] hover:text-[hsl(var(--color-foreground))]"
          >
            <ArrowLeft className="size-3" />
            返回工作台
          </Link>

          {groups.map((g) => (
            <div key={g.label} className="mb-3">
              <p className="mb-1 px-2 text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                {g.label}
              </p>
              <nav className="flex flex-col gap-0.5">
                {g.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex h-7 items-center gap-2 rounded px-2 text-[12.5px] text-[hsl(var(--color-muted-foreground))] transition-colors hover:bg-[hsl(var(--color-secondary))] hover:text-[hsl(var(--color-foreground))]"
                    >
                      <Icon className="size-3.5" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {'badge' in item && item.badge && (
                        <span className="rounded bg-[hsl(217_91%_60%_/_0.15)] px-1 text-[9px] font-medium tracking-wider text-[hsl(var(--color-accent))]">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}

          <div className="mt-auto pt-3 text-[10px] text-[hsl(var(--color-muted-foreground))]">
            <div className="flex items-center gap-2 px-2">
              <LogoMark className="size-4" mono />
              <p className="wordmark-metallic font-semibold tracking-wide">StarsAlign · v0.1.0</p>
            </div>
            <p className="mt-1 px-2 opacity-60">© 2026 星垣工坊</p>
          </div>
        </aside>

        {/* 主体 */}
        <main className="overflow-x-hidden p-6">{children}</main>
      </div>
    </div>
  );
}
