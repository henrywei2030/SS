'use client';
/**
 * MobileNav — 手机端导航(方案 B 沉浸暗色工作室)
 *   · 薄上下文顶栏(返回/项目名 + 主题/语言/通知/头像)
 *   · 底部玻璃 Tab Bar(导演/美术 · 中置辉光 FAB · AIGC/素材库)
 *   仅 md 以下显示;桌面用 TopNav(已加 hidden md:block)。
 *   复用 top-nav 的 rememberedId(ss:lastProjectId)机制:离开项目后模块 tab 仍回最近项目。
 */
import * as React from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ChevronLeft,
  ClapperboardIcon,
  Palette,
  Sparkles,
  Library,
  Plus,
  BarChart3,
  Users,
  User,
  Shield,
  LogOut,
} from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LanguageSwitcher } from '@/components/lang-switcher';
import { NotificationBell } from '@/components/notification-bell';
import { ThemeToggle } from '@/components/theme-toggle';
import { LogoMark } from '@/components/brand/logo';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';

export function MobileNav({
  user,
}: {
  user: { id: string; displayName: string; isAdmin: boolean };
}): React.ReactElement {
  const t = useTranslations();
  const params = useParams<{ locale: string; id?: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const locale = params.locale;

  const urlProjectId = params.id;
  const inProject = Boolean(urlProjectId);
  // 复用 top-nav 的「记住上次项目」:离开项目去全局页时,模块 tab 仍能回最近项目
  const [rememberedId, setRememberedId] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    if (urlProjectId) {
      try {
        localStorage.setItem('ss:lastProjectId', urlProjectId);
      } catch {
        /* 隐私模式忽略 */
      }
      setRememberedId(urlProjectId);
    } else {
      try {
        const stored = localStorage.getItem('ss:lastProjectId');
        if (stored) setRememberedId(stored);
      } catch {
        /* ignore */
      }
    }
  }, [urlProjectId]);
  const projectId = urlProjectId ?? rememberedId;

  const projectNameQuery = trpc.project.get.useQuery(
    { id: urlProjectId ?? '' },
    { enabled: inProject, staleTime: 60_000 },
  );
  const projectName = projectNameQuery.data?.name;

  async function onLogout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace(`/${locale}/login`);
  }
  const initial = user.displayName.charAt(0).toUpperCase();

  const projectsHref = `/${locale}/projects`;
  // 顶栏标题:项目内显示项目名,否则按路由段
  const title = inProject
    ? projectName ?? '…'
    : pathname.includes('/library')
      ? '素材库'
      : pathname.includes('/insights')
        ? '数据'
        : pathname.includes('/admin')
          ? '管理'
          : pathname.includes('/me')
            ? '我的'
            : 'Projects';

  // Tab 路由(无项目则回项目列表去选/建)+ 激活判定
  const tabs = [
    {
      label: '导演',
      Icon: ClapperboardIcon,
      href: projectId
        ? `/${locale}/projects/${projectId}/director/storyboard?tab=shots`
        : projectsHref,
      active: pathname.includes('/director'),
      mod: 'var(--color-mod-director)',
    },
    {
      label: '美术',
      Icon: Palette,
      href: projectId ? `/${locale}/projects/${projectId}/art` : projectsHref,
      active: pathname.includes('/art') && !pathname.includes('/library'),
      mod: 'var(--color-mod-art)',
    },
    {
      label: 'AIGC',
      Icon: Sparkles,
      href: projectId ? `/${locale}/projects/${projectId}/aigc` : projectsHref,
      active: pathname.includes('/aigc'),
      mod: 'var(--color-mod-aigc)',
    },
    {
      label: '素材库',
      Icon: Library,
      href: `/${locale}/library`,
      active: pathname.includes('/library'),
      mod: 'var(--color-mod-library)',
    },
  ];
  // FAB = 新建创作:项目内 → 灵感创作(创作起点);无项目 → 项目列表(去建/选)
  const fabHref = projectId
    ? `/${locale}/projects/${projectId}/director/storyboard?tab=inspiration`
    : projectsHref;

  return (
    <>
      {/* 移动顶栏 — 薄上下文栏(md 以下) */}
      <header className="sticky top-0 z-40 flex h-12 items-center gap-1 border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 md:hidden">
        {inProject ? (
          <Link
            href={projectsHref}
            className="flex shrink-0 items-center text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))]"
            aria-label="返回项目列表"
          >
            <ChevronLeft className="size-5" />
          </Link>
        ) : (
          <Link href={projectsHref} className="flex shrink-0 items-center" aria-label="StarsAlign Studio">
            <LogoMark className="size-6" />
          </Link>
        )}
        <span className="min-w-0 flex-1 truncate px-1 text-[15px] font-medium" title={title}>
          {title}
        </span>
        <ThemeToggle className="size-9" />
        <LanguageSwitcher />
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex size-9 items-center justify-center"
              aria-label="账户菜单"
            >
              <Avatar className="size-7">
                <AvatarFallback className="text-[11px]">{initial}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[80vh] w-56 overflow-y-auto">
            <DropdownMenuLabel className="text-[12px]">{user.displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/${locale}/me`}>
                <User className="size-3.5" />
                {t('actions.settings')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={projectId ? `/${locale}/projects/${projectId}/insights` : `/${locale}/insights`}>
                <BarChart3 className="size-3.5" />
                数据
              </Link>
            </DropdownMenuItem>
            {projectId && (
              <DropdownMenuItem asChild>
                <Link href={`/${locale}/projects/${projectId}/team`}>
                  <Users className="size-3.5" />
                  团队
                </Link>
              </DropdownMenuItem>
            )}
            {user.isAdmin && (
              <DropdownMenuItem asChild>
                <Link href={`/${locale}/admin`}>
                  <Shield className="size-3.5" />
                  管理后台
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout}>
              <LogOut className="size-3.5" />
              {t('actions.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* 底部玻璃 Tab Bar + 中置辉光 FAB(md 以下) */}
      <nav
        className="glass-bar fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="主导航"
      >
        {tabs.slice(0, 2).map((tab) => (
          <TabItem key={tab.label} {...tab} />
        ))}
        {/* 中置辉光 FAB — 新建创作 */}
        <div className="flex flex-1 items-start justify-center">
          <Link
            href={fabHref}
            aria-label="新建创作"
            className="glow-accent -mt-5 flex size-12 items-center justify-center rounded-full bg-[hsl(var(--color-accent))] text-white"
          >
            <Plus className="size-6" />
          </Link>
        </div>
        {tabs.slice(2).map((tab) => (
          <TabItem key={tab.label} {...tab} />
        ))}
      </nav>
    </>
  );
}

function TabItem({
  href,
  label,
  Icon,
  active,
  mod,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  mod: string;
}): React.ReactElement {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'tap-44 flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5',
        !active && 'text-[hsl(var(--color-muted-foreground))]',
      )}
      style={active ? { color: `hsl(${mod})` } : undefined}
    >
      <Icon className="size-[22px]" />
      <span className="text-[11px] leading-none">{label}</span>
    </Link>
  );
}
