/**
 * 登录 Route Handler — 把 JWT 写入 httpOnly cookie
 *
 * 单独走 REST 是为了 cookie 跨域 / SameSite 在 Server Action 里更可控。
 *
 * 四六收工 P1:此 route 直接调 auth.login() 绕过 tRPC 层,故 tRPC 上的
 * `auth.login` 限流对真实登录无效。这里显式补:① CSRF Origin 校验 ② 按 IP
 * 失败限流(防在线密码爆破,含 admin 账号)。
 */
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthAdapter } from '@ss/adapters/auth';

import { SESSION_COOKIE } from '@/lib/auth/session';
import {
  isOriginAllowed,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginRateLimit,
} from '@/lib/auth/route-guard';

const inputSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request): Promise<NextResponse> {
  const hdrs = await headers();

  // 四六收工 P1-a:CSRF Origin 校验(复用 trpc route 同款 isOriginAllowed)
  if (!isOriginAllowed(hdrs.get('origin'), hdrs.get('host'))) {
    return NextResponse.json(
      { error: 'csrf', message: 'Origin not allowed' },
      { status: 403 },
    );
  }

  // 四六收工 P1-b:按 IP 失败限流(防在线密码爆破)
  const ip =
    hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    hdrs.get('x-real-ip') ??
    'unknown';
  const rl = checkLoginRateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'too_many_requests', message: `尝试过于频繁,请 ${rl.retryAfter} 秒后重试` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const auth = getAuthAdapter();
    const { user, token } = await auth.login(parsed.data);
    // 登录成功:清空该 IP 失败计数(正常用户反复登录/调试不受限流影响)
    clearLoginRateLimit(ip);
    const store = await cookies();
    store.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
      secure: process.env.NODE_ENV === 'production',
    });
    return NextResponse.json({ user });
  } catch (e) {
    // 认证失败才计数(到上限触发限流)
    recordLoginFailure(ip);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'invalid_credentials', message: msg }, { status: 401 });
  }
}
