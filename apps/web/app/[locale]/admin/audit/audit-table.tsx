'use client';
import * as React from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';

export function AuditTable(): React.ReactElement {
  const [page, setPage] = React.useState(1);
  const [pageSize] = React.useState(50);
  const [filterAction, setFilterAction] = React.useState('');
  const [filterTargetType, setFilterTargetType] = React.useState('');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } =
    trpc.admin.audit.list.useQuery({
      page,
      pageSize,
      action: filterAction.trim() || undefined,
      targetType: filterTargetType.trim() || undefined,
    });

  const { data: targetTypes } = trpc.admin.audit.distinctTargetTypes.useQuery();

  React.useEffect(() => {
    setPage(1);
  }, [filterAction, filterTargetType]);

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">操作日志</h1>
          <p className="mt-1 text-sm text-[hsl(var(--color-muted-foreground))]">
            OperationLog 全局审计 — 跟踪每一次 mutation 的 actor / before / after
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
        >
          {isFetching ? '刷新中...' : '刷新'}
        </button>
      </header>

      {/* 筛选栏 */}
      <div className="mb-4 flex items-center gap-2 text-xs">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[hsl(var(--color-muted-foreground))]" />
          <input
            type="text"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            placeholder="搜索 action(如 aigc.generate / asset.create)"
            className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] py-1.5 pl-7 pr-2 text-xs"
          />
        </div>
        <select
          value={filterTargetType}
          onChange={(e) => setFilterTargetType(e.target.value)}
          className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
        >
          <option value="">全部 targetType</option>
          {targetTypes?.map((t) => (
            <option key={t.targetType} value={t.targetType}>
              {t.targetType} ({t.count})
            </option>
          ))}
        </select>
        {(filterAction || filterTargetType) && (
          <button
            onClick={() => {
              setFilterAction('');
              setFilterTargetType('');
            }}
            className="rounded-md border border-[hsl(var(--color-border))] px-2 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))]"
          >
            清空筛选
          </button>
        )}
      </div>

      {isError && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
          <div className="font-semibold">日志加载失败</div>
          <div className="mt-1 opacity-80">{error?.message}</div>
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-[hsl(var(--color-muted-foreground))]">加载中...</div>
      )}

      {data && (
        <>
          <div className="overflow-hidden rounded-md border border-[hsl(var(--color-border))]">
            <table className="w-full text-xs">
              <thead className="bg-[hsl(var(--color-muted))]">
                <tr>
                  <th className="w-8 px-2 py-2" />
                  <th className="w-40 px-3 py-2 text-left font-medium">时间</th>
                  <th className="px-3 py-2 text-left font-medium">Actor</th>
                  <th className="px-3 py-2 text-left font-medium">Action</th>
                  <th className="px-3 py-2 text-left font-medium">Target</th>
                  <th className="px-3 py-2 text-left font-medium">Project</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((l) => {
                  const isExpanded = expandedId === l.id;
                  return (
                    <React.Fragment key={l.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : l.id)}
                        className="cursor-pointer border-t border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-muted))]/50"
                      >
                        <td className="px-2 py-2">
                          {isExpanded ? (
                            <ChevronDown className="size-3" />
                          ) : (
                            <ChevronRight className="size-3" />
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] text-[hsl(var(--color-muted-foreground))]">
                          {new Date(l.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">{l.actorName}</td>
                        <td className="px-3 py-2 font-mono">{l.action}</td>
                        <td className="px-3 py-2">
                          <span className="rounded bg-[hsl(var(--color-muted))] px-1.5 py-0.5 text-[10px]">
                            {l.targetType}
                          </span>
                          <span className="ml-2 font-mono text-[10px] text-[hsl(var(--color-muted-foreground))]">
                            {l.targetId.slice(0, 8)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[hsl(var(--color-muted-foreground))]">
                          {l.projectName ?? '—'}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-t border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))]/30">
                          <td colSpan={6} className="px-3 py-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <div className="mb-1 text-[10px] font-medium text-[hsl(var(--color-muted-foreground))]">
                                  before
                                </div>
                                <pre className="max-h-64 overflow-auto rounded bg-[hsl(var(--color-background))] p-2 font-mono text-[10px]">
                                  {l.beforeJson
                                    ? JSON.stringify(l.beforeJson, null, 2)
                                    : '(null)'}
                                </pre>
                              </div>
                              <div>
                                <div className="mb-1 text-[10px] font-medium text-[hsl(var(--color-muted-foreground))]">
                                  after
                                </div>
                                <pre className="max-h-64 overflow-auto rounded bg-[hsl(var(--color-background))] p-2 font-mono text-[10px]">
                                  {l.afterJson
                                    ? JSON.stringify(l.afterJson, null, 2)
                                    : '(null)'}
                                </pre>
                              </div>
                            </div>
                            {(l.ip || l.userAgent) && (
                              <div className="mt-2 flex gap-4 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                                {l.ip && <span>IP: {l.ip}</span>}
                                {l.userAgent && (
                                  <span className="truncate">UA: {l.userAgent}</span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {data.logs.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-8 text-center text-[hsl(var(--color-muted-foreground))]"
                    >
                      没有匹配的日志
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          <div className="mt-3 flex items-center justify-between text-xs">
            <div className="text-[hsl(var(--color-muted-foreground))]">
              共 {data.total} 条 · 第 {page} 页 / {Math.ceil(data.total / pageSize) || 1} 页
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="rounded border border-[hsl(var(--color-border))] px-3 py-1 hover:bg-[hsl(var(--color-muted))] disabled:opacity-30"
              >
                上一页
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!data.hasMore}
                className="rounded border border-[hsl(var(--color-border))] px-3 py-1 hover:bg-[hsl(var(--color-muted))] disabled:opacity-30"
              >
                下一页
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
