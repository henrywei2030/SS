import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { ProjectOverview } from './project-overview';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const t = await getTranslations('modules.missionControl');
  void t;
  if (!id) notFound();
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-8">
      <ProjectOverview projectId={id} />
    </div>
  );
}
