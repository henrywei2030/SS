import { BackButton } from '@/components/ui/back-button';

import { AuditView } from './audit-view';

export default async function ArtAuditPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}): Promise<React.ReactElement> {
  const { id, locale } = await params;
  return (
    <div>
      {/* 三十六收工 UX 改造:全局返回按钮 — 资产审核返回美术工坊 */}
      <div className="border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-6 py-2">
        <BackButton
          href={`/${locale}/projects/${id}/art`}
          label="返回美术工坊"
        />
      </div>
      <AuditView projectId={id} locale={locale} />
    </div>
  );
}
