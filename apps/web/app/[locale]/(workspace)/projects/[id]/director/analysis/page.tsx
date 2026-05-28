import { BackButton } from '@/components/ui/back-button';

import { StoryCompass } from './story-compass';

export default async function AnalysisPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ script?: string }>;
}): Promise<React.ReactElement> {
  const { id, locale } = await params;
  const { script } = await searchParams;
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6">
      <div className="mb-4">
        <BackButton
          href={`/${locale}/projects/${id}/director/storyboard?tab=script`}
          label="返回剧本管理"
        />
      </div>
      <StoryCompass projectId={id} initialScriptId={script} />
    </div>
  );
}
