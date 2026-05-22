'use client';
import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, AlertTriangle, Unlink2, CircleSlash } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Props {
  projectId: string;
  locale: string;
}

export function AuditView({ projectId, locale }: Props): React.ReactElement {
  const { data, isLoading } = trpc.asset.auditProject.useQuery({ projectId });
  const utils = trpc.useUtils();
  const unbindMut = trpc.asset.unbindUsage.useMutation({
    onSuccess: () => void utils.asset.auditProject.invalidate({ projectId }),
  });
  const deleteMut = trpc.asset.delete.useMutation({
    onSuccess: () => void utils.asset.auditProject.invalidate({ projectId }),
  });

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/${locale}/projects/${projectId}/art`}
            className="flex h-7 items-center gap-1 rounded px-2 text-xs text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]"
          >
            <ArrowLeft className="size-3.5" />
            返回美术工作区
          </Link>
        </div>
        <h1 className="text-xl font-semibold">资产 ↔ 剧集 关联审计</h1>
      </header>

      <p className="text-sm text-[hsl(var(--color-muted-foreground))]">
        三类问题:剧本提到但没建资产 / 资产建了但 0 出场绑定 / 出场绑定指向已删的 shot 或 scene。
      </p>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-[hsl(var(--color-muted-foreground))]" />
        </div>
      ) : !data ? (
        <p>无数据</p>
      ) : (
        <>
          {/* 概览 */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="缺人物资产"
              value={data.summary.missingCharCount}
              tone={data.summary.missingCharCount === 0 ? 'ok' : 'warn'}
            />
            <StatCard
              label="缺场景资产"
              value={data.summary.missingSceneCount}
              tone={data.summary.missingSceneCount === 0 ? 'ok' : 'warn'}
            />
            <StatCard
              label="0 出场绑定资产"
              value={data.summary.unboundCount}
              tone={data.summary.unboundCount === 0 ? 'ok' : 'warn'}
            />
            <StatCard
              label="悬空 binding"
              value={data.summary.danglingCount}
              tone={data.summary.danglingCount === 0 ? 'ok' : 'danger'}
            />
          </div>

          {/* (a) 剧本提到但没建资产 */}
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <CircleSlash className="size-4 text-rose-500" />
              <h2 className="text-sm font-semibold">
                a · 剧本提到但没建资产 ({data.summary.missingCharCount + data.summary.missingSceneCount})
              </h2>
            </div>
            {data.summary.missingCharCount + data.summary.missingSceneCount === 0 ? (
              <p className="text-xs text-emerald-500">全部覆盖 ✓</p>
            ) : (
              <div className="space-y-3 text-xs">
                {data.noAssetForMentioned.characters.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                      角色 ({data.noAssetForMentioned.characters.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {data.noAssetForMentioned.characters.map((c) => (
                        <Badge key={c} variant="destructive" className="px-1.5 text-[10px]">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {data.noAssetForMentioned.scenes.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                      场景 ({data.noAssetForMentioned.scenes.length})
                    </p>
                    <ul className="space-y-1">
                      {data.noAssetForMentioned.scenes.map((s) => (
                        <li
                          key={`${s.episodeNumber}-${s.sceneNumber}-${s.name}`}
                          className="flex items-center justify-between rounded bg-[hsl(var(--color-destructive)/0.08)] px-2.5 py-1.5"
                        >
                          <span className="font-medium text-[hsl(var(--color-destructive))]">{s.name}</span>
                          <span className="font-mono text-[10px] text-[hsl(var(--color-muted-foreground))]">
                            第 {s.episodeNumber} 集 · {s.sceneNumber}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* (b) 资产建了但 0 binding */}
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <Unlink2 className="size-4 text-amber-500" />
              <h2 className="text-sm font-semibold">
                b · 资产已建但 0 出场绑定 ({data.summary.unboundCount})
              </h2>
            </div>
            {data.summary.unboundCount === 0 ? (
              <p className="text-xs text-emerald-500">所有资产都有绑定 ✓</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {data.noBindingAssets.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between rounded border border-[hsl(var(--color-border))] px-2.5 py-2"
                  >
                    <div>
                      <Link
                        href={`/${locale}/projects/${projectId}/art?type=${a.type}`}
                        className="font-medium hover:text-[hsl(var(--color-accent))]"
                      >
                        {a.name}
                      </Link>{' '}
                      <Badge variant="secondary" className="ml-2 px-1.5 text-[9px]">
                        {a.type}
                      </Badge>
                      {a.archetypeKey && (
                        <span className="ml-2 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                          原型:{a.archetypeKey}
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-[10px] text-[hsl(var(--color-destructive))]"
                      onClick={() => {
                        if (confirm(`删除资产 "${a.name}"?`)) deleteMut.mutate({ assetId: a.id });
                      }}
                    >
                      软删
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* (c) 悬空 binding */}
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="size-4 text-rose-500" />
              <h2 className="text-sm font-semibold">
                c · 悬空出场绑定 ({data.summary.danglingCount})
              </h2>
            </div>
            {data.summary.danglingCount === 0 ? (
              <p className="text-xs text-emerald-500">无悬空 binding ✓</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {data.danglingBindings.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between rounded border border-[hsl(var(--color-destructive)/0.5)] bg-[hsl(var(--color-destructive)/0.05)] px-2.5 py-2"
                  >
                    <div>
                      <span className="font-medium">{b.assetName}</span>
                      <span className="ml-2 text-[10px] text-[hsl(var(--color-destructive))]">{b.reason}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-[10px] text-[hsl(var(--color-destructive))]"
                      onClick={() => unbindMut.mutate({ bindingId: b.id })}
                    >
                      清除
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'warn' | 'danger';
}): React.ReactElement {
  const toneClass =
    tone === 'ok'
      ? 'text-emerald-500'
      : tone === 'warn'
        ? 'text-amber-500'
        : 'text-rose-500';
  return (
    <Card className="p-4 text-center">
      <div className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-1 text-[10px] text-[hsl(var(--color-muted-foreground))]">{label}</div>
    </Card>
  );
}
