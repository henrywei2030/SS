import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';

import { ProjectsList } from './projects-list';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('modules.missionControl');
  return { title: t('title') };
}

export default function ProjectsPage(): React.ReactElement {
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-8">
      <ProjectsList />
    </div>
  );
}
