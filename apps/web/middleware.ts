/**
 * Next.js Middleware — 处理 /[locale] 路由与登录拦截
 */
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from '@ss/i18n';

const intlMiddleware = createMiddleware({
  locales: [...SUPPORTED_LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
});

const SESSION_COOKIE = 'ss_session'; // 与 lib/auth/session.ts 保持一致

// 不需要登录的路径（已去掉 locale 前缀后比较）
// /activate:桌面首次激活页(未登录可达;实际"是否需激活"由 server 守卫 requireActivation 判定）
const PUBLIC_PATHS = ['/login', '/signup', '/activate'];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // 1. /api/* 不走 i18n，cookie 由 Route Handler 自行处理
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // 2. 让 next-intl 处理 locale 重定向
  const intlResponse = intlMiddleware(request);

  // 3. 登录拦截（dev 阶段简化：仅检查 cookie 存在；正式校验在 server component / tRPC ctx）
  const stripped = pathname.replace(/^\/(zh-CN|en)/, '') || '/';
  const isPublic = PUBLIC_PATHS.some((p) => stripped === p || stripped.startsWith(p + '/'));
  const hasToken = request.cookies.has(SESSION_COOKIE);

  if (!isPublic && !hasToken) {
    const url = request.nextUrl.clone();
    const locale = pathname.split('/')[1] || DEFAULT_LOCALE;
    url.pathname = `/${locale}/login`;
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  return intlResponse;
}

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)'],
};
