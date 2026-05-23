import { AigcDashboard } from './aigc-dashboard';

export default async function AigcDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ status?: string }>;
}): Promise<React.ReactElement> {
  const { id, locale } = await params;
  const sp = await searchParams;
  return <AigcDashboard projectId={id} locale={locale} initialStatus={sp.status} />;
}
