'use client';

import {
  QueryClient,
  QueryClientProvider,
  MutationCache,
  keepPreviousData,
} from '@tanstack/react-query';
import { httpBatchLink, loggerLink } from '@trpc/client';
import * as React from 'react';
import superjson from 'superjson';

import { trpc } from './client';
import { showTrpcError } from './error-toast';

function getBaseUrl(): string {
  if (typeof window !== 'undefined') return '';
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

export function TrpcProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // #3 perf(2026-06-14):桌面单机数据变更少 → staleTime 提到 60s 减少重取冷查
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
            // #3 perf:query key 变化(搜索/筛选/切 tab)时保留旧数据不闪空,过渡更顺滑
            placeholderData: keepPreviousData,
          },
        },
        // 第 20 轮 audit P1:全局 fallback toast(若 component 内 mutation 没自己 onError,这里兜底显示 requestId)
        // 不影响 component 内已有 onError handler — 它们仍正常运行,只是不会被覆盖
        // 注:仅对 mutation 兜底;query 错误通常在 component 内 isError 分支处理,不全局 toast 防刷屏
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            // 第 20 轮 audit + 第 23 轮加固:全局兜底 toast policy
            // - `meta: { silent: true }`     → 完全跳过(component 自己 dialog 处理)
            // - `meta: { customError: true }` → component 自己 onError 显式 toast,cache 跳过(防双 toast)
            // - 默认(无 meta):cache 兜底显示(避免 mutation 漏 onError 时静默失败)
            const meta = mutation.options.meta as
              | { silent?: boolean; customError?: boolean }
              | undefined;
            if (meta?.silent || meta?.customError) return;
            showTrpcError(error);
          },
        }),
      }),
  );
  const [trpcClient] = React.useState(() =>
    trpc.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === 'development' ||
            (op.direction === 'down' && op.result instanceof Error),
        }),
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
          fetch(url, options) {
            return fetch(url, { ...options, credentials: 'include' });
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
