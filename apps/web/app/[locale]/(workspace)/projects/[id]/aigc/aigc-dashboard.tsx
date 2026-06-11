'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

import { trpc } from '@/lib/trpc/client';

interface Props {
  projectId: string;
  locale: string;
  initialStatus?: string;
}

type StatusFilter = 'ALL' | 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

const STATUS_LABELS: Record<StatusFilter, string> = {
  ALL: '全部',
  NOT_STARTED: '未开始',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
};

export function AigcDashboard({
  projectId,
  locale,
  initialStatus,
}: Props): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data: episodes, isLoading } = trpc.aigc.listEpisodes.useQuery({
    projectId,
  });

  const statusFromUrl = (searchParams.get('status') as StatusFilter) ?? null;
  const initialFromProp = initialStatus as StatusFilter | undefined;
  const status: StatusFilter =
    statusFromUrl && STATUS_LABELS[statusFromUrl]
      ? statusFromUrl
      : initialFromProp && STATUS_LABELS[initialFromProp]
        ? initialFromProp
        : 'ALL';

  const setStatus = (next: StatusFilter): void => {
    const params = new URLSearchParams(window.location.search);
    if (next === 'ALL') params.delete('status');
    else params.set('status', next);
    const q = params.toString();
    router.replace(`${pathname}${q ? `?${q}` : ''}`, { scroll: false });
  };

  // W1-W5 audit 三轮 D1:状态分类补"已开始抽卡但没完成任何 group"中间态
  //   - NOT_STARTED:既没完成也没开始抽卡
  //   - IN_PROGRESS:有完成的 group 或 有抽卡记录,但总进度未到 100%
  //   - COMPLETED:所有 group 都完成(totalGroups > 0 必要,空集不算完成)
  const classify = (e: {
    totalGroups: number;
    completedGroups: number;
    generatedTakeCount: number;
  }): 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' => {
    if (e.totalGroups > 0 && e.completedGroups === e.totalGroups) return 'COMPLETED';
    if (e.completedGroups > 0 || e.generatedTakeCount > 0) return 'IN_PROGRESS';
    return 'NOT_STARTED';
  };

  const filtered = React.useMemo(() => {
    if (!episodes) return [];
    if (status === 'ALL') return episodes;
    return episodes.filter((e) => classify(e) === status);
  }, [episodes, status]);

  const stats = React.useMemo(() => {
    if (!episodes) {
      return { total: 0, completed: 0, inProgress: 0, notStarted: 0, totalTakes: 0 };
    }
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;
    let totalTakes = 0;
    for (const e of episodes) {
      totalTakes += e.generatedTakeCount;
      const cls = classify(e);
      if (cls === 'COMPLETED') completed++;
      else if (cls === 'IN_PROGRESS') inProgress++;
      else notStarted++;
    }
    return { total: episodes.length, completed, inProgress, notStarted, totalTakes };
  }, [episodes]);

  return (
    <div className="h-[calc(100vh-2.75rem)] overflow-y-auto bg-[hsl(var(--color-background))] p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-6 text-sm">
          <span className="text-lg font-semibold">AIGC 集数工作台</span>
          <span className="text-[hsl(var(--color-muted-foreground))]">
            <strong className="text-[hsl(var(--color-foreground))]">
              {stats.total}
            </strong>{' '}
            总集数
          </span>
          <span className="text-[hsl(var(--color-muted-foreground))]">
            <strong className="text-[hsl(var(--color-success))]">
              {stats.completed}
            </strong>{' '}
            已完成
          </span>
          <span className="text-[hsl(var(--color-muted-foreground))]">
            <strong className="text-[hsl(var(--color-info))]">
              {stats.inProgress}
            </strong>{' '}
            进行中
          </span>
          <span className="text-[hsl(var(--color-muted-foreground))]">
            <strong>{stats.notStarted}</strong> 未开始
          </span>
          <span className="text-[hsl(var(--color-muted-foreground))]">
            <strong>{stats.totalTakes}</strong> 总抽卡
          </span>
        </div>
        <div className="flex gap-1">
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-md px-3 py-1.5 text-xs ${
                status === s
                  ? 'bg-[hsl(var(--color-accent))] text-[hsl(var(--color-accent-foreground))]'
                  : 'border border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-muted))]'
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-[hsl(var(--color-muted-foreground))]">
          加载中...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[hsl(var(--color-border))] p-12 text-center text-sm text-[hsl(var(--color-muted-foreground))]">
          {status === 'ALL'
            ? '本项目还没有集 — 去导演工作台上传剧本并生成分镜'
            : `没有"${STATUS_LABELS[status]}"状态的集`}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((e) => {
            const progress =
              e.totalGroups > 0 ? e.completedGroups / e.totalGroups : 0;
            const cls = classify(e);
            return (
              <Link
                key={e.id}
                href={`/${locale}/projects/${projectId}/aigc/${e.id}`}
                className="group flex flex-col gap-2 rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-4 transition hover:border-[hsl(var(--color-info))]"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold">
                    {String(e.number).padStart(2, '0')}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      cls === 'COMPLETED'
                        ? 'bg-[hsl(var(--color-success)/0.2)] text-[hsl(var(--color-success))]'
                        : cls === 'IN_PROGRESS'
                          ? 'bg-[hsl(var(--color-info)/0.2)] text-[hsl(var(--color-info))]'
                          : 'bg-[hsl(var(--color-muted))] text-[hsl(var(--color-muted-foreground))]'
                    }`}
                  >
                    {cls === 'COMPLETED'
                      ? '已完成'
                      : cls === 'IN_PROGRESS'
                        ? '进行中'
                        : '未开始'}
                  </span>
                </div>
                <div className="truncate text-sm font-medium">
                  {e.title || `第 ${e.number} 集`}
                </div>
                <div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--color-muted))]">
                    <div
                      className="h-full bg-[hsl(var(--color-info))] transition-all"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-[hsl(var(--color-muted-foreground))]">
                    <span>
                      {e.completedGroups}/{e.totalGroups} 段
                    </span>
                    <span>{Math.round(progress * 100)}%</span>
                  </div>
                </div>
                <div className="flex justify-between text-[10px] text-[hsl(var(--color-muted-foreground))]">
                  <span>抽卡 {e.generatedTakeCount}</span>
                  <span>
                    {e.updatedAt
                      ? new Date(e.updatedAt).toLocaleDateString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                        })
                      : ''}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
