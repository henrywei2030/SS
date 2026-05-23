'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

import { trpc } from '@/lib/trpc/client';
import { formatCny } from '@/lib/utils';

function successRateColor(rate: number): string {
  if (rate >= 0.7) return 'text-green-600 dark:text-green-400';
  if (rate >= 0.4) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

/** 成功率图标(色弱友好,跟颜色双轨表达) */
function successRateIcon(rate: number): string {
  if (rate >= 0.7) return '✓';
  if (rate >= 0.4) return '!';
  return '✗';
}

interface Props {
  projectId: string;
  locale: string;
  initialDays: 7 | 30 | 90;
}

type Period = 7 | 30 | 90;

export function InsightsView({
  projectId,
  locale,
  initialDays,
}: Props): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const daysFromUrl = Number(searchParams.get('days'));
  const days: Period =
    daysFromUrl === 7 || daysFromUrl === 30 || daysFromUrl === 90
      ? (daysFromUrl as Period)
      : initialDays;

  const setDays = (next: Period): void => {
    const params = new URLSearchParams(window.location.search);
    if (next === 30) params.delete('days');
    else params.set('days', String(next));
    const q = params.toString();
    router.replace(`${pathname}${q ? `?${q}` : ''}`, { scroll: false });
  };

  const overviewQ = trpc.insights.getProjectOverview.useQuery({ projectId, days });
  const modelDistQ = trpc.insights.getModelDistribution.useQuery({ projectId, days });
  const topGroupsQ = trpc.insights.getTopShotGroupsByGachaRate.useQuery({
    projectId,
    limit: 10,
    days,
  });

  const overview = overviewQ.data;
  const models = modelDistQ.data;
  const topGroups = topGroupsQ.data;

  const maxDayCost = React.useMemo(() => {
    if (!overview) return 0;
    return Math.max(0, ...overview.costByDay.map((d) => d.cost));
  }, [overview]);

  const maxModelCost = React.useMemo(() => {
    if (!models || models.length === 0) return 0;
    return Math.max(0, ...models.map((m) => m.totalCost));
  }, [models]);

  return (
    <div className="h-[calc(100vh-2.75rem)] overflow-y-auto bg-[hsl(var(--color-background))] p-6">
      {/* 顶部:标题 + 时段筛选 */}
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">数据洞察</h1>
          <p className="mt-0.5 text-xs text-[hsl(var(--color-muted-foreground))]">
            成本 / 抽卡率 / 模型分布 — 近 {days} 天
          </p>
        </div>
        {/* W6 audit P1:role=tablist + aria-selected,屏幕阅读器友好 */}
        <div role="tablist" aria-label="时间段" className="flex gap-1">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={days === d}
              onClick={() => setDays(d)}
              className={`rounded-md px-3 py-1.5 text-xs ${
                days === d
                  ? 'bg-[hsl(var(--color-accent))] text-[hsl(var(--color-accent-foreground))]'
                  : 'border border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-muted))]'
              }`}
            >
              {d} 天
            </button>
          ))}
        </div>
      </header>

      {/* W6 audit P0 H:3 query 任一失败显示统一错误条 */}
      {(overviewQ.isError || modelDistQ.isError || topGroupsQ.isError) && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
          <div className="font-semibold">部分数据加载失败</div>
          <div className="mt-1 opacity-80">
            {overviewQ.isError && '总览加载失败 · '}
            {modelDistQ.isError && '模型分布加载失败 · '}
            {topGroupsQ.isError && '抽卡 Top10 加载失败 · '}
          </div>
          <button
            onClick={() => {
              if (overviewQ.isError) overviewQ.refetch();
              if (modelDistQ.isError) modelDistQ.refetch();
              if (topGroupsQ.isError) topGroupsQ.refetch();
            }}
            className="mt-2 rounded border border-red-500/50 px-2 py-1 text-xs hover:bg-red-500/20"
          >
            重试
          </button>
        </div>
      )}

      {/* KPI 卡 × 4(W6 audit P0 G:"成功 ¥" 用真 successCostCny;P0 F:计数用 attempt 单一来源) */}
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="总成本"
          value={overview ? formatCny(overview.totalCostCny) : '—'}
          sub={overview ? `成功 ${formatCny(overview.successCostCny)}` : ''}
          loading={overviewQ.isLoading}
        />
        <KpiCard
          label="总抽卡"
          value={overview ? String(overview.totalAttempts) : '—'}
          sub={
            overview
              ? `成功 ${overview.successCount} · 失败 ${overview.failedCount}${overview.runningCount > 0 ? ` · 进行中 ${overview.runningCount}` : ''}`
              : ''
          }
          loading={overviewQ.isLoading}
        />
        <KpiCard
          label="成功率"
          value={overview ? `${Math.round(overview.successRate * 100)}%` : '—'}
          sub={overview && overview.totalAttempts > 0 ? `共 ${overview.totalAttempts} 次抽卡` : '暂无数据'}
          loading={overviewQ.isLoading}
        />
        <KpiCard
          label="活跃天数"
          value={overview ? `${overview.activeDays}/${days}` : '—'}
          sub={overview ? `${Math.round((overview.activeDays / days) * 100)}% 工作日活跃` : ''}
          loading={overviewQ.isLoading}
        />
      </section>

      {/* 中部:成本趋势 + 模型分布 */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 成本趋势(2/3 宽) */}
        <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">日成本趋势</h2>
            {overview && (
              <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
                单日峰值 ¥{maxDayCost.toFixed(2)}
              </span>
            )}
          </div>
          {overviewQ.isLoading ? (
            <div className="h-32 animate-pulse rounded bg-[hsl(var(--color-muted))]" />
          ) : !overview || overview.totalAttempts === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-[hsl(var(--color-muted-foreground))]">
              暂无数据 — 跑一次抽卡后再来看
            </div>
          ) : (
            <div className="flex h-32 items-end gap-0.5">
              {overview.costByDay.map((d) => {
                const h = maxDayCost > 0 ? (d.cost / maxDayCost) * 100 : 0;
                return (
                  <div
                    key={d.date}
                    className="group relative flex-1"
                    title={`${d.date}: ${formatCny(d.cost)}`}
                  >
                    <div
                      className={`mx-auto w-full rounded-t transition-all ${
                        d.cost > 0
                          ? 'bg-blue-500/70 group-hover:bg-blue-500'
                          : 'bg-[hsl(var(--color-muted))]'
                      }`}
                      style={{ height: `${Math.max(h, 2)}%` }}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {overview && (
            <div className="mt-2 flex justify-between text-[10px] text-[hsl(var(--color-muted-foreground))]">
              <span>{overview.costByDay[0]?.date}</span>
              <span>{overview.costByDay[overview.costByDay.length - 1]?.date}</span>
            </div>
          )}
        </div>

        {/* kind 分布(1/3 宽)— W6 audit:含 compliance/analysis 完整 7 类 */}
        <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-4">
          <h2 className="mb-3 text-sm font-semibold">按类型分布</h2>
          {overviewQ.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-[hsl(var(--color-muted))]" />
              ))}
            </div>
          ) : !overview || overview.totalCostCny === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-[hsl(var(--color-muted-foreground))]">
              暂无成本
            </div>
          ) : (
            <div className="space-y-2 text-xs">
              {(
                [
                  { k: 'video' as const, label: '视频' },
                  { k: 'image' as const, label: '图像' },
                  { k: 'text' as const, label: 'LLM' },
                  { k: 'audio' as const, label: '音频' },
                  { k: 'compliance' as const, label: '合规' },
                  { k: 'analysis' as const, label: '分析' },
                  { k: 'other' as const, label: '其他' },
                ] as const
              )
                .filter(({ k }) => overview.costByKind[k] > 0)
                .map(({ k, label }) => {
                  const c = overview.costByKind[k];
                  const pct =
                    overview.totalCostCny > 0 ? (c / overview.totalCostCny) * 100 : 0;
                  return <KindBar key={k} label={label} cost={c} pct={pct} />;
                })}
            </div>
          )}
        </div>
      </section>

      {/* 模型分布 */}
      <section className="mb-6 rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-4">
        <h2 className="mb-3 text-sm font-semibold">模型调用分布</h2>
        {modelDistQ.isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-6 animate-pulse rounded bg-[hsl(var(--color-muted))]" />
            ))}
          </div>
        ) : !models || models.length === 0 ? (
          <div className="py-6 text-center text-xs text-[hsl(var(--color-muted-foreground))]">
            暂无调用记录
          </div>
        ) : (
          <div className="space-y-2 text-xs">
            {models.map((m) => {
              const pct = maxModelCost > 0 ? (m.totalCost / maxModelCost) * 100 : 0;
              return (
                <div key={`${m.providerId}::${m.modelId}`} className="space-y-1">
                  <div className="flex items-center justify-between">
                    {/* W6 audit P0 I:显示 providerId / modelId,同 provider 不同 model 区分 */}
                    <span className="font-mono">
                      {m.providerId}
                      {m.modelId !== m.providerId && (
                        <span className="text-[hsl(var(--color-muted-foreground))]"> / {m.modelId}</span>
                      )}
                    </span>
                    <span className="text-[hsl(var(--color-muted-foreground))]">
                      {formatCny(m.totalCost)} · {m.total} 次 ·{' '}
                      {/* W6 audit P1:色弱友好图标 + 颜色双轨 */}
                      <span className={successRateColor(m.successRate)}>
                        <span aria-hidden="true">{successRateIcon(m.successRate)}</span> 成功率{' '}
                        {Math.round(m.successRate * 100)}%
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--color-muted))]">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 抽卡 Top10 */}
      <section className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">抽卡 Top10 生成段</h2>
          <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
            按抽卡次数倒序 — 频繁抽卡 = 难生成 = 关注点
          </span>
        </div>
        {topGroupsQ.isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-[hsl(var(--color-muted))]" />
            ))}
          </div>
        ) : !topGroups || topGroups.length === 0 ? (
          <div className="py-6 text-center text-xs text-[hsl(var(--color-muted-foreground))]">
            还没有视频抽卡记录 — 去 AIGC 工作台开始第一次抽卡
          </div>
        ) : (
          // W6 audit P0 J:thead sticky;P1 表格容器加 max-h 让 sticky 真生效
          <div className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-[hsl(var(--color-card))] text-[10px] text-[hsl(var(--color-muted-foreground))]">
                <tr className="border-b border-[hsl(var(--color-border))]">
                  <th className="py-2 text-left font-medium">#</th>
                  <th className="py-2 text-left font-medium">集 / 段</th>
                  <th className="py-2 text-right font-medium">抽卡</th>
                  <th className="py-2 text-right font-medium">成功率</th>
                  <th className="py-2 text-right font-medium">总成本</th>
                  <th className="py-2 text-right font-medium">¥/成功</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {topGroups.map((g, idx) => (
                  <tr
                    key={g.groupId}
                    className="border-b border-[hsl(var(--color-border))]/50 transition-colors hover:bg-[hsl(var(--color-muted))]"
                  >
                    <td className="py-2 text-[hsl(var(--color-muted-foreground))]">
                      {String(idx + 1).padStart(2, '0')}
                    </td>
                    <td className="py-2">
                      <div className="font-medium">{g.label}</div>
                      <div className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                        第 {g.episodeNumber} 集
                        {g.episodeTitle && ` · ${g.episodeTitle}`}
                      </div>
                    </td>
                    <td className="py-2 text-right font-mono">
                      {g.attempts}
                      {g.running > 0 && (
                        <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">
                          +{g.running}⋯
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <span className={successRateColor(g.attemptSuccessRate)}>
                        <span aria-hidden="true">{successRateIcon(g.attemptSuccessRate)}</span>{' '}
                        {Math.round(g.attemptSuccessRate * 100)}%
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono">{formatCny(g.totalCostCny)}</td>
                    <td className="py-2 text-right font-mono">
                      {g.costPerSuccessCny != null ? formatCny(g.costPerSuccessCny) : '—'}
                    </td>
                    <td className="py-2 text-right">
                      {g.episodeId && (
                        <Link
                          href={`/${locale}/projects/${projectId}/aigc/${g.episodeId}?g=${g.groupId}`}
                          className="text-[10px] text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
                        >
                          去抽卡 →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helper components
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  sub,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  loading?: boolean;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-4">
      <div className="text-xs text-[hsl(var(--color-muted-foreground))]">{label}</div>
      {loading ? (
        <div className="mt-2 h-7 w-20 animate-pulse rounded bg-[hsl(var(--color-muted))]" />
      ) : (
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      )}
      {sub && (
        <div className="mt-0.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">{sub}</div>
      )}
    </div>
  );
}

function KindBar({
  label,
  cost,
  pct,
}: {
  label: string;
  cost: number;
  pct: number;
}): React.ReactElement {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <span className="font-mono text-[hsl(var(--color-muted-foreground))]">
          {formatCny(cost)} · {pct.toFixed(0)}%
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--color-muted))]">
        <div
          className="h-full bg-blue-500 transition-all"
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>
    </div>
  );
}
