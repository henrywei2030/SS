'use client';

import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
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
            staleTime: 30 * 1000,
            refetchOnWindowFocus: false,
          },
        },
        // 第 20 轮 audit P1:全局 fallback toast(若 component 内 mutation 没自己 onError,这里兜底显示 requestId)
        // 不影响 component 内已有 onError handler — 它们仍正常运行,只是不会被覆盖
        // 注:仅对 mutation 兜底;query 错误通常在 component 内 isError 分支处理,不全局 toast 防刷屏
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            // 若 mutation 配置了自己的 onError,框架会同时调用两边 — 全局这里仍打 toast 是 OK 的兜底
            // 若想 mutation 完全静默(如已用自定义 dialog 处理),可在 mutation options 设 meta:{ silent:true }
            const silent = (mutation.options.meta as { silent?: boolean } | undefined)?.silent;
            if (silent) return;
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
