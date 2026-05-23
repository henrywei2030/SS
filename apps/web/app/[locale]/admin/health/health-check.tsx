'use client';
import * as React from 'react';
import { Database, Server, Cloud, RefreshCw } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';

interface ServiceHealth {
  ok: boolean;
  latencyMs: number;
  error: string | null;
}

function ServiceCard({
  name,
  description,
  icon: Icon,
  health,
}: {
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  health?: ServiceHealth;
}): React.ReactElement {
  const loading = !health;
  const ok = health?.ok ?? false;
  return (
    <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-[hsl(var(--color-muted-foreground))]" />
          <span className="font-medium">{name}</span>
        </div>
        {loading ? (
          <span className="rounded-full bg-[hsl(var(--color-muted))] px-2 py-0.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">
            检测中
          </span>
        ) : ok ? (
          <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
            ● OK
          </span>
        ) : (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">
            ● DOWN
          </span>
        )}
      </div>
      <div className="mt-2 text-[11px] text-[hsl(var(--color-muted-foreground))]">
        {description}
      </div>
      <div className="mt-3 text-xs">
        {health ? (
          <>
            <div className="text-[hsl(var(--color-muted-foreground))]">
              latency:{' '}
              <span className="font-mono font-medium">{health.latencyMs}ms</span>
            </div>
            {health.error && (
              <div className="mt-1 break-all rounded bg-red-500/5 p-1.5 font-mono text-[10px] text-red-600 dark:text-red-400">
                {health.error}
              </div>
            )}
          </>
        ) : (
          <span className="text-[hsl(var(--color-muted-foreground))]">检查中...</span>
        )}
      </div>
    </div>
  );
}

export function HealthCheck(): React.ReactElement {
  const { data, isFetching, refetch, dataUpdatedAt } = trpc.admin.health.check.useQuery(
    undefined,
    {
      refetchInterval: 10_000, // 每 10s 自动 ping
    },
  );

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">健康检查</h1>
          <p className="mt-1 text-sm text-[hsl(var(--color-muted-foreground))]">
            基础设施服务连通性 + 延迟 — 每 10 秒自动检测
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
        >
          <RefreshCw className={`size-3 ${isFetching ? 'animate-spin' : ''}`} />
          手动刷新
        </button>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <ServiceCard
          name="PostgreSQL"
          description="主数据库(项目 / 资产 / attempt / ledger 等业务表)"
          icon={Database}
          health={data?.db}
        />
        <ServiceCard
          name="Redis"
          description="BullMQ 队列 + SSE pub/sub(W5.5 异步视频生成)"
          icon={Server}
          health={data?.redis}
        />
        <ServiceCard
          name="MinIO / S3"
          description="对象存储(MediaItem / 视频文件 / 资产图)"
          icon={Cloud}
          health={data?.minio}
        />
      </div>

      {dataUpdatedAt > 0 && (
        <div className="mt-3 text-right text-[10px] text-[hsl(var(--color-muted-foreground))]">
          上次检查:{new Date(dataUpdatedAt).toLocaleString('zh-CN')}
        </div>
      )}
    </div>
  );
}
