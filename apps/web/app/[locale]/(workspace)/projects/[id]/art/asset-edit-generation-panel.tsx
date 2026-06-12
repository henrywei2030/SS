'use client';
import * as React from 'react';
import {
  Loader2,
  Sparkles,
  X,
  Image as ImageIcon,
  Info,
  Upload,
  Shirt,
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
    // 七二第九波(用户②):人物 portrait=「主体形象」turnaround 默认 16:9(原 9:16);panorama 2:1
    selectedSlot === 'panorama' ? '2:1' : '16:9',
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
  // 七二第九波(用户①·换衣/变装):造型描述 + 目标集(可选)。复用 listOutfits 拿集列表(与确认面板共享缓存)
  const [outfitDesc, setOutfitDesc] = React.useState('');
  const [outfitEpisodeId, setOutfitEpisodeId] = React.useState('');
  const { data: outfitData } = trpc.asset.listOutfits.useQuery(
    { assetId: asset.id },
    { enabled: type === 'CHARACTER' },
  );
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
      // 七二第九波(用户②):人物 portrait=「主体形象」turnaround 默认 16:9;场景九宫格(three_view)16:9;
      //   仅 360° 全景 panorama 用 2:1。
      selectedSlot === 'panorama' ? '2:1' : '16:9',
    );
  }, [selectedSlot, type]);

  // 槽位媒体 → 预览 URL(自动参考链用)
  const slotMediaUrl = React.useCallback(
    (mediaId: string | null): string | null => {
      if (!mediaId) return null;
      const m = (
        asset as {
          mediaMap?: Record<string, { cdnUrl?: string | null; storageKey: string; previewUrl?: string | null }>;
        }
      ).mediaMap?.[mediaId];
      // previewUrl = 后端签好的可访问 URL(上传图 cdnUrl=null,绝不能回退裸 storageKey)
      return m?.previewUrl ?? m?.cdnUrl ?? null;
    },
    [asset],
  );
  const portraitUrl = slotMediaUrl(asset.portraitMediaId);
  const panoramaUrl = slotMediaUrl(asset.panoramaMediaId);

  // 自动参考链(六七人物 + 六八场景,同一逻辑):切槽位时重置参考区防泄漏,
  //   上游槽位已确认 → 自动以它为参考(图生图);用户可手动移除 → 回退从设定生成。
  //   人物:形象 → 三视图;场景:360° 全景(主)→ 九宫格(次,以全景为参考)。
  React.useEffect(() => {
    setRefPreviews((prev) => {
      for (const u of Object.values(prev)) {
        if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
      }
      return {};
    });
    const autoRef = (mediaId: string | null, url: string | null): boolean => {
      if (!mediaId || !url) return false;
      setRefImageIds([mediaId]);
      setRefPreviews({ [mediaId]: url });
      return true;
    };
    const applied =
      selectedSlot === 'three_view' && type === 'CHARACTER'
        ? autoRef(asset.portraitMediaId, portraitUrl)
        : selectedSlot === 'three_view' && type === 'SCENE'
          ? autoRef(asset.panoramaMediaId, panoramaUrl) // 九宫格(次)以 360°全景(主)为参考
          : false;
    if (!applied) setRefImageIds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedSlot,
    type,
    asset.portraitMediaId,
    portraitUrl,
    asset.panoramaMediaId,
    panoramaUrl,
  ]);

  // 当前自动参考状态(状态条 + 提示用)
  const threeViewFromPortrait =
    selectedSlot === 'three_view' &&
    type === 'CHARACTER' &&
    refImageIds.includes(asset.portraitMediaId ?? '');
  const threeViewFromPanorama =
    selectedSlot === 'three_view' &&
    type === 'SCENE' &&
    refImageIds.includes(asset.panoramaMediaId ?? '');

  // 需求(2026-06):图像模型默认显式选中 binding 配的默认 provider(当前 = Seedream 5.0 lite),
  //   而非停留在抽象的「默认模型(绑定)」。只初始化一次,之后用户可自由切换(含切回 "" 跟随绑定)。
  // 六八(用户定调):场景资产优先 gpt-image-2 系模型 — 有配置时默认选中,没有再回 binding 默认。
  const didInitModel = React.useRef(false);
  React.useEffect(() => {
    if (didInitModel.current || !imageProviders) return;
    const gptImage =
      type === 'SCENE'
        ? imageProviders.providers.find(
            (p) =>
              /gpt-image/i.test(p.providerId) || /gpt-image/i.test(p.displayName ?? ''),
          )?.providerId
        : undefined;
    const next = gptImage ?? imageProviders.defaultProviderId;
    if (next) {
      setModelId(next);
      didInitModel.current = true;
    }
  }, [imageProviders, type]);

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

        {/* 自动参考状态条(六七人物三视图 + 六八场景九宫格/全景):走「参考图生图」还是「从设定生成」 */}
        {((selectedSlot === 'three_view' && type === 'CHARACTER') ||
          (type === 'SCENE' && selectedSlot === 'three_view')) && (
          <div
            className={cn(
              'mt-2 flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] leading-snug',
              threeViewFromPortrait || threeViewFromPanorama
                ? 'border-[hsl(var(--color-accent)/0.4)] bg-[hsl(var(--color-accent)/0.08)] text-[hsl(var(--color-foreground))]'
                : 'border-[hsl(var(--color-border))] text-[hsl(var(--color-muted-foreground))]',
            )}
          >
            <Info className="mt-px size-3 shrink-0" />
            {selectedSlot === 'three_view' && type === 'CHARACTER' ? (
              threeViewFromPortrait ? (
                <span>
                  将以下方<b>人物形象图</b>为参考(图生图)生成三视图,保持脸型/服装一致;移除参考图可改为从设定从零生成。gpt-image 图生图约 2-6 分钟,请耐心等待。
                </span>
              ) : asset.portraitMediaId ? (
                <span>当前为从设定生成(未用形象图参考)。建议先把人物形象图加回参考区,生成更一致的三视图。</span>
              ) : (
                <span>人物形象尚未确认。先在「人物形象」槽位生成并确认一张形象图,三视图即可自动以它为参考生成。</span>
              )
            ) : threeViewFromPanorama ? (
              <span>
                将以<b>360° 全景</b>为参考(图生图)生成九宫格视图,各角度与全景空间对齐;移除参考图可改为从设定生成。图生图约 2-6 分钟。
              </span>
            ) : asset.panoramaMediaId ? (
              <span>当前为从设定生成(未用全景参考)。建议把 360° 全景加回参考区,九宫格各角度与全景更一致。</span>
            ) : (
              <span>360° 全景尚未确认。先在「360° 全景」槽位生成并确认一张,九宫格即可自动以它为参考生成。</span>
            )}
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
                {refImageIds.map((id) => {
                  const isPortrait = id === asset.portraitMediaId;
                  return (
                    <div
                      key={id}
                      className={cn(
                        'group relative size-12 overflow-hidden rounded border',
                        isPortrait
                          ? 'border-[hsl(var(--color-accent)/0.6)] ring-1 ring-[hsl(var(--color-accent)/0.4)]'
                          : 'border-[hsl(var(--color-border))]',
                      )}
                      title={isPortrait ? '已确认的人物形象图(三视图参考)' : undefined}
                    >
                      {refPreviews[id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={refPreviews[id]} alt="" className="size-full object-cover" />
                      ) : (
                        <ImageIcon className="m-auto size-4 opacity-40" />
                      )}
                      {isPortrait && (
                        <span className="absolute bottom-0 left-0 right-0 bg-[hsl(var(--color-accent)/0.85)] text-center text-[8px] leading-tight text-white">
                          形象
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeRef(id)}
                        className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <X className="size-2.5" />
                      </button>
                    </div>
                  );
                })}
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
            {threeViewFromPortrait ? '用形象图生成三视图' : '开始生成'}
          </Button>
        </div>

        {/* 七二第九波(用户①·换衣/变装):主体形象已确认 → 以它为参考图生图换装(只换衣不改人) */}
        {type === 'CHARACTER' && selectedSlot === 'portrait' && asset.portraitMediaId && (
          <div className="mt-2 rounded-md border border-[hsl(var(--color-accent)/0.3)] bg-[hsl(var(--color-accent)/0.05)] p-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--color-accent))]">
              <Shirt className="size-3.5" /> 换衣 / 变装
              <span className="text-[10px] font-normal text-[hsl(var(--color-muted-foreground))]">
                以主体形象为参考,只换衣不改人
              </span>
            </div>
            <div className="flex gap-2">
              <Input
                value={outfitDesc}
                onChange={(e) => setOutfitDesc(e.target.value)}
                placeholder="造型描述,如「礼服」;留空=随机一套适合的衣服"
                className="h-8 flex-1 text-xs"
              />
              <select
                value={outfitEpisodeId}
                onChange={(e) => setOutfitEpisodeId(e.target.value)}
                title="可直接设为某集造型;不选则只进候选池,稍后在「已确认槽位」设定"
                className="h-8 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-1.5 text-[11px]"
              >
                <option value="">仅存候选</option>
                {outfitData?.episodes.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    设为第{ep.number}集造型
                  </option>
                ))}
              </select>
              <Button
                onClick={() =>
                  generateMut.mutate({
                    assetId: asset.id,
                    slot: 'portrait',
                    count: 1,
                    modelId: modelId || undefined,
                    aspectRatio,
                    outfit: {
                      desc: outfitDesc.trim() || undefined,
                      episodeId: outfitEpisodeId || undefined,
                    },
                  })
                }
                disabled={generateMut.isPending}
                size="sm"
                variant="outline"
                className="gap-1.5"
              >
                {generateMut.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Shirt className="size-3.5" />
                )}
                变装
              </Button>
            </div>
          </div>
        )}
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
