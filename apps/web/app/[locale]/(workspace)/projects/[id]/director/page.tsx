import { getTranslations } from 'next-intl/server';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default async function DirectorHome({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}): Promise<React.ReactElement> {
  const { id, locale } = await params;
  const t = await getTranslations('modules.storyCompass');

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6 space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="card-hover">
          <CardHeader>
            <CardTitle>剧本管理</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/${locale}/projects/${id}/director/scripts`}>
                进入 →
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="card-hover">
          <CardHeader>
            <CardTitle>{t('scriptAnalysis')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/${locale}/projects/${id}/director/analysis`}>
                进入 →
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="opacity-70">
          <CardHeader>
            <CardTitle>分镜管理（W3）</CardTitle>
          </CardHeader>
          <CardContent>
            <Button disabled>即将上线</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
