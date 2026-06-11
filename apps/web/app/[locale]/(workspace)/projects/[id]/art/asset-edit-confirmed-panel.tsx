'use client';
import * as React from 'react';
import { CheckCircle2, Loader2, Upload, Shirt } from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { Label } from '@/components/ui/label';
import { ImageLightbox, ImagePreviewButton } from '@/components/ui/image-lightbox';
import { cn } from '@/lib/utils';
import { fileToBase64 } from '@/lib/file-to-base64';

import { type AssetDetail, type Slot, SLOT_FIELD } from './asset-edit-shared';

// ---------------------------------------------------------------------------
// 右:已确认槽位 + 按集造型切换(七二)
//   ① 本地上传:每槽位「上传本地图 / 拖入」直接确认(media.upload → confirmCandidate,全类型)
//   ② 跨集换装:顶部「造型:通用 / 第N集」切换器。某集模式下槽位走 outfit API
//      (setOutfitSlot / clearOutfitSlot),空槽继承通用形象(灰显);下游该集视频自动用本集造型。
// ---------------------------------------------------------------------------

// 可按集换装的槽位:人物形象(portrait)/ 三视图(人物)·九宫格(场景)同 three_view 字段
const OUTFIT_SLOTS = new Set<Slot>(['portrait', 'three_view']);
type OutfitSlot = 'portrait' | 'three_view';

