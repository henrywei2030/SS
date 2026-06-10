import { ArtWorkspace } from './art-workspace';

export default async function ArtPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ type?: string }>;
}): Promise<React.ReactElement> {
  const { id, locale } = await params;
  const sp = await searchParams;
  const validTypes = ['OVERVIEW', 'CHARACTER', 'SCENE', 'PROP', 'STYLE_REFERENCE'] as const;
  const initialType = (validTypes as readonly string[]).includes(sp.type ?? '')
    ? (sp.type as (typeof validTypes)[number])
    : 'CHARACTER';
  return <ArtWorkspace projectId={id} locale={locale} initialType={initialType} />;
}
