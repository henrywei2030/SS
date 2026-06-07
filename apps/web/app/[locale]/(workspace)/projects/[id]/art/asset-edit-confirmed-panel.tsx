'use client';
import * as React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import { type AssetDetail, type Slot, SLOT_FIELD } from './asset-edit-shared';

// ---------------------------------------------------------------------------
// 右:已确认槽位
// ---------------------------------------------------------------------------

export function ConfirmedSlotsPanel({
  asset,
  slots,
  onChanged,
}: {
  asset: AssetDetail;
  slots: Array<{ slot: Slot; label: string; aspectClass: string }>;
  onChanged: () => void;
}): React.ReactElement {
  const unconfirmMut = trpc.asset.unconfirmSlot.useMutation({
    onSuccess: () => {
      toast.success('已清除槽位');
      onChanged();
    },
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[hsl(var(--color-border))] px-4 py-3">
        <h3 className="text-sm font-semibold">已确认槽位</h3>
        <p className="mt-0.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">
          下游 AIGC 调用以这里为准
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {slots.map((s) => {
          const fieldName = SLOT_FIELD[s.slot];
          const mediaId = (asset as unknown as Record<string, string | null>)[fieldName];
          return (
            <div key={s.slot}>
              <div className="mb-1 flex items-center justify-between">
                <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                  {s.label}
                </Label>
                {mediaId && (
                  <button
                    onClick={() => unconfirmMut.mutate({ assetId: asset.id, slot: s.slot })}
                    className="text-[9px] text-[hsl(var(--color-destructive))] hover:underline"
                  >
                    清除
                  </button>
                )}
              </div>
              <div
                className={cn(
                  // 五八:限高 + 下面 object-contain → 已确认槽位也一屏看完整
                  'relative flex max-h-[44vh] items-center justify-center overflow-hidden rounded border bg-[hsl(var(--color-secondary)/0.3)]',
                  s.aspectClass,
                  mediaId
                    ? 'border-[hsl(var(--color-accent)/0.5)]'
                    : 'border-dashed border-[hsl(var(--color-border))]',
                )}
              >
                {mediaId ? (
                  (() => {
                    const media = (asset as { mediaMap?: Record<string, { cdnUrl?: string | null; storageKey: string }> })
                      .mediaMap?.[mediaId];
                    const url = media?.cdnUrl ?? media?.storageKey;
                    return url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={s.label} className="absolute inset-0 size-full object-contain" />
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                        <CheckCircle2 className="size-5 text-[hsl(var(--color-accent))]" />
                        已确认
                      </div>
                    );
                  })()
                ) : (
                  <span className="text-[10px] text-[hsl(var(--color-muted-foreground))]">未确认</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
