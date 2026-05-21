/**
 * Server-side session helper — 仅 Server Components / Route Handlers 使用
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAuthAdapter, type SessionUser } from '@ss/adapters/auth';
import { DEFAULT_LOCALE } from '@ss/i18n';

export const SESSION_COOKIE = 'ss_session';

/** 读取当前 session（不强制登录） */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const auth = getAuthAdapter();
    return await auth.verifyToken(token);
  } catch {
    return null;
  }
}

/** 必须登录否则跳到登录页 */
export async function requireSession(locale: string = DEFAULT_LOCALE): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  return session;
}

/** 必须 isAdmin 否则 403 */
export async function requireAdminSession(locale: string = DEFAULT_LOCALE): Promise<SessionUser> {
  const session = await requireSession(locale);
  if (!session.isAdmin) redirect(`/${locale}/projects?error=forbidden`);
  return session;
}
