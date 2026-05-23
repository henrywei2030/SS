import { AigcWorkspace } from './aigc-workspace';

export default async function AigcEpisodePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; episodeId: string; locale: string }>;
  searchParams: Promise<{ g?: string }>;
}): Promise<React.ReactElement> {
  const { id, episodeId } = await params;
  const sp = await searchParams;
  return (
    <AigcWorkspace
      projectId={id}
      episodeId={episodeId}
      initialGroupId={sp.g}
    />
  );
}