export function ConfirmedSlotsPanel({
  asset,
  slots,
  onChanged,
}: {
  asset: AssetDetail;
  slots: Array<{ slot: Slot; label: string; aspectClass: string }>;
  onChanged: () => void;
}): React.ReactElement {
  const [outfitEpisodeId, setOutfitEpisodeId] = React.useState<string | null>(null); // null = 通用造型
  const [uploadingSlot, setUploadingSlot] = React.useState<Slot | null>(null);
  // 七二第九波(用户:全覆盖):已确认槽位图大图预览
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  // 仅人物/场景支持按集造型(道具/风格参考无换装语义)
  const supportsOutfit = asset.type === 'CHARACTER' || asset.type === 'SCENE';
  const { data: outfitData, refetch: refetchOutfits } = trpc.asset.listOutfits.useQuery(
    { assetId: asset.id },
    { enabled: supportsOutfit },
  );

  const unconfirmMut = trpc.asset.unconfirmSlot.useMutation({
    onSuccess: () => {
      toast.success('已清除槽位');
      onChanged();
    },
  });
  const uploadMut = trpc.media.upload.useMutation();
  const confirmMut = trpc.asset.confirmCandidate.useMutation();
  const setOutfitMut = trpc.asset.setOutfitSlot.useMutation();
  const clearOutfitMut = trpc.asset.clearOutfitSlot.useMutation();

  // 资产锁定时禁止改槽位(与后端 confirmCandidate 的 lockedAt 守卫一致)
  const locked = !!(asset as { lockedAt?: string | Date | null }).lockedAt;
  const currentOutfit = outfitEpisodeId
    ? (outfitData?.outfits.find((o) => o.episodeId === outfitEpisodeId) ?? null)
    : null;

  const generalUrlOf = (mediaId: string | null): string | null => {
    if (!mediaId) return null;
    const m = (asset as { mediaMap?: Record<string, { cdnUrl?: string | null; storageKey: string }> })
      .mediaMap?.[mediaId];
    return m?.cdnUrl ?? m?.storageKey ?? null;
  };

  // 某集模式只显示可换装槽位(portrait/three_view);通用模式显示全部。
  // 七二第八波:场景主资产已改九宫格(three_view)且进 pickAssetMediaId 取图链,
  //   故场景按集换装开放 three_view(九宫格)— 覆盖下游视频生效。
  const displaySlots = outfitEpisodeId
    ? slots.filter((s) => OUTFIT_SLOTS.has(s.slot))
    : slots;

  const handleSlotUpload = async (slot: Slot, file: File | undefined): Promise<void> => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }
    setUploadingSlot(slot);
    try {
      const base64 = await fileToBase64(file);
      const media = await uploadMut.mutateAsync({
        filename: file.name,
        fileBase64: base64,
        kind: 'IMAGE',
        scope: 'PROJECT',
        projectId: asset.projectId,
        mimeType: file.type || undefined,
      });
      if (outfitEpisodeId) {
        await setOutfitMut.mutateAsync({
          assetId: asset.id,
          episodeId: outfitEpisodeId,
          slot: slot as OutfitSlot,
          mediaItemId: media.id,
        });
        toast.success('换装图已设为本集造型');
        await refetchOutfits();
      } else {
        await confirmMut.mutateAsync({ assetId: asset.id, slot, mediaItemId: media.id });
        toast.success('本地图已上传并确认到槽位');
        onChanged();
      }
    } catch (err) {
      toast.error(`上传失败:${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleClear = async (slot: Slot): Promise<void> => {
    try {
      if (outfitEpisodeId) {
        await clearOutfitMut.mutateAsync({
          assetId: asset.id,
          episodeId: outfitEpisodeId,
          slot: slot as OutfitSlot,
        });
        toast.success('已清除本集造型(回退通用)');
        await refetchOutfits();
      } else {
        unconfirmMut.mutate({ assetId: asset.id, slot });
      }
    } catch (err) {
      toast.error(`清除失败:${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[hsl(var(--color-border))] px-4 py-3">
        <h3 className="text-sm font-semibold">已确认槽位</h3>
        <p className="mt-0.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">
          下游 AIGC 调用以这里为准
        </p>
        {supportsOutfit && (
          <div className="mt-2 flex items-center gap-1.5">
            <Shirt className="size-3 shrink-0 text-[hsl(var(--color-muted-foreground))]" />
            <select
              value={outfitEpisodeId ?? ''}
              onChange={(e) => setOutfitEpisodeId(e.target.value || null)}
              className="h-6 flex-1 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-1.5 text-[11px]"
            >
              <option value="">造型:通用(默认形象)</option>
              {outfitData?.episodes.map((ep) => {
                const has = outfitData.outfits.some(
                  (o) =>
                    o.episodeId === ep.id &&
                    (o.slots.portrait || o.slots.three_view),
                );
                return (
                  <option key={ep.id} value={ep.id}>
                    第{ep.number}集{ep.title ? ` ${ep.title}` : ''}
                    {has ? ' ●' : ''}
                  </option>
                );
              })}
            </select>
          </div>
        )}
        {outfitEpisodeId && (
          <p className="mt-1 text-[9px] leading-relaxed text-[hsl(var(--color-accent))]">
            本集造型:空槽继承通用形象(灰显);上传换装图覆盖。下游该集视频自动用此造型。
          </p>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {outfitEpisodeId && displaySlots.length === 0 && (
          <p className="text-[10px] text-[hsl(var(--color-muted-foreground))]">该类型暂不支持按集造型</p>
        )}
        {displaySlots.map((s) => {
          const slotKey = s.slot as OutfitSlot;
          const outfitSlot = currentOutfit?.slots[slotKey] ?? null;
          const generalId = (asset as unknown as Record<string, string | null>)[SLOT_FIELD[s.slot]];
          // 某集模式:有覆盖用覆盖,否则回退通用(inherited 灰显);通用模式:用 asset 槽位
          let mediaId: string | null;
          let url: string | null;
          let inherited = false;
          if (outfitEpisodeId) {
            if (outfitSlot) {
              mediaId = outfitSlot.mediaId;
              url = outfitSlot.url;
            } else {
              mediaId = generalId;
              url = generalUrlOf(generalId);
              inherited = true;
            }
          } else {
            mediaId = generalId;
            url = generalUrlOf(generalId);
          }
          const isUploading = uploadingSlot === s.slot;
          // 当前造型「自己」有图(非继承)→ 才显示替换/清除
          const hasOwn = outfitEpisodeId ? !!outfitSlot : !!generalId;
          // 合规绿标只在通用模式(某集造型图未必过审)
          const complianceApproved =
            !outfitEpisodeId &&
            asset.type === 'CHARACTER' &&
            (asset as { complianceStatus?: string }).complianceStatus === 'APPROVED' &&
            (s.slot === 'portrait' || s.slot === 'three_view');
          return (
            <div key={s.slot}>
              <div className="mb-1 flex items-center justify-between">
                <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                  {s.label}
                  {inherited && (
                    <span className="ml-1 normal-case text-[hsl(var(--color-muted-foreground))]">· 继承通用</span>
                  )}
                </Label>
                <div className="flex items-center gap-2">
                  {!locked && (
                    <label className="cursor-pointer text-[9px] text-[hsl(var(--color-accent))] hover:underline">
                      {hasOwn ? '替换' : '上传本地图'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={isUploading}
                        onChange={(e) => {
                          void handleSlotUpload(s.slot, e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                  {hasOwn && !locked && (
                    <button
                      onClick={() => void handleClear(s.slot)}
                      className="text-[9px] text-[hsl(var(--color-destructive))] hover:underline"
                    >
                      清除
                    </button>
                  )}
                </div>
              </div>
              <div
                onDragOver={locked ? undefined : (e) => e.preventDefault()}
                onDrop={
                  locked
                    ? undefined
                    : (e) => {
                        e.preventDefault();
                        void handleSlotUpload(s.slot, e.dataTransfer.files?.[0]);
                      }
                }
                className={cn(
                  // 五八:限高 + 下面 object-contain → 已确认槽位也一屏看完整
                  'group relative flex max-h-[44vh] items-center justify-center overflow-hidden rounded border bg-[hsl(var(--color-secondary)/0.3)]',
                  s.aspectClass,
                  inherited && 'opacity-50',
                  hasOwn
                    ? 'border-[hsl(var(--color-accent)/0.5)]'
                    : 'border-dashed border-[hsl(var(--color-border))]',
                )}
              >
                {url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={s.label} className="absolute inset-0 size-full object-contain" />
                    {/* 七二第九波(用户:全覆盖):槽位图右上角预览大图 */}
                    <ImagePreviewButton
                      onOpen={() => setPreviewUrl(url)}
                      className="absolute right-1.5 top-1.5 rounded-full bg-black/45 p-1 text-white opacity-0 backdrop-blur-sm transition hover:bg-black/65 focus:opacity-100 group-hover:opacity-100"
                    />
                    {complianceApproved && (
                      <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--color-success))]">
                        <CheckCircle2 className="size-3" />
                        已通过合规审查
                      </span>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                    <span>未确认</span>
                    {!locked && (
                      <label className="flex cursor-pointer items-center gap-1 rounded border border-dashed border-[hsl(var(--color-border))] px-2 py-1 hover:border-[hsl(var(--color-accent)/0.6)] hover:text-[hsl(var(--color-foreground))]">
                        <Upload className="size-3" />
                        上传本地图 / 拖入
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={isUploading}
                          onChange={(e) => {
                            void handleSlotUpload(s.slot, e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                  </div>
                )}
                {isUploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <Loader2 className="size-5 animate-spin text-white" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {previewUrl && (
        <ImageLightbox url={previewUrl} onClose={() => setPreviewUrl(null)} />
      )}
    </div>
  );
}
