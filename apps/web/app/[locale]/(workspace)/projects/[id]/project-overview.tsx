'use client';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  ClapperboardIcon,
  Palette,
  Sparkles,
  ChevronRight,
  Users,
  BarChart3,
} from 'lucide-react';
import * as React from 'react';

import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function ProjectOverview({ projectId }: { projectId: string }): React.ReactElement | null {
  const t = useTranslations();
  const params = useParams<{ locale: string }>();
  const { data: project, isLoading } = trpc.project.get.useQuery({ id: projectId });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }
  if (!project) return null;

  const stats = project.stats;

  return (
    <div className="animate-in-fade space-y-5">
      {/* 头部 */}
      <div className="flex items-center gap-3">
        <h1 className="text-[20px] font-semibold tracking-tight">{project.name}</h1>
        <Badge variant="default">{t(`enums.projectType.${project.type}`)}</Badge>
        {project.style && <Badge variant="secondary">{project.style.name}</Badge>}
        <Badge variant="secondary">{project.aspect}</Badge>
      </div>

      {/* 总进度条 — 单行简洁 */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between text-[12px]">
          <span className="text-[hsl(var(--color-muted-foreground))]">Progress</span>
          <span className="tabular-nums font-medium">
            {stats.completedShots} <span className="text-[hsl(var(--color-muted-foreground))]">/</span>{' '}
            {stats.shotCount} shots ·{' '}
            <span className="text-[hsl(var(--color-accent))]">{stats.progressPct}%</span>
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-[hsl(var(--color-secondary))]">
          <div
            className="h-full bg-[hsl(var(--color-accent))] transition-all duration-300"
            style={{ width: `${Math.max(2, stats.progressPct)}%` }}
          />
        </div>
      </Card>

      {/* KPI 卡 — 紧凑 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Episodes" value={project.episodes.length} />
        <KpiCard label="Shots" value={stats.shotCount} />
        <KpiCard label="Assets" value={stats.assetCount} />
        <KpiCard label="Completed" value={stats.completedShots} accent />
      </div>

      {/* 团队 + 工作台 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* 工作台 4 个入口 */}
        <div className="space-y-2">
          <h2 className="px-1 text-[11px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
            Workbenches
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <WorkbenchRow
              href={`/${params.locale}/projects/${projectId}/director`}
              icon={ClapperboardIcon}
              title={t('modules.workbench.director')}
              subtitle="剧本管理 · AI 分镜 · 分镜管理"
              colorVar="--color-mod-director"
            />
            <WorkbenchRow
              href={`/${params.locale}/projects/${projectId}/art`}
              icon={Palette}
              title={t('modules.workbench.art')}
              subtitle="资产库 · 图片生成 · 风格设定"
              colorVar="--color-mod-art"
            />
            <WorkbenchRow
              href={`/${params.locale}/projects/${projectId}/aigc`}
              icon={Sparkles}
              title={t('modules.workbench.aigc')}
              subtitle="分镜编辑 · 视频生成 · 批量制作"
              colorVar="--color-mod-aigc"
            />
            <WorkbenchRow
              href={`/${params.locale}/projects/${projectId}/insights`}
              icon={BarChart3}
              title="数据洞察"
              subtitle="成本 / 抽卡率 / 模型分布"
              colorVar="--color-mod-analytics"
            />
          </div>
        </div>

        {/* 团队卡 */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-[12px] text-[hsl(var(--color-muted-foreground))]">
              <Users className="size-3" />
              Team
            </h2>
            <Link
              href={`/${params.locale}/projects/${projectId}/team`}
              className="text-[12px] text-[hsl(var(--color-accent))] hover:underline"
            >
              {project.members.length} members
            </Link>
          </div>
          <div className="row-divider">
            {project.members.slice(0, 5).map((m) => (
              <div key={m.user.id} className="flex items-center gap-2 py-2">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-[10px]">
                    {m.user.displayName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="flex-1 text-[13px]">{m.user.displayName}</span>
                <Badge variant="secondary">{m.role}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}): React.ReactElement {
  return (
    <Card className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
        {label}
      </div>
      <div
        className={cn(
          'tabular-nums mt-1 text-[22px] font-semibold leading-none',
          accent && 'text-[hsl(var(--color-accent))]',
        )}
      >
        {value}
      </div>
    </Card>
  );
}

function WorkbenchRow({
  href,
  icon: Icon,
  title,
  subtitle,
  colorVar,
  comingSoon,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  colorVar: string;
  comingSoon?: boolean;
}): React.ReactElement {
  const inner = (
    <Card
      className={cn(
        'card-hover flex items-center gap-3 px-3 py-3',
        comingSoon && 'opacity-60',
      )}
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded"
        style={{ background: `hsl(var(${colorVar}) / 0.15)`, color: `hsl(var(${colorVar}))` }}
      >
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium">{title}</span>
          {comingSoon && <Badge variant="secondary">soon</Badge>}
        </div>
        <div className="truncate text-[11px] text-[hsl(var(--color-muted-foreground))]">{subtitle}</div>
      </div>
      <ChevronRight className="size-3.5 text-[hsl(var(--color-muted-foreground))]" />
    </Card>
  );
  return comingSoon ? <div>{inner}</div> : <Link href={href}>{inner}</Link>;
}
