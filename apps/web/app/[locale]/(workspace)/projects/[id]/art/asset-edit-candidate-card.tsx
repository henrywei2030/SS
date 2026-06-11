'use client';
import * as React from 'react';
import { Image as ImageIcon, CheckCircle2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { ImageLightbox, ImagePreviewButton } from '@/components/ui/image-lightbox';
import { cn } from '@/lib/utils';

export function CandidateCard({
  url,
  isConfirmed,
  aspectRatio,
  onOpenInfo,
  onConfirm,
  onReject,
}: {
  attemptId: string;
  mediaId: string;
  url: string | null;
  isConfirmed: boolean;
  aspectRatio: string;
  onOpenInfo: () => void;
  onConfirm: () => void;
  onReject: () => void;
}): React.ReactElement {
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const aspectClass =
    aspectRatio === '9:16'
      ? 'aspect-[9/16]'
      : aspectRatio === '16:9'
        ? 'aspect-[16/9]'
        : aspectRatio === '2:1'
          ? 'aspect-[2/1]'
          : 'aspect-square';
  return (
    <>
    <div
      className={cn(
        'group relative overflow-hidden rounded border',
        isConfirmed
          ? 'border-[hsl(var(--color-accent))]'
          : 'border-[hsl(var(--color-border))]',
      )}
    >
      <div
        onClick={onOpenInfo}
        className={cn(
          // 五八:限高 + object-contain → 一屏看完整图,不被竖图撑爆
          'relative flex max-h-[52vh] cursor-pointer items-center justify-center bg-[hsl(var(--color-secondary)/0.3)]',
          aspectClass,
        )}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="absolute inset-0 size-full object-contain" />
        ) : (
          <ImageIcon className="size-8 text-[hsl(var(--color-muted-foreground)/0.4)]" />
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-white">
          {aspectRatio}
        </span>
        {/* 七二第九波(用户:全覆盖):候选图右上角预览大图 + 已确认徽章 */}
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
          {url && <ImagePreviewButton onOpen={() => setPreviewOpen(true)} />}
          {isConfirmed && (
            <Badge variant="default" className="gap-1 px-1.5 text-[9px]">
              <CheckCircle2 className="size-2.5" />
              已确认
            </Badge>
          )}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-gradient-to-t from-black/80 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onConfirm}
          disabled={isConfirmed}
          className="flex-1 rounded bg-[hsl(var(--color-accent))] px-2 py-1 text-[10px] text-white disabled:opacity-40"
        >
          设为槽位
        </button>
        <button
          onClick={onReject}
          className="rounded bg-[hsl(var(--color-danger)/0.8)] px-2 py-1 text-[10px] text-white"
        >
          删除
        </button>
      </div>
    </div>
    {previewOpen && url && <ImageLightbox url={url} onClose={() => setPreviewOpen(false)} />}
    </>
  );
}
