/**
 * 桌面激活 Route Handler —— 校验共享密钥,通过则记录本机已激活。
 *
 * 仅桌面态(SS_DESKTOP=1)有意义;web/云端 isDesktopActivationRequired()=false → 409。
 * CSRF:复用 isOriginAllowed(同 login route)。本地单机、密钥空间大,不另加限流。
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isOriginAllowed } from '@/lib/auth/route-guard';
import {
  isActivated,
  isDesktopActivationRequired,
  markActivated,
  verifyActivationKey,
} from '@/lib/auth/activation';

const inputSchema = z.object({ key: z.string().min(1).max(200) });

export async function POST(req: Request): Promise<NextResponse> {
  const hdrs = await headers();
  if (!isOriginAllowed(hdrs.get('origin'), hdrs.get('host'))) {
    return NextResponse.json({ error: 'csrf', message: 'Origin not allowed' }, { status: 403 });
  }
  if (!isDesktopActivationRequired()) {
    return NextResponse.json(
      { error: 'not_desktop', message: '当前环境无需激活' },
      { status: 409 },
    );
  }
  // 已激活直接放行(幂等)
  if (await isActivated()) {
    return NextResponse.json({ ok: true, already: true });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', message: '请输入密钥' }, { status: 400 });
  }
  if (!verifyActivationKey(parsed.data.key)) {
    return NextResponse.json(
      { error: 'invalid_key', message: '激活密钥不正确' },
      { status: 401 },
    );
  }
  await markActivated();
  return NextResponse.json({ ok: true });
}
