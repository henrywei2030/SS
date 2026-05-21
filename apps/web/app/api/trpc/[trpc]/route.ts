/**
 * tRPC Route Handler — 所有 tRPC 请求统一入口
 */
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { cookies } from 'next/headers';

import { appRouter, createContext } from '@ss/api';

import { SESSION_COOKIE } from '@/lib/auth/session';

const handler = async (req: Request): Promise<Response> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? null;

  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () =>
      createContext({
        authToken: token,
        locale: req.headers.get('accept-language'),
        ip:
          req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
          req.headers.get('x-real-ip') ??
          null,
        userAgent: req.headers.get('user-agent'),
      }),
    onError({ error, path }) {
      if (process.env.NODE_ENV === 'development') {
        console.error(`[trpc] ${path}: ${error.message}`);
      }
    },
  });
};

export { handler as GET, handler as POST };
