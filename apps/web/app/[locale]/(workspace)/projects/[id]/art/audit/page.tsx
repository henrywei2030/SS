import { AuditView } from './audit-view';

export default async function ArtAuditPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}): Promise<React.ReactElement> {
  const { id, locale } = await params;
  return <AuditView projectId={id} locale={locale} />;
}
