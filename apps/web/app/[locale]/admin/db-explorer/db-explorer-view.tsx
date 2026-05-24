'use client';
import * as React from 'react';
import { Database, RefreshCw, Copy } from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';

export function DbExplorerView(): React.ReactElement {
  const [selectedTable, setSelectedTable] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const pageSize = 50;

  const { data: tables, isLoading: tablesLoading, refetch: refetchTables } =
    trpc.admin.dbExplorer.listTables.useQuery();

  const {
    data: rowData,
    isLoading: rowsLoading,
    isError: rowsError,
    error: rowsErr,
  } = trpc.admin.dbExplorer.queryTable.useQuery(
    // 类型断言:selectedTable 校验后才 query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { table: selectedTable as any, page, pageSize },
    { enabled: !!selectedTable },
  );

  React.useEffect(() => {
    setPage(1);
  }, [selectedTable]);

  const copyJson = (obj: unknown): void => {
    try {
      void navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
      toast.success('已复制 JSON 到剪贴板');
    } catch (e) {
      toast.error(`复制失败:${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Database className="size-5" />
            数据库浏览器
          </h1>
          <p className="mt-1 text-sm text-[hsl(var(--color-muted-foreground))]">
            白名单只读 — 替代 Prisma Studio MVP · Phase 2 加 inline edit + 自定义 SQL
          </p>
        </div>
        <button
          onClick={() => void refetchTables()}
          className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))]"
        >
          <RefreshCw className="size-3" />
          刷新表
        </button>
      </header>

      <div className="grid grid-cols-[240px_1fr] gap-4">
        {/* 左:表列表 */}
        <aside className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]">
          <div className="border-b border-[hsl(var(--color-border))] px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
            白名单表({tables?.length ?? 0})
          </div>
          {tablesLoading && (
            <div className="p-3 text-xs text-[hsl(var(--color-muted-foreground))]">加载中...</div>
          )}
          {tables && (
            <div className="max-h-[calc(100vh-200px)] overflow-y-auto p-1">
              {tables.map((t) => (
                <button
                  key={t.table}
                  onClick={() => setSelectedTable(t.table)}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
                    selectedTable === t.table
                      ? 'bg-blue-500/15 text-blue-700 dark:text-blue-400'
                      : 'hover:bg-[hsl(var(--color-muted))]'
                  }`}
                >
                  <span className="font-mono">{t.table}</span>
                  {t.error ? (
                    <span className="text-[9px] text-red-600 dark:text-red-400" title={t.error}>
                      err
                    </span>
                  ) : (
                    <span className="rounded bg-[hsl(var(--color-muted))] px-1.5 py-0.5 text-[9px] tabular-nums text-[hsl(var(--color-muted-foreground))]">
                      {t.count.toLocaleString()}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* 右:行数据 */}
        <main className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]">
          {!selectedTable && (
            <div className="flex h-64 items-center justify-center text-sm text-[hsl(var(--color-muted-foreground))]">
              选一个表查看数据
            </div>
          )}
          {selectedTable && rowsLoading && (
            <div className="flex h-64 items-center justify-center text-sm text-[hsl(var(--color-muted-foreground))]">
              加载 {selectedTable} 中...
            </div>
          )}
          {selectedTable && rowsError && (
            <div className="m-3 rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
              <div className="font-semibold">查询失败</div>
              <div className="mt-1 opacity-80">{rowsErr?.message}</div>
            </div>
          )}
          {rowData && (
            <>
              <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-3 py-2 text-xs">
                <div>
                  <span className="font-mono font-medium">{rowData.table}</span>
                  <span className="ml-2 text-[hsl(var(--color-muted-foreground))]">
                    共 {rowData.total.toLocaleString()} 行 · 第 {page} / {Math.ceil(rowData.total / pageSize) || 1} 页
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    className="rounded border border-[hsl(var(--color-border))] px-2 py-0.5 hover:bg-[hsl(var(--color-muted))] disabled:opacity-30"
                  >
                    上一页
                  </button>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={!rowData.hasMore}
                    className="rounded border border-[hsl(var(--color-border))] px-2 py-0.5 hover:bg-[hsl(var(--color-muted))] disabled:opacity-30"
                  >
                    下一页
                  </button>
                </div>
              </div>
              <div className="max-h-[calc(100vh-260px)] overflow-y-auto p-2">
                {rowData.rows.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[hsl(var(--color-muted-foreground))]">
                    表为空
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(rowData.rows as unknown[]).map((row: unknown, idx: number) => (
                      <div
                        key={
                          (row as Record<string, unknown>).id?.toString() ??
                          `${page}-${idx}`
                        }
                        className="group rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))]"
                      >
                        <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-2 py-1">
                          <span className="font-mono text-[10px] text-[hsl(var(--color-muted-foreground))]">
                            #{(page - 1) * pageSize + idx + 1}{' '}
                            {(row as Record<string, unknown>).id
                              ? `· ${String((row as Record<string, unknown>).id).slice(0, 10)}...`
                              : ''}
                          </span>
                          <button
                            onClick={() => copyJson(row)}
                            className="rounded p-1 text-[hsl(var(--color-muted-foreground))] opacity-0 transition-opacity hover:bg-[hsl(var(--color-muted))] group-hover:opacity-100"
                            title="复制 JSON"
                          >
                            <Copy className="size-2.5" />
                          </button>
                        </div>
                        <pre className="overflow-x-auto p-2 font-mono text-[10px] leading-relaxed">
                          {JSON.stringify(row, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
