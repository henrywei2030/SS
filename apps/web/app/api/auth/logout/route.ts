import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from '@/lib/auth/session';
import { isOriginAllowed } from '@/lib/auth/route-guard';

export async function POST(): Promise<NextResponse> {
  // CSRF Origin 校验(对齐 login/trpc;否则跨站页面可 POST 强制登出用户)
  const hdrs = await headers();
  if (!isOriginAllowed(hdrs.get('origin'), hdrs.get('host'))) {
    return NextResponse.json(
      { error: 'csrf', message: 'Origin not allowed' },
      { status: 403 },
    );
  }
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return NextResponse.json({ success: true });
}
