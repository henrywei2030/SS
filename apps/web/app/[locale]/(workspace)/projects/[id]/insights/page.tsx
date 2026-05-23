import { InsightsView } from './insights-view';

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ days?: string }>;
}): Promise<React.ReactElement> {
  const { id, locale } = await params;
  const sp = await searchParams;
  const days = Number(sp.days);
  const initialDays = days === 7 || days === 30 || days === 90 ? days : 30;
  return <InsightsView projectId={id} locale={locale} initialDays={initialDays} />;
}
