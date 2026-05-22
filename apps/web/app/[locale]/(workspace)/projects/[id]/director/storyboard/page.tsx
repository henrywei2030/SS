import { StoryboardWorkspace } from './storyboard-workspace';

export default async function StoryboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ ep?: string; tab?: string }>;
}): Promise<React.ReactElement> {
  const { id, locale } = await params;
  const sp = await searchParams;
  return (
    <StoryboardWorkspace
      projectId={id}
      locale={locale}
      initialEpisodeId={sp.ep}
      initialTab={sp.tab === 'script' ? 'script' : 'shots'}
    />
  );
}
