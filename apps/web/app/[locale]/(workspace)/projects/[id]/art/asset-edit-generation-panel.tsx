'use client';
import * as React from 'react';
import {
  Loader2,
  Sparkles,
  X,
  Image as ImageIcon,
  Info,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { fileToBase64 } from '@/lib/file-to-base64';

import {
  type AssetDetail,
  type AssetType,
  type Slot,
  SLOTS_BY_TYPE,
  RATIOS,
  SIZES,
} from './asset-edit-shared';
import { CandidateCard } from './asset-edit-candidate-card';
import { CandidateInfoDialog } from './asset-edit-candidate-info-dialog';

// ---------------------------------------------------------------------------
// 中:生成 + 预览 + 候选备用区
// ---------------------------------------------------------------------------

export function GenerationPanel({
  asset,
  onChanged,
}: {
  asset: AssetDetail;
  onChanged: () => void;
}): React.ReactElement {
  const type = asset.type as AssetType;
  const slots = SLOTS_BY_TYPE[type];
  const [selectedSlot, setSelectedSlot] = React.useState<Slot>(slots[0]!.slot);
  const [modelId, setModelId] = React.useState('');
  const [aspectRatio, setAspectRatio] = React.useState<string>(
    selectedSlot === 'portrait' ? '9:16' : selectedSlot === 'panorama' ? '2:1' : '16:9',
  );
  const [sizePx, setSizePx] = React.useState<string>('2K (2048)');
  const [extraInstruction, setExtraInstruction] = React.useState('');
  const [count, setCount] = React.useState(1);
  // 五七-3:图生图参考图 + 强度 + 负面词
  const [refImageIds, setRefImageIds] = React.useState<string[]>([]);
  const [refPreviews, setRefPreviews] = React.useState<Record<string, string>>({});
  const [strength, setStrength] = React.useState(0.6);
  const [extraNegative, setExtraNegative] = React.useState('');
  const [refUploading, setRefUploading] = React.useState(false);
  const refFileRef = React.useRef<HTMLInputElement>(null);
  const uploadRef = trpc.media.upload.useMutation();

  const handleRefFiles = async (files: File[]): Promise<void> => {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (imgs.length === 0) return;
    setRefUploading(true);
    try {
      for (const file of imgs) {
        if (refImageIds.length >= 16) break;
        const base64 = await fileToBase64(file);
        const media = await uploadRef.mutateAsync({
          filename: file.name,
          fileBase64: base64,
          kind: 'IMAGE',
          scope: 'PROJECT',
          projectId: asset.projectId,
          mimeType: file.type || undefined,
        });
        const objUrl = URL.createObjectURL(file);
        setRefImageIds((prev) => [...prev, media.id].slice(0, 16));
        setRefPreviews((prev) => ({ ...prev, [media.id]: objUrl }));
      }
      toast.success('参考图已上传');
    } catch (err) {
      toast.error(`参考图上传失败:${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRefUploading(false);
    }
  };
  const removeRef = (id: string): void => {
    setRefImageIds((prev) => prev.filter((x) => x !== id));
    setRefPreviews((prev) => {
      const next = { ...prev };
      const u = next[id];
      if (u) URL.revokeObjectURL(u);
      delete next[id];
      return next;
    });
  };

  const { data: candidates, refetch: refetchCandidates } = trpc.asset.listCandidates.useQuery({
    assetId: asset.id,
    slot: selectedSlot,
  });

  // 五六收工:图片模型下拉读真实 active IMAGE Provider(替原 hardcode 3 占位模型)
  const { data: imageProviders } = trpc.asset.listImageProviders.useQuery();

  const [infoOpen, setInfoOpen] = React.useState<
    | {
        attempt: NonNullable<typeof candidates>[number]['attempt'];
        media: NonNullable<typeof candidates>[number]['media'][number];
      }
    | null
  >(null);

  const generateMut = trpc.asset.generateImage.useMutation({
    onSuccess: (res) => {
      toast.success(
        `生成完成 · ${res.candidates.length} 张候选 · 成本 ¥${res.cost.toFixed(4)}`,
      );
      void refetchCandidates();
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  const confirmMut = trpc.asset.confirmCandidate.useMutation({
    onSuccess: () => {
      toast.success('已确认到资产槽位');
      void refetchCandidates();
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  const rejectMut = trpc.asset.rejectCandidate.useMutation({
    onSuccess: () => {
      toast.success('已删除候选');
      void refetchCandidates();
    },
  });

  React.useEffect(() => {
    setAspectRatio(
      selectedSlot === 'portrait'
        ? '9:16'
        : selectedSlot === 'panorama'
          ? '2:1'
          : selectedSlot === 'three_view'
            ? '16:9'
            : '16:9',
    );
  }, [selectedSlot]);

  // 需求(2026-06):图像模型默认显式选中 binding 配的默认 provider(当前 = Seedream 5.0 lite),
  //   而非停留在抽象的「默认模型(绑定)」。只初始化一次,之后用户可自由切换(含切回 "" 跟随绑定)。
  const didInitModel = React.useRef(false);
  React.useEffect(() => {
    if (!didInitModel.current && imageProviders?.defaultProviderId) {
      setModelId(imageProviders.defaultProviderId);
      didInitModel.current = true;
    }
  }, [imageProviders?.defaultProviderId]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[hsl(var(--color-border))] px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">生成 + 预览</h3>
          <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">
            <Info className="size-3" />
            生成的图自动写到候选池,点&quot;设为槽位&quot;才确认
          </div>
        </div>

        {/* 槽位 tab */}
        <div className="mt-2 flex flex-wrap gap-1">
          {slots.map((s) => (
            <button
              key={s.slot}
              onClick={() => setSelectedSlot(s.slot)}
              className={cn(
                'rounded px-2 py-1 text-[11px]',
                selectedSlot === s.slot
                  ? 'bg-[hsl(var(--color-accent)/0.15)] text-[hsl(var(--color-accent))]'
                  : 'text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* 五八:三视图一步到位 — 以已确认人物形象图为参考(图生图)直接生成三视图 */}
        {selectedSlot === 'three_view' && asset.portraitMediaId && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-[hsl(var(--color-accent)/0.4)] bg-[hsl(var(--color-accent)/0.08)] px-2.5 py-2">
            <span className="text-[11px] text-[hsl(var(--color-foreground))]">
              一步到位:以已确认的人物形象图为参考,直接生成三视图
            </span>
            <Button
              size="sm"
              onClick={() =>
                generateMut.mutate({
                  assetId: asset.id,
                  slot: 'three_view',
                  count: 1,
                  aspectRatio: '16:9',
                  sizePx,
                  refImageIds: [asset.portraitMediaId!],
                  strength,
                  extraInstruction: extraInstruction || undefined,
                  extraNegative: extraNegative.trim()
                    ? extraNegative
                        .split(/[,，]/)
                        .map((x) => x.trim())
                        .filter(Boolean)
                        .slice(0, 20)
                    : undefined,
                })
              }
              disabled={generateMut.isPending}
              className="shrink-0 gap-1.5"
            >
              {generateMut.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              用形象图生成三视图
            </Button>
          </div>
        )}

        {/* 生成参数 */}
        <div className="mt-2 grid grid-cols-4 gap-2">
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="h-8 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-xs"
            title="默认 = 用后台 binding 配的图片模型;也可显式切到某个已配 Provider"
          >
            <option value="">默认模型(绑定)</option>
            {imageProviders?.providers.map((p) => (
              <option key={p.providerId} value={p.providerId}>
                {p.displayName || p.providerId}
              </option>
            ))}
          </select>
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            className="h-8 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-xs"
          >
            {RATIOS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            value={sizePx}
            onChange={(e) => setSizePx(e.target.value)}
            className="h-8 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-xs"
          >
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="h-8 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-xs"
          >
            {[1, 2, 3, 4].map((c) => (
              <option key={c} value={c}>
                生成 {c} 张
              </option>
            ))}
          </select>
        </div>

        {/* 五七-3:参考图(图生图)+ 强度 + 负面词 */}
        <div
          className="mt-2 rounded-md border border-dashed border-[hsl(var(--color-border))] p-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void handleRefFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
              参考图(图生图 · 拖入或选择,≤16 张 · 视模型支持)
            </span>
            <button
              type="button"
              onClick={() => refFileRef.current?.click()}
              disabled={refUploading}
              className="flex items-center gap-1 text-[10px] text-[hsl(var(--color-accent))] hover:underline disabled:opacity-50"
            >
              {refUploading ? <Loader2 className="size-2.5 animate-spin" /> : <Upload className="size-2.5" />}
              添加
            </button>
          </div>
          <input
            ref={refFileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleRefFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          {refImageIds.length > 0 && (
            <>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {refImageIds.map((id) => (
                  <div
                    key={id}
                    className="group relative size-12 overflow-hidden rounded border border-[hsl(var(--color-border))]"
                  >
                    {refPreviews[id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={refPreviews[id]} alt="" className="size-full object-cover" />
                    ) : (
                      <ImageIcon className="m-auto size-4 opacity-40" />
                    )}
                    <button
                      type="button"
                      onClick={() => removeRef(id)}
                      className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="size-2.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[10px] text-[hsl(var(--color-muted-foreground))]">参考强度</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={strength}
                  onChange={(e) => setStrength(Number(e.target.value))}
                  className="flex-1 accent-[hsl(var(--color-accent))]"
                />
                <span className="w-8 text-right font-mono text-[10px] text-[hsl(var(--color-muted-foreground))]">
                  {strength.toFixed(2)}
                </span>
              </div>
            </>
          )}
          <Input
            value={extraNegative}
            onChange={(e) => setExtraNegative(e.target.value)}
            placeholder="负面词(逗号分隔,如&quot;模糊,多手,变形&quot;)"
            className="mt-1.5 h-7 text-xs"
          />
        </div>

        <div className="mt-2 flex gap-2">
          <Input
            value={extraInstruction}
            onChange={(e) => setExtraInstruction(e.target.value)}
            placeholder="额外指令(可选,如&quot;增加雨天氛围&quot;)"
            className="h-8 flex-1 text-xs"
          />
          <Button
            onClick={() =>
              generateMut.mutate({
                assetId: asset.id,
                slot: selectedSlot,
                count,
                modelId: modelId || undefined,
                aspectRatio,
                sizePx,
                extraInstruction: extraInstruction || undefined,
                refImageIds: refImageIds.length > 0 ? refImageIds : undefined,
                strength: refImageIds.length > 0 ? strength : undefined,
                extraNegative: extraNegative.trim()
                  ? extraNegative
                      .split(/[,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .slice(0, 20)
                  : undefined,
              })
            }
            disabled={generateMut.isPending}
            size="sm"
            className="gap-1.5"
          >
            {generateMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            开始生成
          </Button>
        </div>
      </div>

      {/* 候选图栅格 */}
      <div className="flex-1 overflow-y-auto p-4">
        {!candidates || candidates.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <ImageIcon className="mb-3 size-12 text-[hsl(var(--color-muted-foreground)/0.4)]" />
            <p className="text-xs text-[hsl(var(--color-muted-foreground))]">
              本槽位还没有候选图,点上方&quot;开始生成&quot;
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {candidates.flatMap((c) =>
              c.media.map((media) => (
                <CandidateCard
                  key={`${c.attempt.id}-${media.id}`}
                  attemptId={c.attempt.id}
                  mediaId={media.id}
                  url={media.cdnUrl ?? media.storageKey}
                  isConfirmed={media.isConfirmed}
                  aspectRatio={media.aspectRatio ?? '1:1'}
                  onOpenInfo={() => setInfoOpen({ attempt: c.attempt, media })}
                  onConfirm={() =>
                    confirmMut.mutate({
                      assetId: asset.id,
                      slot: selectedSlot,
                      mediaItemId: media.id,
                    })
                  }
                  onReject={() => rejectMut.mutate({ mediaItemId: media.id })}
                />
              )),
            )}
          </div>
        )}
      </div>

      {infoOpen && (
        <CandidateInfoDialog
          attempt={infoOpen.attempt}
          media={infoOpen.media}
          onClose={() => setInfoOpen(null)}
          onSameStyle={() => {
            const input = infoOpen.attempt.inputJson as Record<string, unknown>;
            generateMut.mutate({
              assetId: asset.id,
              slot: selectedSlot,
              count: 1,
              aspectRatio: (input.aspectRatio as string) ?? aspectRatio,
              extraInstruction: '(同款重新生成)',
            });
            setInfoOpen(null);
          }}
          onReject={() => {
            rejectMut.mutate({ mediaItemId: infoOpen.media.id });
            setInfoOpen(null);
          }}
        />
      )}
    </div>
  );
}
