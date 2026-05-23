/**
 * tRPC Route Handler — 所有 tRPC 请求统一入口
 *
 * W7 audit R8 P0:CSRF 防御 — 对 mutation(POST)校验 Origin / Sec-Fetch-Site,
 * 拒非同源 / 跨站请求。GET(query)不需要(cookie 走 sameSite=lax 足够)。
 */
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { cookies, headers } from 'next/headers';

import { appRouter, createContext } from '@ss/api';

import { SESSION_COOKIE } from '@/lib/auth/session';

/** 白名单 origin:本机 dev + 用户配置的 NEXT_PUBLIC_APP_URL(prod 部署域名) */
function isOriginAllowed(origin: string | null, host: string | null): boolean {
  if (!origin) {
    // 无 Origin = 同站非跨域(浏览器 SSR / curl)— 放行,因为没 CSRF 风险
    return true;
  }
  try {
    const originHost = new URL(origin).host;
    // 同源(host 跟 request Host 一致)→ 放行
    if (host && originHost === host) return true;
    // 显式白名单(prod)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl && originHost === new URL(appUrl).host) return true;
    // dev fallback:localhost / 127.0.0.1 任意端口
    if (process.env.NODE_ENV === 'development') {
      return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(originHost);
    }
    return false;
  } catch {
    return false;
  }
}

const handler = async (req: Request): Promise<Response> => {
  const cookieStore = await cookies();
  const hdrs = await headers();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? null;

  // W7 audit R8 P0:CSRF Origin 校验(仅对写方法)
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    const origin = hdrs.get('origin');
    const host = hdrs.get('host');
    if (!isOriginAllowed(origin, host)) {
      return new Response(
        JSON.stringify({
          error: { message: 'CSRF: Origin not allowed', code: 'FORBIDDEN' },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

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
