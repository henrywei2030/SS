'use client';
import * as React from 'react';

import type { AigcProgressState } from '@/lib/hooks/use-aigc-progress';

// 二十九收工 S1:Inflight 进度面板 — timer 隔离子组件
//
// 原本父组件 AigcWorkspace(1900+ 行)直接持 nowTick state,
// 每秒 setInterval → 整个组件 re-render → 拖慢 video preview / 子组件 memoization
//
// 抽到这里后,timer 在子组件内独立跑,父组件不动。
// startedAt=null 时(SSE 已 connecting 但 attempt 还没出现)不跑 timer,只显文字

export interface InflightProgressPanelProps {
  startedAt: Date | null;
  expectedMs: number;
  providerDisplayName: string;
  progress: AigcProgressState;
}

export function InflightProgressPanel({
  startedAt,
  expectedMs,
  providerDisplayName,
  progress,
}: InflightProgressPanelProps): React.ReactElement {
  const [nowTick, setNowTick] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const elapsedMs = startedAt ? nowTick - startedAt.getTime() : 0;
  const estimatedPercent = startedAt
    ? Math.min(95, Math.round((elapsedMs / expectedMs) * 100))
    : 0;
  const displayPercent =
    progress.kind === 'progress' && progress.percent ? progress.percent : estimatedPercent;
  const progressMessage =
    progress.kind === 'progress' && progress.message ? progress.message : null;

  return (
    <div className="mb-3 rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-blue-700 dark:text-blue-300">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="inline-block size-2 animate-pulse rounded-full bg-blue-500" />
          <span className="font-medium">
            {progress.kind === 'connecting' ? '建立连接中...' : '视频生成中'}
          </span>
        </span>
        {startedAt && (
          <span className="font-mono tabular-nums opacity-80">
            {Math.round(elapsedMs / 1000)} s · {displayPercent}%
          </span>
        )}
      </div>
      {startedAt && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-500/15">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-1000 ease-linear"
            style={{ width: `${displayPercent}%` }}
          />
        </div>
      )}
      <div className="mt-1.5 text-[10px] opacity-70">
        {providerDisplayName} · 预计 {Math.round(expectedMs / 60_000)} 分钟 · 系统每 5 秒自动刷新状态
        {progressMessage && ` · ${progressMessage}`}
      </div>
    </div>
  );
}
