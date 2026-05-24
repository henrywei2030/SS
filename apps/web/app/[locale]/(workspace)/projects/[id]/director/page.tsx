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
      {/* W6 反馈 F6:删"剧本管理"卡(跟分镜工坊重复),分镜工坊内已含剧本上传+版本管理 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="card-hover">
          <CardHeader>
            <CardTitle>分镜工坊</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-[hsl(var(--color-muted-foreground))]">
              剧本上传(docx/md/txt/rtf/html)+ 版本管理 + 分镜生成 + 合并拆分
            </p>
            <Button asChild>
              <Link href={`/${locale}/projects/${id}/director/storyboard`}>
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
            <p className="mb-3 text-xs text-[hsl(var(--color-muted-foreground))]">
              Story Compass 8 维评分 + 情绪曲线 + 整集诊断
            </p>
            <Button asChild>
              <Link href={`/${locale}/projects/${id}/director/analysis`}>
                进入 →
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
