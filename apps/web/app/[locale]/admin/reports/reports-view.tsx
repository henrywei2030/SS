'use client';
import * as React from 'react';
import { Shield, Crown, Activity, Clock } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';

function Avatar({ name, url }: { name: string; url?: string | null }): React.ReactElement {
  const initial = name.charAt(0).toUpperCase();
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="size-6 rounded-full object-cover" />;
  }
  return (
    <div className="flex size-6 items-center justify-center rounded-full bg-[hsl(var(--color-muted))] text-[10px] font-medium">
      {initial}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'success' | 'danger';
}): React.ReactElement {
  const toneClass =
    tone === 'success'
      ? 'text-green-700 dark:text-green-400'
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

export function ReportsView(): React.ReactElement {
  const [days, setDays] = React.useState(30);
  const { data, isLoading, isError, error, refetch } =
    trpc.admin.reports.memberStats.useQuery({ days });

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">工作报告</h1>
          <p className="mt-1 text-sm text-[hsl(var(--color-muted-foreground))]">
            成员维度聚合:抽卡 · 成本 · 集分配 · 操作活跃度
          </p>
        </div>
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
      </header>

      {isError && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
          <div className="font-semibold">报告加载失败</div>
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
          {/* KPI 4 卡 */}
          <div className="grid grid-cols-4 gap-4">
            <KpiCard
              label="活跃成员"
              value={data.totals.activeUsers}
              hint={`近 ${data.days} 天有动作`}
            />
            <KpiCard
              label="总操作数"
              value={data.totals.totalOps.toLocaleString()}
              hint="OperationLog 计数"
            />
            <KpiCard
              label="抽卡总成本"
              value={`¥${data.totals.totalCost.toFixed(2)}`}
              hint={`成功 ${data.totals.totalSuccess} · 失败 ${data.totals.totalFailed}`}
            />
            <KpiCard
              label="平均成功率"
              value={
                data.totals.totalSuccess + data.totals.totalFailed > 0
                  ? `${Math.round((data.totals.totalSuccess / (data.totals.totalSuccess + data.totals.totalFailed)) * 100)}%`
                  : '—'
              }
              tone={data.totals.totalSuccess > 0 ? 'success' : 'default'}
            />
          </div>

          {/* 成员表 */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">成员明细</h2>
            <div className="overflow-hidden rounded-md border border-[hsl(var(--color-border))]">
              <table className="w-full text-xs">
                <thead className="bg-[hsl(var(--color-muted))]">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">成员</th>
                    <th className="w-20 px-3 py-2 text-left font-medium">角色</th>
                    <th className="w-24 px-3 py-2 text-right font-medium">项目</th>
                    <th className="w-24 px-3 py-2 text-right font-medium">集分配</th>
                    <th className="w-32 px-3 py-2 text-right font-medium">操作数</th>
                    <th className="w-32 px-3 py-2 text-right font-medium">抽卡</th>
                    <th className="w-32 px-3 py-2 text-right font-medium">成本</th>
                    <th className="w-32 px-3 py-2 text-left font-medium">上次登录</th>
                  </tr>
                </thead>
                <tbody>
                  {data.userStats.map((u) => {
                    const totalDone = u.attemptSuccess + u.attemptFailed;
                    const successRate =
                      totalDone > 0
                        ? Math.round((u.attemptSuccess / totalDone) * 100)
                        : null;
                    return (
                      <tr
                        key={u.userId}
                        className="border-t border-[hsl(var(--color-border))]"
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Avatar name={u.displayName} url={u.avatarUrl} />
                            <div>
                              <div className="font-medium">{u.displayName}</div>
                              <div className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                                {u.email}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {u.isAdmin ? (
                            <span className="inline-flex items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">
                              <Shield className="size-2.5" />
                              admin
                            </span>
                          ) : (
                            <span className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                              user
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-[hsl(var(--color-muted-foreground))]">
                          {u.ownedProjects > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-purple-700 dark:text-purple-400">
                              <Crown className="size-2.5" />
                              {u.ownedProjects}
                            </span>
                          )}
                          {u.ownedProjects > 0 && u.memberships > 0 && <span> · </span>}
                          {u.memberships > 0 && <span>{u.memberships}</span>}
                          {u.ownedProjects === 0 && u.memberships === 0 && '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {u.assignments > 0 ? u.assignments : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {u.operations > 0 ? (
                            <span className="inline-flex items-center gap-0.5">
                              <Activity className="size-2.5 text-[hsl(var(--color-muted-foreground))]" />
                              {u.operations.toLocaleString()}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-[10px] tabular-nums">
                          {totalDone > 0 ? (
                            <>
                              <span className="text-green-700 dark:text-green-400">
                                {u.attemptSuccess}
                              </span>
                              {u.attemptFailed > 0 && (
                                <>
                                  <span className="mx-0.5 text-[hsl(var(--color-muted-foreground))]">/</span>
                                  <span className="text-red-700 dark:text-red-400">
                                    {u.attemptFailed}
                                  </span>
                                </>
                              )}
                              {u.attemptInflight > 0 && (
                                <span className="ml-1 text-amber-700 dark:text-amber-400">
                                  +{u.attemptInflight}⋯
                                </span>
                              )}
                              {successRate !== null && (
                                <div className="text-[hsl(var(--color-muted-foreground))]">
                                  {successRate}% 成功
                                </div>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {u.cost > 0 ? `¥${u.cost.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                          {u.lastLoginAt ? (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="size-2.5" />
                              {new Date(u.lastLoginAt).toLocaleDateString()}
                            </span>
                          ) : (
                            '从未登录'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {data.userStats.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-8 text-center text-[hsl(var(--color-muted-foreground))]"
                      >
                        近 {data.days} 天没有成员活动 — 等数据攒起来再看
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="text-right text-[10px] text-[hsl(var(--color-muted-foreground))]">
            统计窗口:近 {data.days} 天 · 排序:成本降序(贡献最多在上)
          </div>
        </div>
      )}
    </div>
  );
}
