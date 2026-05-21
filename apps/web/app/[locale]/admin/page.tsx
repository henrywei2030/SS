import { getTranslations } from 'next-intl/server';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default async function AdminDashboard(): Promise<React.ReactElement> {
  const t = await getTranslations('modules.admin');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('dashboard')}</h1>
      <p className="text-sm text-[hsl(var(--color-muted-foreground))]">
        平台总览驾驶舱 · W6 全功能上线
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {['平台总费用', '图片费用', '视频费用', 'Seedance 费用'].map((label) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-normal text-[hsl(var(--color-muted-foreground))]">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-[hsl(var(--color-primary))]">¥0.00</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>📌 即将上线</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-[hsl(var(--color-muted-foreground))]">
          <p>· 30 天费用趋势图（W6）</p>
          <p>· 模型使用分布饼图（W6）</p>
          <p>· 项目费用 Top5（W6）</p>
          <p>· 抽卡率 Top 10 镜头（W6）</p>
          <p>· What-If 模拟（Phase 2）</p>
        </CardContent>
      </Card>
    </div>
  );
}
