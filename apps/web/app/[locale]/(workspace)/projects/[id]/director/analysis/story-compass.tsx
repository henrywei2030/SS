'use client';
import { useTranslations } from 'next-intl';
import { Loader2, Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import * as React from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
} from 'recharts';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const DIMENSIONS = [
  { key: 'hookScore', label: '钩子力度' },
  { key: 'suspenseScore', label: '悬念保持' },
  { key: 'twistScore', label: '反转力度' },
  { key: 'climaxScore', label: '爆点密度' },
  { key: 'conflictScore', label: '冲突集中' },
  { key: 'dialogueScore', label: '台词锐度' },
  { key: 'paceScore', label: '节奏紧凑' },
  { key: 'urgencyScore', label: '急停保持' },
] as const;

export function StoryCompass({
  projectId,
  locale,
  initialScriptId,
}: {
  projectId: string;
  locale: string;
  initialScriptId?: string;
}): React.ReactElement {
  const t = useTranslations('modules.storyCompass');
  void locale;
  const { data: scripts } = trpc.script.list.useQuery({ projectId });
  const [scriptId, setScriptId] = React.useState<string | undefined>(initialScriptId);

  React.useEffect(() => {
    if (!scriptId && scripts && scripts[0]) {
      setScriptId(scripts[0].id);
    }
  }, [scripts, scriptId]);

  const { data: analysis, refetch } = trpc.script.latestAnalysis.useQuery(
    { scriptId: scriptId ?? '' },
    { enabled: !!scriptId },
  );

  const analyze = trpc.script.analyze.useMutation({
    onSuccess: () => refetch(),
  });

  const radarData = analysis
    ? DIMENSIONS.map((d) => ({
        dimension: d.label,
        value: Number(analysis[d.key] ?? 0),
      }))
    : DIMENSIONS.map((d) => ({ dimension: d.label, value: 0 }));

  const curveData = ((analysis?.curveJson as Array<{ time: string; emotion: number; scene?: string }> | undefined) ?? []).map(
    (p, i) => ({ idx: i, time: p.time, emotion: p.emotion, scene: p.scene }),
  );

  const overallScore = Number(analysis?.overallScore ?? 0);

  return (
    <div className="space-y-6">
      {/* 头部 + 集选择器 */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('scriptAnalysis')}</h1>
          <p className="text-sm text-[hsl(var(--color-muted-foreground))]">
            8 维评分 · 整集诊断 · 剧情曲线
          </p>
        </div>
        <div className="flex-1" />
        <select
          value={scriptId ?? ''}
          onChange={(e) => setScriptId(e.target.value)}
          className="h-9 rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-input))] px-3 text-sm"
        >
          {scripts?.map((s) => (
            <option key={s.id} value={s.id}>
              第 {s.episode?.number} 集 {s.title ?? ''}
            </option>
          ))}
        </select>
        <Button
          onClick={() =>
            scriptId && analyze.mutate({ scriptId, modelId: 'claude-sonnet-4-5' })
          }
          disabled={!scriptId || analyze.isPending}
          className="gap-1.5"
        >
          {analyze.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {analysis ? '重新分析' : '开始分析'}
        </Button>
      </div>

      {analyze.error && (
        <Card className="border-[hsl(var(--color-destructive)/0.3)] bg-[hsl(var(--color-destructive)/0.05)]">
          <CardContent className="py-3 text-sm text-[hsl(var(--color-destructive))]">
            {analyze.error.message}
            <p className="mt-1 text-xs text-[hsl(var(--color-muted-foreground))]">
              提示：请先到 /admin/providers 配置 Claude API Key
            </p>
          </CardContent>
        </Card>
      )}

      {!analysis ? (
        <Card className="py-24 text-center">
          <Sparkles className="mx-auto size-12 text-[hsl(var(--color-muted-foreground))]" />
          <p className="mt-4 text-sm text-[hsl(var(--color-muted-foreground))]">
            还没有分析结果，点上方"开始分析"
          </p>
        </Card>
      ) : (
        <>
          {/* 8 维雷达 + 整集诊断 */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-sm font-normal text-[hsl(var(--color-muted-foreground))]">
                  8 维度评分 · 反向
                </CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="hsl(var(--color-border))" />
                    <PolarAngleAxis
                      dataKey="dimension"
                      tick={{ fill: 'hsl(var(--color-muted-foreground))', fontSize: 11 }}
                    />
                    <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
                    <Radar
                      dataKey="value"
                      stroke="hsl(var(--color-primary))"
                      fill="hsl(var(--color-primary))"
                      fillOpacity={0.3}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <CardTitle>整集诊断</CardTitle>
                  <Badge variant={overallScore >= 7 ? 'success' : overallScore >= 5 ? 'warning' : 'destructive'}>
                    {overallScore.toFixed(1)} / 10
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {analysis.summary && (
                  <p className="text-sm leading-relaxed">{analysis.summary}</p>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--color-success))]">
                      <CheckCircle2 className="size-3.5" /> 亮点
                    </p>
                    <ul className="space-y-1 text-xs">
                      {((analysis.highlights as unknown[]) ?? []).slice(0, 5).map((h, i) => {
                        const hi = h as { text: string };
                        return <li key={i}>· {hi.text}</li>;
                      })}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--color-destructive))]">
                      <AlertTriangle className="size-3.5" /> 需优先修复
                    </p>
                    <ul className="space-y-1 text-xs">
                      {((analysis.issues as unknown[]) ?? []).slice(0, 5).map((it, i) => {
                        const ii = it as { description: string; severity: string };
                        return (
                          <li key={i} className="flex items-start gap-1.5">
                            <Badge
                              variant={
                                ii.severity === 'high'
                                  ? 'destructive'
                                  : ii.severity === 'medium'
                                    ? 'warning'
                                    : 'secondary'
                              }
                              className="mt-0.5 shrink-0 text-[10px]"
                            >
                              {ii.severity === 'high' ? '严重' : ii.severity === 'medium' ? '中度' : '轻度'}
                            </Badge>
                            <span>{ii.description}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 剧情发展曲线 */}
          {curveData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>剧情发展曲线</CardTitle>
              </CardHeader>
              <CardContent className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={curveData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="emotionGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--color-primary))" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="hsl(var(--color-primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="time"
                      tick={{ fill: 'hsl(var(--color-muted-foreground))', fontSize: 10 }}
                    />
                    <YAxis
                      domain={[0, 10]}
                      tick={{ fill: 'hsl(var(--color-muted-foreground))', fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(220 26% 12% / 0.9)',
                        border: '1px solid hsl(var(--color-border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="emotion"
                      stroke="hsl(var(--color-primary))"
                      strokeWidth={2}
                      fill="url(#emotionGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
