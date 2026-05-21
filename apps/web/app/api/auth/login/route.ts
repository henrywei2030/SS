/**
 * 登录 Route Handler — 把 JWT 写入 httpOnly cookie
 *
 * 单独走 REST 是为了 cookie 跨域 / SameSite 在 Server Action 里更可控。
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthAdapter } from '@ss/adapters/auth';

import { SESSION_COOKIE } from '@/lib/auth/session';

const inputSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request): Promise<NextResponse> {
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
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'invalid_credentials', message: msg }, { status: 401 });
  }
}
