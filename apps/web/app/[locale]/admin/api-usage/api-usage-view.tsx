'use client';
import * as React from 'react';

import { trpc } from '@/lib/trpc/client';

function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}): React.ReactElement {
  const toneClass =
    tone === 'success'
      ? 'text-green-700 dark:text-green-400'
      : tone === 'warning'
        ? 'text-amber-700 dark:text-amber-400'
        : tone === 'danger'
          ? 'text-red-700 dark:text-red-400'
          : '';
  return (
    <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-4">
      <div className="text-xs text-[hsl(var(--color-muted-foreground))]">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-[10px] text-[hsl(var(--color-muted-foreground))]">
          {hint}
        </div>
      )}
    </div>
  );
}

function DailyTrend({
  data,
}: {
  data: Array<{ day: string; total: number; cost: number }>;
}): React.ReactElement {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-[hsl(var(--color-muted-foreground))]">
        无数据
      </div>
    );
  }
  const maxCost = Math.max(...data.map((d) => d.cost), 0.01);
  const W = 600;
  const H = 120;
  const stepX = data.length > 1 ? W / (data.length - 1) : W;

  const pts = data.map((d, i) => {
    const x = i * stepX;
    const y = H - (d.cost / maxCost) * (H - 10);
    return `${x},${y}`;
  });

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        preserveAspectRatio="none"
      >
        <polyline
          fill="none"
          stroke="hsl(217 91% 60%)"
          strokeWidth="1.5"
          points={pts.join(' ')}
        />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-[hsl(var(--color-muted-foreground))]">
        <span>{data[0]?.day}</span>
        <span>峰值 ¥{maxCost.toFixed(2)}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  );
}

