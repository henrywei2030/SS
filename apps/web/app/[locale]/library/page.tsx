import { requireSession } from '@/lib/auth/session';
import { TopNav } from '@/components/top-nav';
import { LibraryView } from './library-view';

export default async function LibraryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const session = await requireSession(locale);
  return (
    <div className="min-h-screen">
      <TopNav user={session} />
      <main className="mx-auto max-w-[1600px] px-6 py-6">
        <LibraryView />
      </main>
    </div>
  );
}
