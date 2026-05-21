import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/session';

export default async function LocaleRoot({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<never> {
  const { locale } = await params;
  const session = await getSession();
  redirect(session ? `/${locale}/projects` : `/${locale}/login`);
}
