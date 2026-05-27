import { StoryCompass } from './story-compass';

export default async function AnalysisPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ script?: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const { script } = await searchParams;
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6">
      <StoryCompass projectId={id} initialScriptId={script} />
    </div>
  );
}
