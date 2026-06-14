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
  Library,
  BarChart3,
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
import { NotificationBell } from '@/components/notification-bell';
import { ThemeToggle } from '@/components/theme-toggle';
import { LogoMark } from '@/components/brand/logo';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';

export function TopNav({
  user,
  currentProject,
}: {
  user: { id: string; displayName: string; isAdmin: boolean };
  currentProject?: { id: string; name: string };
}): React.ReactElement {
  const t = useTranslations();
  const params = useParams<{ locale: string; id?: string }>();
  const router = useRouter();

  const locale = params.locale;
  // 用户反馈 r5:顶栏按钮在项目详情页仍显示 disabled(因 workspace layout 没传 currentProject prop)
  // 兜底从 URL params 取 id,确保项目级路由下按钮可用
  const urlProjectId = currentProject?.id ?? params.id;
  // 需求1:进项目后记住当前项目 — 去全局页(素材库/数据/管理 无 [id] param)时
  //   顶栏模块按钮(导演/美术/AIGC/团队)仍可点回该项目,不再变灰 disabled
  const [rememberedId, setRememberedId] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    if (urlProjectId) {
      try {
        localStorage.setItem('ss:lastProjectId', urlProjectId);
      } catch {
        /* localStorage 不可用(隐私模式)忽略 */
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

  // #7(2026-06-14 用户):在具体项目内时,顶栏左侧「Projects」自动显示项目名。
  //   用 URL param 判定「是否在项目里」(不用 rememberedId,避免离开项目后还残留显示上次项目名)。
  const inProject = Boolean(params.id);
  const projectNameQuery = trpc.project.get.useQuery(
    { id: params.id ?? '' },
    { enabled: inProject, staleTime: 60_000 },
  );
  const projectName = projectNameQuery.data?.name ?? currentProject?.name;

  // #6(2026-06-14 用户):原顶栏「管理」HoverNav 的 13 项收进用户下拉,按 4 组展示
  const adminGroups: { group: string; items: { href: string; label: string }[] }[] = [
    {
      group: 'Overview',
      items: [
        { href: `/${locale}/admin`, label: '后台首页' },
        { href: `/${locale}/admin/api-usage`, label: 'API 用量' },
      ],
    },
    {
      group: 'AI & Content',
      items: [
        { href: `/${locale}/admin/providers`, label: 'AI Provider' },
        { href: `/${locale}/admin/bindings`, label: '模型绑定' },
        { href: `/${locale}/admin/prompts`, label: '提示词模板' },
        { href: `/${locale}/admin/styles`, label: '风格库' },
        { href: `/${locale}/admin/presets`, label: '预设模板' },
      ],
    },
    {
      group: 'Team',
      items: [
        { href: `/${locale}/admin/users`, label: '成员管理' },
        { href: `/${locale}/admin/audit`, label: '操作日志' },
        { href: `/${locale}/admin/reports`, label: '工作报告' },
      ],
    },
    {
      group: 'System',
      items: [
        { href: `/${locale}/admin/db-explorer`, label: 'DB Explorer' },
        { href: `/${locale}/admin/settings`, label: '系统设置' },
        { href: `/${locale}/admin/health`, label: '健康检查' },
      ],
    },
  ];

  async function onLogout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    // #3 perf:登出只需 replace 到 login;去掉多余的 router.refresh(它会再触发一轮 RSC+鉴权)
    router.replace(`/${locale}/login`);
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

        {inProject ? (
          <>
            <Link
              href={`/${locale}/projects`}
              className="text-[13px] text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))]"
            >
              Projects
            </Link>
            <span className="text-[12px] text-[hsl(var(--color-muted-foreground))]">/</span>
            {/* 七二 UI-P0:长项目名截断,防挤压右侧导航(docs/08 §1-1) */}
            <span className="max-w-[12rem] truncate text-[13px] font-medium" title={projectName}>
              {projectName ?? '…'}
            </span>
          </>
        ) : (
          <span className="text-[13px] text-[hsl(var(--color-muted-foreground))]">Projects</span>
        )}

        {/* 项目模块菜单 — 用户反馈 r3:不要"工作台"聚合,直接显示模块名 + hover 出子菜单
         *  无项目时按钮可见但 disabled(提示先选项目);进项目后直达 */}
        <span className="mx-1 h-4 w-px bg-[hsl(var(--color-border))]" />
        <HoverNav
          label="导演"
          icon={ClapperboardIcon}
          mainHref={
            projectId
              ? `/${locale}/projects/${projectId}/director/storyboard?tab=inspiration`
              : undefined
          }
          items={
            projectId
              ? [
                  // 三十六收工 UX 改造:导演 = storyboard 的 tab(灵感 / 剧本 / 分镜)
                  //   四九收工:灵感创作提到第一顺位(想法 → 多集剧本是创作起点)
                  //   五六收工:加「剧本拆解」(P1 后端就绪 → P2 前端落地,接 asset.list/update/createRelation 等)
                  {
                    href: `/${locale}/projects/${projectId}/director/storyboard?tab=inspiration`,
                    label: '灵感创作',
                  },
                  {
                    href: `/${locale}/projects/${projectId}/director/storyboard?tab=script`,
                    label: '剧本管理',
                  },
                  {
                    href: `/${locale}/projects/${projectId}/director/storyboard?tab=breakdown`,
                    label: '剧本拆解',
                  },
                  {
                    href: `/${locale}/projects/${projectId}/director/storyboard?tab=shots`,
                    label: '分镜工坊',
                  },
                ]
              : []
          }
        />
        <HoverNav
          label="美术"
          icon={Palette}
          mainHref={projectId ? `/${locale}/projects/${projectId}/art` : undefined}
          items={
            projectId
              ? [
                  { href: `/${locale}/projects/${projectId}/art`, label: '美术工坊' },
                  { href: `/${locale}/projects/${projectId}/art/audit`, label: '资产审核' },
                ]
              : []
          }
        />
        <HoverNav
          label="AIGC"
          icon={Sparkles}
          mainHref={projectId ? `/${locale}/projects/${projectId}/aigc` : undefined}
        />
        <HoverNav label="素材库" icon={Library} mainHref={`/${locale}/library`} />
        {/* #6(2026-06-14 用户):数据 / 团队 / 管理 三项已从顶栏移入右侧用户(管理员)下拉,见下方 DropdownMenu */}

        <div className="flex-1" />

        <button
          type="button"
          aria-label="搜索(暂未实装)"
          className="hidden h-7 items-center gap-2 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 text-[12px] text-[hsl(var(--color-muted-foreground))] hover:border-[hsl(0_0%_22%)] md:flex"
        >
          <Search className="size-3" />
          <span className="hidden lg:inline">Search...</span>
          <kbd className="ml-2">⌘K</kbd>
        </button>

        <ThemeToggle className="h-7 w-7" />
        <LanguageSwitcher />

        <NotificationBell />

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
          <DropdownMenuContent align="end" className="max-h-[85vh] w-60 overflow-y-auto">
            <DropdownMenuLabel className="text-[11px]">{user.displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* 账户 */}
            <DropdownMenuItem asChild>
              <Link href={`/${locale}/me`}>
                <User className="size-3.5" />
                {t('actions.settings')}
              </Link>
            </DropdownMenuItem>
            {/* #6:工作区 — 数据 / 团队 */}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
              工作区
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link
                href={projectId ? `/${locale}/projects/${projectId}/insights` : `/${locale}/insights`}
              >
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
            {/* #6:管理后台(仅管理员)— 原顶栏「管理」13 项,按 4 组展示 */}
            {user.isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                  <Shield className="size-3" />
                  管理
                </DropdownMenuLabel>
                {adminGroups.map((g) => (
                  <React.Fragment key={g.group}>
                    <div className="px-2 pt-1 text-[9px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground)/0.6)]">
                      {g.group}
                    </div>
                    {g.items.map((it) => (
                      <DropdownMenuItem key={it.href} asChild>
                        <Link href={it.href}>{it.label}</Link>
                      </DropdownMenuItem>
                    ))}
                  </React.Fragment>
                ))}
              </>
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

// ---------------------------------------------------------------------------
// HoverNav — 顶栏模块按钮 · hover 出子菜单
// 用户反馈 r3:鼠标指到时才出子菜单 + 不要闪烁
//
// 设计:
//   - trigger 和子菜单包在同一个 onMouseEnter/Leave 范围内(同一 div) → 在间隙移动不会触发 close
//   - 无 hover 子菜单的按钮(items 为空)走纯 Link,无 dropdown 行为
//   - close delay 100ms 用于跨可能微小空隙,但 trigger 和 content 物理相邻(top-full,无 margin)
//   - trigger button 不再用 background hover 状态变化(避免按钮闪烁)— 只用文字色变化
// ---------------------------------------------------------------------------

interface HoverNavItem {
  href: string;
  label: string;
  /** 可选 · 同组项在子菜单内连续展示 + 顶部小 label */
  group?: string;
}

function HoverNav({
  label,
  icon: TriggerIcon,
  mainHref,
  items,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** 按钮本身的链接 · 无 mainHref 时按钮 disabled(无项目时) */
  mainHref?: string;
  /** 子菜单项 · 不传或空数组 → 不显示 hover dropdown,仅作为单链接按钮 */
  items?: HoverNavItem[];
}): React.ReactElement {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMenu = (items?.length ?? 0) > 0;
  const disabled = !mainHref;

  const active = mainHref && pathname.startsWith(mainHref);

  const cancelClose = (): void => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = (): void => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 100);
  };

  React.useEffect(() => () => cancelClose(), []);

  // r7 audit P2-B3:items 变化(如 projectId 切换)时关闭已打开的菜单,防 stale open
  React.useEffect(() => {
    setOpen(false);
  }, [items]);

  // 按 group 分组(undefined group 归"_default"组,无标题)
  const grouped = React.useMemo(() => {
    if (!items) return [];
    const map = new Map<string, HoverNavItem[]>();
    for (const it of items) {
      const key = it.group ?? '_default';
      const list = map.get(key);
      if (list) list.push(it);
      else map.set(key, [it]);
    }
    return Array.from(map.entries());
  }, [items]);

  // 七二 UI-P0:shrink-0 + whitespace-nowrap — flex 挤压时「导演」被折成竖排两行(docs/08 §1-1)
  const buttonClass = cn(
    'flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 text-[12px] transition-colors',
    active
      ? 'bg-[hsl(var(--color-secondary))] text-[hsl(var(--color-foreground))]'
      : 'text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))]',
    disabled && 'cursor-not-allowed opacity-50 hover:text-[hsl(var(--color-muted-foreground))]',
  );

  // 七二 UI-P0:lg 以下 icon-only(title 提示),防窄视口横向溢出(docs/08 §1-1 响应式折叠)
  const labelEl = <span className="hidden lg:inline">{label}</span>;

  // 无子菜单 → 纯 Link 按钮(无 hover 状态变化)
  if (!hasMenu) {
    if (disabled) {
      return (
        <span className={buttonClass} title={`${label} — 请先选择项目`}>
          <TriggerIcon className="size-3" />
          {labelEl}
        </span>
      );
    }
    return (
      <Link href={mainHref!} className={buttonClass} title={label}>
        <TriggerIcon className="size-3" />
        {labelEl}
      </Link>
    );
  }

  // 有子菜单 → trigger + 绝对定位的 content 包在同一 div 内
  return (
    <div
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        if (!disabled) setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      {disabled ? (
        <span className={buttonClass} title={`${label} — 请先选择项目`}>
          <TriggerIcon className="size-3" />
          {labelEl}
          <ChevronDown className="size-3" />
        </span>
      ) : (
        <Link href={mainHref!} className={buttonClass} title={label}>
          <TriggerIcon className="size-3" />
          {labelEl}
          <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
        </Link>
      )}
      {open && !disabled && (
        <div className="absolute left-0 top-full z-50 min-w-[12rem] rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-popover))] py-1 shadow-md">
          {grouped.map(([groupName, list], gi) => (
            <React.Fragment key={groupName}>
              {gi > 0 && <div className="my-1 h-px bg-[hsl(var(--color-border))]" />}
              {groupName !== '_default' && (
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                  {groupName}
                </div>
              )}
              {list.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className="block px-3 py-1.5 text-[12px] text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary))] hover:text-[hsl(var(--color-foreground))]"
                  onClick={() => setOpen(false)}
                >
                  {it.label}
                </Link>
              ))}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
