/**
 * Workspace layout — 已登录用户的工作台壳子
 */
import { requireSession } from '@/lib/auth/session';
import { TopNav } from '@/components/top-nav';
import { MobileNav } from '@/components/mobile-nav';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const session = await requireSession(locale);

  return (
    <div className="min-h-screen">
      <TopNav user={session} />
      <MobileNav user={session} />
      <main className="pb-tabbar">{children}</main>
    </div>
  );
}
