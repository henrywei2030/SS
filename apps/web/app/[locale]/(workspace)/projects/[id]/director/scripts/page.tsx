import { ScriptList } from './script-list';

export default async function ScriptsPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}): Promise<React.ReactElement> {
  const { id, locale } = await params;
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6 space-y-6">
      <h1 className="text-2xl font-semibold">剧本管理</h1>
      <ScriptList projectId={id} locale={locale} />
    </div>
  );
}
