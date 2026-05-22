'use client';
import * as React from 'react';
import { Loader2, CircleSlash, CircleCheck, Sparkles, X } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface Props {
  projectId: string;
  onClose: () => void;
  /** 用户点"打开拆解"时的回调,带上选中的 episodeId */
  onOpenBreakdown: (episodeId: string) => void;
}

export function GapDetectionDialog({ projectId, onClose, onOpenBreakdown }: Props): React.ReactElement {
  const [episodeId, setEpisodeId] = React.useState<string>('');
  const { data: episodes } = trpc.storyboard.listEpisodes.useQuery({ projectId });
  const { data: gaps, isLoading } = trpc.asset.detectGaps.useQuery(
    { episodeId },
    { enabled: !!episodeId },
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">按集补充 · 资产缺口检测</h2>
            <p className="mt-0.5 text-[11px] text-[hsl(var(--color-muted-foreground))]">
              选某集 → 系统对比剧本提到的角色/场景 vs 已建资产 → 列出待补齐项
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <div className="grid gap-1.5">
            <Label htmlFor="ep">选集</Label>
            <select
              id="ep"
              value={episodeId}
              onChange={(e) => setEpisodeId(e.target.value)}
              className="h-9 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-sm"
            >
              <option value="">— 选一集 —</option>
              {episodes?.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  第 {ep.number} 集{ep.title ? ` · ${ep.title}` : ''}
                  {' '}
                  ({ep.sceneCount} 场)
                </option>
              ))}
            </select>
          </div>

          {!episodeId ? (
            <p className="py-6 text-center text-xs text-[hsl(var(--color-muted-foreground))]">
              先选一集
            </p>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : !gaps ? null : (
            <div className="space-y-3 text-xs">
              {/* 概览 */}
              <div className="grid grid-cols-4 gap-2 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-secondary)/0.3)] p-3">
                <Stat label="本集场数" value={gaps.sceneCount} />
                <Stat label="提到角色" value={gaps.mentionedCharactersCount} />
                <Stat label="提到场景" value={gaps.mentionedScenesCount} />
                <Stat label="已绑定" value={gaps.existingBindingCount} />
              </div>

              {/* 缺失角色 */}
              <Section
                icon={
                  gaps.missingCharacters.length === 0 ? (
                    <CircleCheck className="size-4 text-emerald-500" />
                  ) : (
                    <CircleSlash className="size-4 text-rose-500" />
                  )
                }
                title={`缺失人物资产 (${gaps.missingCharacters.length})`}
              >
                {gaps.missingCharacters.length === 0 ? (
                  <p className="text-[11px] text-emerald-500">人物资产齐全 ✓</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {gaps.missingCharacters.map((c) => (
                      <Badge
                        key={c}
                        variant="destructive"
                        className="px-1.5 text-[10px]"
                      >
                        {c}
                      </Badge>
                    ))}
                  </div>
                )}
              </Section>

              {/* 缺失场景 */}
              <Section
                icon={
                  gaps.missingScenes.length === 0 ? (
                    <CircleCheck className="size-4 text-emerald-500" />
                  ) : (
                    <CircleSlash className="size-4 text-rose-500" />
                  )
                }
                title={`缺失场景资产 (${gaps.missingScenes.length})`}
              >
                {gaps.missingScenes.length === 0 ? (
                  <p className="text-[11px] text-emerald-500">场景资产齐全 ✓</p>
                ) : (
                  <ul className="space-y-1">
                    {gaps.missingScenes.map((s) => (
                      <li
                        key={s.name}
                        className="flex items-center justify-between rounded bg-[hsl(var(--color-destructive)/0.08)] px-2 py-1"
                      >
                        <span className="font-medium text-[hsl(var(--color-destructive))]">
                          {s.name}
                        </span>
                        <span className="font-mono text-[10px] text-[hsl(var(--color-muted-foreground))]">
                          {s.sceneNumber}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[hsl(var(--color-border))] p-4">
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          {gaps && (gaps.missingCharacters.length + gaps.missingScenes.length) > 0 && (
            <Button onClick={() => onOpenBreakdown(episodeId)} className="gap-1.5">
              <Sparkles className="size-4" />
              一键拆解补齐
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded border border-[hsl(var(--color-border))] p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="text-center">
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] text-[hsl(var(--color-muted-foreground))]">{label}</div>
    </div>
  );
}
