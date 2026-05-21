import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from '@/lib/auth/session';

export async function POST(): Promise<NextResponse> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return NextResponse.json({ success: true });
}
