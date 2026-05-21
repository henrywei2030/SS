import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';

import { ProvidersTable } from './providers-table';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('modules.admin');
  return { title: t('providerConfig') };
}

export default async function ProvidersPage(): Promise<React.ReactElement> {
  const t = await getTranslations('modules.admin');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('providerConfig')}</h1>
        <p className="text-sm text-[hsl(var(--color-muted-foreground))]">
          {t('providerKey.subtitle')}
        </p>
      </div>
      <ProvidersTable />
    </div>
  );
}
