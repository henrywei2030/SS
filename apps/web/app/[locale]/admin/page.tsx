'use client';

import { useTranslations } from 'next-intl';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { trpc } from '@/lib/trpc/client';

export default function AdminDashboard(): React.ReactElement {
  const t = useTranslations('modules.admin');
  // 第 23 轮 audit:接通真 data 替换原 ¥0.00 hardcode(admin 首页 KPI)
  const overview = trpc.admin.dashboard.platformOverview.useQuery();

  const fmt = (n: number | undefined): string =>
    n === undefined ? '—' : `¥${n.toFixed(2)}`;

  const cards = [
    { label: '平台总费用', value: fmt(overview.data?.totalCny) },
    { label: '图片费用', value: fmt(overview.data?.imageCny) },
    { label: '视频费用', value: fmt(overview.data?.videoCny) },
    { label: 'Seedance 费用', value: fmt(overview.data?.seedanceCny) },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('dashboard')}</h1>
      <p className="text-sm text-[hsl(var(--color-muted-foreground))]">
        平台总览驾驶舱 · W6 全功能上线
        {overview.data && (
          <span className="ml-3">
            · 项目数 {overview.data.projectCount} · 用户数 {overview.data.userCount}
          </span>
        )}
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-normal text-[hsl(var(--color-muted-foreground))]">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-[hsl(var(--color-primary))]">
                {overview.isLoading ? '—' : card.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      {overview.error && (
        <p className="text-sm text-[hsl(var(--color-destructive))]">
          加载失败:{overview.error.message}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>📌 即将上线</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-[hsl(var(--color-muted-foreground))]">
          <p>· 30 天费用趋势图(W6,已在 /insights)</p>
          <p>· 模型使用分布饼图(W6,已在 /insights)</p>
          <p>· 项目费用 Top5(W6)</p>
          <p>· 抽卡率 Top 10 镜头(W6)</p>
          <p>· What-If 模拟(Phase 2)</p>
        </CardContent>
      </Card>
    </div>
  );
}
