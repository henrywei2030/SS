'use client';
import * as React from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ChevronDown,
  ClapperboardIcon,
  Palette,
  Sparkles,
  Scissors,
  Library,
  BarChart3,
  Bell,
  LogOut,
  Shield,
  User,
  Users,
  Search,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import { ThemeToggle } from '@/components/theme-toggle';
import { LogoMark } from '@/components/brand/logo';
import { cn } from '@/lib/utils';

interface NavItem {
  key: 'director' | 'art' | 'aigc' | 'edit' | 'library' | 'analytics' | 'team';
  href: (locale: string, projectId: string) => string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'director', href: (l, p) => `/${l}/projects/${p}/director`, icon: ClapperboardIcon },
  { key: 'art', href: (l, p) => `/${l}/projects/${p}/art`, icon: Palette },
  { key: 'aigc', href: (l, p) => `/${l}/projects/${p}/aigc`, icon: Sparkles },
  { key: 'edit', href: (l, p) => `/${l}/projects/${p}/edit`, icon: Scissors },
  { key: 'library', href: (l, p) => `/${l}/library`, icon: Library },
  { key: 'analytics', href: (l, p) => `/${l}/projects/${p}/analytics`, icon: BarChart3 },
  // W6 波 2 反馈 F1+F5:加 team nav 入口,让用户能找到成员管理 + 集数分配
  { key: 'team', href: (l, p) => `/${l}/projects/${p}/team`, icon: Users },
];

export function TopNav({
  user,
  currentProject,
}: {
  user: { id: string; displayName: string; isAdmin: boolean };
  currentProject?: { id: string; name: string };
}): React.ReactElement {
  const t = useTranslations();
  const params = useParams<{ locale: string }>();
  const pathname = usePathname();
  const router = useRouter();

  const locale = params.locale;
  const projectId = currentProject?.id;

  async function onLogout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push(`/${locale}/login`);
    router.refresh();
  }

  const initial = user.displayName.charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))]">
      <div className="mx-auto flex h-11 max-w-[1920px] items-center gap-2 px-3">
        {/* Logo */}
        <Link
          href={`/${locale}/projects`}
          className="flex shrink-0 items-center gap-2 px-1"
          aria-label="StarsAlign Studio"
        >
          <LogoMark className="size-6" />
          <span className="wordmark-metallic hidden text-[13px] font-semibold tracking-wide md:inline">
            StarsAlign
          </span>
        </Link>

        <span className="mx-1 h-4 w-px bg-[hsl(var(--color-border))]" />

        {currentProject ? (
          <>
            <Link
              href={`/${locale}/projects`}
              className="text-[13px] text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))]"
            >
              Projects
            </Link>
            <span className="text-[12px] text-[hsl(var(--color-muted-foreground))]">/</span>
            <span className="text-[13px] font-medium">{currentProject.name}</span>
          </>
        ) : (
          <span className="text-[13px] text-[hsl(var(--color-muted-foreground))]">Projects</span>
        )}

        {projectId && (
          <nav className="ml-3 hidden items-center gap-0.5 md:flex">
            {NAV_ITEMS.map((item) => {
              const href = item.href(locale, projectId);
              const active = pathname.includes(`/${item.key}`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  href={href}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded px-2 text-[12px] transition-colors',
                    active
                      ? 'bg-[hsl(var(--color-secondary))] text-[hsl(var(--color-foreground))]'
                      : 'text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary))] hover:text-[hsl(var(--color-foreground))]',
                  )}
                >
                  <Icon className="size-3" />
                  {t(`modules.workbench.${item.key}`)}
                </Link>
              );
            })}
          </nav>
        )}

        <div className="flex-1" />

        <button
          type="button"
          className="hidden h-7 items-center gap-2 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 text-[12px] text-[hsl(var(--color-muted-foreground))] hover:border-[hsl(0_0%_22%)] md:flex"
        >
          <Search className="size-3" />
          <span className="hidden lg:inline">Search...</span>
          <kbd className="ml-2">⌘K</kbd>
        </button>

        <ThemeToggle className="h-7 w-7" />
        <LanguageSwitcher />

        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Bell className="size-3.5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-7 gap-1.5 px-1.5">
              <Avatar className="h-5 w-5">
                <AvatarFallback className="text-[10px]">{initial}</AvatarFallback>
              </Avatar>
              <span className="hidden text-[12px] md:inline">{user.displayName}</span>
              <ChevronDown className="size-3 text-[hsl(var(--color-muted-foreground))]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-[11px]">{user.displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/${locale}/me`}>
                <User className="size-3.5" />
                {t('actions.settings')}
              </Link>
            </DropdownMenuItem>
            {user.isAdmin && (
              <DropdownMenuItem asChild>
                <Link href={`/${locale}/admin`}>
                  <Shield className="size-3.5" />
                  {t('modules.admin.title')}
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
      </div>
    </header>
  );
}
