'use client';
import * as React from 'react';
import { Sparkles, Trash2, X, Image as ImageIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import { KV } from './asset-edit-shared';

// ---------------------------------------------------------------------------
// 候选图 metadata 弹窗
// ---------------------------------------------------------------------------

export function CandidateInfoDialog({
  attempt,
  media,
  onClose,
  onSameStyle,
  onReject,
}: {
  attempt: {
    id: string;
    providerId: string;
    modelId: string;
    inputJson: unknown;
    costCny: { toString: () => string } | string | number;
    durationMs: number | null;
    createdAt: Date;
    candidateForSlot: string | null;
  };
  media: { id: string; storageKey: string; cdnUrl: string | null; aspectRatio: string | null };
  onClose: () => void;
  onSameStyle: () => void;
  onReject: () => void;
}): React.ReactElement {
  const input = (attempt.inputJson ?? {}) as {
    prompt?: string;
    negative?: string;
    aspectRatio?: string;
    sizePx?: string;
    count?: number;
    parts?: {
      stylePart?: string;
      descriptionPart?: string;
      promptPart?: string;
      slotPart?: string;
      extraPart?: string;
    };
  };
  const url = media.cdnUrl ?? media.storageKey;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="grid max-h-[90vh] w-full max-w-3xl grid-cols-[1fr_320px] overflow-hidden rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 大图预览 */}
        <div className="flex items-center justify-center bg-black/40 p-3">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="max-h-[85vh] max-w-full object-contain" />
          ) : (
            <ImageIcon className="size-12 opacity-40" />
          )}
        </div>

        {/* 信息区 */}
        <div className="flex flex-col overflow-y-auto border-l border-[hsl(var(--color-border))]">
          <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-4 py-3">
            <h3 className="text-sm font-semibold">生成详情</h3>
            <button
              onClick={onClose}
              className="rounded p-1 text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 p-4 text-xs">
            <KV label="模型" value={attempt.modelId} mono />
            <KV label="Provider" value={attempt.providerId} mono />
            <KV label="比例" value={input.aspectRatio ?? media.aspectRatio ?? '—'} mono />
            <KV label="尺寸" value={input.sizePx ?? '—'} mono />
            <KV label="槽位" value={attempt.candidateForSlot ?? '—'} mono />
            <KV
              label="生成时间"
              value={new Date(attempt.createdAt).toLocaleString()}
            />
            <KV
              label="耗时"
              value={attempt.durationMs ? `${attempt.durationMs} ms` : '—'}
            />
            <KV label="成本" value={`¥${String(attempt.costCny)}`} />

            <div className="grid gap-1 border-t border-[hsl(var(--color-border)/0.5)] pt-2">
              <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                完整提示词
              </Label>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-[hsl(var(--color-secondary)/0.4)] p-2 font-mono text-[10px] leading-relaxed">
                {input.prompt ?? '—'}
              </pre>
            </div>

            {input.negative && (
              <div className="grid gap-1">
                <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                  负面提示词
                </Label>
                <pre className="rounded bg-[hsl(var(--color-secondary)/0.4)] p-2 font-mono text-[10px] leading-relaxed">
                  {input.negative}
                </pre>
              </div>
            )}

            {input.parts && (
              <details className="text-[10px]">
                <summary className="cursor-pointer text-[hsl(var(--color-muted-foreground))]">
                  prompt 拼接组成
                </summary>
                <div className="mt-1 space-y-1 rounded bg-[hsl(var(--color-secondary)/0.3)] p-2">
                  {input.parts.stylePart && (
                    <div>
                      <span className="text-[hsl(var(--color-muted-foreground))]">[风格]</span>{' '}
                      {input.parts.stylePart}
                    </div>
                  )}
                  {input.parts.descriptionPart && (
                    <div>
                      <span className="text-[hsl(var(--color-muted-foreground))]">[描述]</span>{' '}
                      {input.parts.descriptionPart}
                    </div>
                  )}
                  {input.parts.promptPart && (
                    <div>
                      <span className="text-[hsl(var(--color-muted-foreground))]">[资产]</span>{' '}
                      {input.parts.promptPart}
                    </div>
                  )}
                  {input.parts.slotPart && (
                    <div>
                      <span className="text-[hsl(var(--color-muted-foreground))]">[槽位]</span>{' '}
                      {input.parts.slotPart}
                    </div>
                  )}
                  {input.parts.extraPart && (
                    <div>
                      <span className="text-[hsl(var(--color-muted-foreground))]">[额外]</span>{' '}
                      {input.parts.extraPart}
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>

          <div className="flex gap-2 border-t border-[hsl(var(--color-border))] p-3">
            <Button onClick={onSameStyle} size="sm" variant="outline" className="flex-1 gap-1.5">
              <Sparkles className="size-3.5" />
              同款再生成
            </Button>
            <Button onClick={onReject} size="sm" variant="destructive" className="gap-1.5">
              <Trash2 className="size-3.5" />
              删除
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
