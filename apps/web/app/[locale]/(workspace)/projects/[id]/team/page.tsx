import { TeamManager } from './team-manager';

export default async function TeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-8">
      <TeamManager projectId={id} />
    </div>
  );
}