export function ApiUsageView(): React.ReactElement {
  const [days, setDays] = React.useState(30);
  const [exporting, setExporting] = React.useState(false);
  const { data, isLoading, isError, error, refetch } =
    trpc.admin.apiUsage.summary.useQuery({ days });

  // Phase 1.5 P0-4(主次重审 v2.1):CSV 导出 — 拿到 csv string 直接 Blob 下载
  const utils = trpc.useUtils();
  const handleExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const result = await utils.admin.apiUsage.exportCsv.fetch({
        days,
        includePrepayRefund: true,
      });
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (result.truncated) {
        alert(`已导出 ${result.rowCount} 行(已达上限,需更多请按用户/项目筛选或缩短时间范围)`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`导出失败:${msg}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">API 用量</h1>
          <p className="mt-1 text-sm text-[hsl(var(--color-muted-foreground))]">
            GenerationAttempt + CostLedger 全局聚合 — 跨项目用量 / 成本 / 分布
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting || !data}
            className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
            title="导出 CostLedger CSV(含 PREPAY/REFUND 完整审计)"
          >
            {exporting ? '导出中...' : '导出 CSV'}
          </button>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 py-1.5 text-xs"
          >
            <option value={7}>近 7 天</option>
            <option value={14}>近 14 天</option>
            <option value={30}>近 30 天</option>
            <option value={60}>近 60 天</option>
            <option value={90}>近 90 天</option>
          </select>
        </div>
      </header>

      {isError && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
          <div className="font-semibold">用量数据加载失败</div>
          <div className="mt-1 opacity-80">{error?.message}</div>
          <button
            onClick={() => refetch()}
            className="mt-2 rounded border border-red-500/50 px-2 py-1 text-xs hover:bg-red-500/20"
          >
            重试
          </button>
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-[hsl(var(--color-muted-foreground))]">加载中...</div>
      )}

      {data && (
        <div className="space-y-6">
          {/* KPI */}
          <div className="grid grid-cols-4 gap-4">
            <KpiCard
              label="总调用次数"
              value={data.overall.total.toLocaleString()}
              hint={`近 ${data.days} 天`}
            />
            <KpiCard
              label="成功"
              value={data.overall.success.toLocaleString()}
              hint={`${data.overall.total > 0 ? Math.round((data.overall.success / data.overall.total) * 100) : 0}% 成功率`}
              tone="success"
            />
            <KpiCard
              label="失败"
              value={data.overall.failed.toLocaleString()}
              hint={data.overall.inflight > 0 ? `进行中 ${data.overall.inflight}` : '—'}
              tone={data.overall.failed > 0 ? 'danger' : 'default'}
            />
            <KpiCard
              label="累计成本"
              value={`¥${data.overall.totalCostCny.toFixed(2)}`}
              hint={`日均 ¥${(data.overall.totalCostCny / data.days).toFixed(2)}`}
            />
          </div>

          {/* 日趋势 */}
          <section className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-4">
            <h2 className="mb-3 text-sm font-semibold">日成本趋势</h2>
            <DailyTrend data={data.dailyTrend} />
          </section>

          {/* 按 Provider */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">按 Provider</h2>
            <div className="overflow-hidden rounded-md border border-[hsl(var(--color-border))]">
              <table className="w-full text-xs">
                <thead className="bg-[hsl(var(--color-muted))]">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Provider</th>
                    <th className="px-3 py-2 text-right font-medium">成功</th>
                    <th className="px-3 py-2 text-right font-medium">失败</th>
                    <th className="px-3 py-2 text-right font-medium">进行中</th>
                    <th className="px-3 py-2 text-right font-medium">成本</th>
                    <th className="px-3 py-2 text-right font-medium">成功率</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byProvider.map((p) => {
                    const totalDone = p.success + p.failed;
                    const successRate =
                      totalDone > 0 ? Math.round((p.success / totalDone) * 100) : 0;
                    return (
                      <tr
                        key={p.providerId}
                        className="border-t border-[hsl(var(--color-border))]"
                      >
                        <td className="px-3 py-2 font-mono">{p.providerId}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-green-700 dark:text-green-400">
                          {p.success.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-700 dark:text-red-400">
                          {p.failed.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700 dark:text-amber-400">
                          {p.inflight.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          ¥{p.cost.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[hsl(var(--color-muted-foreground))]">
                          {totalDone > 0 ? `${successRate}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {data.byProvider.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-6 text-center text-[hsl(var(--color-muted-foreground))]"
                      >
                        无数据
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* 按 Action */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">按业务动作</h2>
            <div className="overflow-hidden rounded-md border border-[hsl(var(--color-border))]">
              <table className="w-full text-xs">
                <thead className="bg-[hsl(var(--color-muted))]">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Action</th>
                    <th className="px-3 py-2 text-right font-medium">调用次数</th>
                    <th className="px-3 py-2 text-left font-medium">占比</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byAction.map((a) => {
                    const pct =
                      data.overall.total > 0
                        ? Math.round((a.count / data.overall.total) * 100)
                        : 0;
                    return (
                      <tr
                        key={a.action}
                        className="border-t border-[hsl(var(--color-border))]"
                      >
                        <td className="px-3 py-2 font-mono">{a.action}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {a.count.toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--color-muted))]">
                              <div
                                className="h-full bg-blue-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-10 text-right text-[10px] tabular-nums text-[hsl(var(--color-muted-foreground))]">
                              {pct}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {data.byAction.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-6 text-center text-[hsl(var(--color-muted-foreground))]"
                      >
                        无数据
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* 2026-05-27 用户反馈:视频生成明细复盘 — 每次操作完整记录 */}
          <VideoAttemptsSection />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 视频生成明细复盘(2026-05-27 用户反馈)
// 列:时间 / 项目 / Ep-Group / Provider / Status / 耗时 / 成本 / errorMsg / 操作员
// ============================================================================
function VideoAttemptsSection(): React.ReactElement {
  const [statusFilter, setStatusFilter] = React.useState<
    'ALL' | 'SUCCESS' | 'FAILED' | 'RUNNING'
  >('ALL');
  const [limit, setLimit] = React.useState(50);
  const { data: rows, isLoading } = trpc.admin.apiUsage.videoAttempts.useQuery({
    limit,
    statusFilter,
  });

  const statusBadgeClass = (s: string): string => {
    if (s === 'SUCCESS') return 'bg-green-600/20 text-green-700 dark:text-green-400';
    if (s === 'FAILED') return 'bg-red-600/20 text-red-700 dark:text-red-400';
    if (s === 'RUNNING' || s === 'QUEUED')
      return 'bg-amber-500/20 text-amber-700 dark:text-amber-400';
    return 'bg-[hsl(var(--color-muted))] text-[hsl(var(--color-muted-foreground))]';
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">视频生成明细(复盘)</h2>
        <div className="flex items-center gap-2 text-xs">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value as 'ALL' | 'SUCCESS' | 'FAILED' | 'RUNNING',
              )
            }
            className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1"
          >
            <option value="ALL">全部状态</option>
            <option value="SUCCESS">仅成功</option>
            <option value="FAILED">仅失败</option>
            <option value="RUNNING">仅进行中</option>
          </select>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1"
          >
            <option value={20}>近 20 条</option>
            <option value={50}>近 50 条</option>
            <option value={100}>近 100 条</option>
            <option value={200}>近 200 条</option>
          </select>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-[hsl(var(--color-border))]">
        <table className="w-full text-xs">
          <thead className="bg-[hsl(var(--color-muted))]">
            <tr>
              <th className="px-2 py-2 text-left font-medium">时间</th>
              <th className="px-2 py-2 text-left font-medium">项目 / Ep / 组</th>
              <th className="px-2 py-2 text-left font-medium">Provider</th>
              <th className="px-2 py-2 text-left font-medium">状态</th>
              <th className="px-2 py-2 text-right font-medium">耗时</th>
              <th className="px-2 py-2 text-right font-medium">成本</th>
              <th className="px-2 py-2 text-left font-medium">错误 / 操作员</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-[hsl(var(--color-muted-foreground))]"
                >
                  加载中...
                </td>
              </tr>
            )}
            {rows && rows.length === 0 && !isLoading && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-[hsl(var(--color-muted-foreground))]"
                >
                  无数据
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr
                key={r.id}
                className="border-t border-[hsl(var(--color-border))] align-top"
              >
                <td className="px-2 py-2 tabular-nums text-[10px]">
                  <div>{new Date(r.createdAt).toLocaleString()}</div>
                  <div className="text-[hsl(var(--color-muted-foreground))]">
                    {r.id.slice(-8)}
                  </div>
                </td>
                <td className="px-2 py-2 text-[10px]">
                  <div className="font-medium">{r.projectName ?? '—'}</div>
                  <div className="text-[hsl(var(--color-muted-foreground))]">
                    Ep{r.episodeNumber ?? '?'} · 组 {r.groupNumber ?? '?'}
                  </div>
                  {r.aspectRatio && r.durationS && (
                    <div className="text-[9px] text-[hsl(var(--color-muted-foreground))]">
                      {r.aspectRatio} · {r.durationS}s
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 font-mono text-[10px]">
                  <div>{r.providerId}</div>
                  {r.providerJobId && (
                    <div className="text-[9px] text-[hsl(var(--color-muted-foreground))]">
                      {r.providerJobId}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(r.status)}`}
                  >
                    {r.status}
                  </span>
                  {r.rejected && (
                    <span className="ml-1 text-[9px] text-[hsl(var(--color-muted-foreground))]">
                      已删除
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-[10px]">
                  {r.durationMs
                    ? `${Math.round(r.durationMs / 100) / 10} s`
                    : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-[10px] font-medium">
                  ¥{Number(r.costCny).toFixed(2)}
                </td>
                <td className="max-w-xs px-2 py-2 text-[10px]">
                  {r.errorMsg && (
                    <div className="break-words text-red-700 dark:text-red-400">
                      ❌ {r.errorMsg}
                    </div>
                  )}
                  <div className="mt-0.5 text-[hsl(var(--color-muted-foreground))]">
                    {r.createdBy?.displayName ?? r.createdBy?.email ?? '系统'}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
