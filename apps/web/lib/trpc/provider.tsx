'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink, loggerLink } from '@trpc/client';
import * as React from 'react';
import superjson from 'superjson';

import { trpc } from './client';

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
