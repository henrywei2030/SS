'use client';
import * as React from 'react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { normalizePrompt } from '@ss/shared';
import { type AspectRatio } from '@ss/shared/constants';

import { VideoPreviewSection } from './video-preview-section';

// ---------------------------------------------------------------------------
// 右侧详情:4 个 section
// ---------------------------------------------------------------------------

export interface DetailProps {
  groupId: string;
  // 用户反馈 r8:同页堆叠,callback 接 groupId(每个 GroupDetail 用自己的 id 调用)
  onAutoMatch: (groupId: string) => void;
  autoMatchPending: boolean;
  onAutoTag: (groupId: string) => void;
  autoTagPending: boolean;
  onOpenBindDialog: (groupId: string) => void;
  onUnbind: (bindingId: string) => void;
  unbindPending: boolean;
  onSavePrompt: (groupId: string, prompt: string, diffNote?: string) => void;
  savePromptPending: boolean;
  onGenerateVideo: (
    groupId: string,
    opts: {
      durationS?: number;
      aspectRatio?: AspectRatio;
      // W5.5.1 扩展(对照即梦/可灵 UI)
      resolution?: '480p' | '720p' | '1080p';
      generateAudio?: boolean;
      // 2026-05-27:VideoPreviewSection 选了非 binding 默认的 provider 时传过来
      providerOverride?: string;
    },
  ) => void;
  generateVideoPending: boolean;
  onRejectTake: (attemptId: string) => void;
  rejectTakePending: boolean;
  autoSelectAttemptId: string | null;
  onAutoSelectConsumed: () => void;
}

export function GroupDetail({
  groupId,
  onAutoMatch,
  autoMatchPending,
  onAutoTag,
  autoTagPending,
  onOpenBindDialog,
  onUnbind,
  unbindPending,
  onSavePrompt,
  savePromptPending,
  onGenerateVideo,
  generateVideoPending,
  onRejectTake,
  rejectTakePending,
  autoSelectAttemptId,
  onAutoSelectConsumed,
}: DetailProps): React.ReactElement {
  const { data, isLoading } = trpc.aigc.getGroupDetail.useQuery({ groupId });
  const { data: compiled } = trpc.aigc.previewCompiledPrompt.useQuery(
    { groupId },
    { enabled: !!data },
  );

  const [editingPrompt, setEditingPrompt] = React.useState(false);
  const [draftPrompt, setDraftPrompt] = React.useState('');
  // 跟分镜表 GroupPromptEditor 同源 — view + edit 都基于 normalized 基准,
  // 去 LLM 输出里 \n\n 段间空行 + [i/N] 独占行的视觉冗余
  const normalizedGroupPrompt = React.useMemo(
    () => normalizePrompt(data?.group.prompt ?? ''),
    [data?.group.prompt],
  );
  // W1-W5 audit 三轮 U3:加 savePromptPending 守卫,防 mutation 异步期间 useEffect
  // 用旧 data.group.prompt 覆盖用户刚输入的草稿(原 bug:保存后草稿闪一下变回旧值)
  React.useEffect(() => {
    if (data && !editingPrompt && !savePromptPending) {
      setDraftPrompt(normalizedGroupPrompt);
    }
  }, [data, editingPrompt, savePromptPending, normalizedGroupPrompt]);

  // M6:单组 AI 优化(写回 ShotGroup.prompt,人可审可改;binding 未配时服务端引导去 /admin/bindings)
  const groupUtils = trpc.useUtils();
  const optimizeMut = trpc.aigc.optimizeGroupPrompt.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.changed
          ? `提示词已优化(${r.modelId} · ¥${r.costCny.toFixed(3)} · 维度:${r.contributorsUsed.join('+')})`
          : `优化器认为当前提示词已最佳,未改动(¥${r.costCny.toFixed(3)})`,
      );
      void groupUtils.aigc.getGroupDetail.invalidate({ groupId });
      void groupUtils.aigc.previewCompiledPrompt.invalidate({ groupId });
    },
    onError: (e) => toast.error(`优化失败:${e.message}`),
  });

  if (isLoading || !data) {
    return (
      <div className="text-sm text-[hsl(var(--color-muted-foreground))]">
        加载中...
      </div>
    );
  }

  const { group, shots, bindings } = data;

  const savePrompt = (): void => {
    if (draftPrompt.trim() === normalizedGroupPrompt.trim()) {
      setEditingPrompt(false);
      return;
    }
    onSavePrompt(groupId, draftPrompt);
    setEditingPrompt(false);
  };

  return (
    // 用户反馈 r8:scroll-margin-top 抵消顶栏 sticky toolbar(11/4rem=2.75rem),
    // scrollIntoView 时 group header 不会被 toolbar 盖住
    <div
      id={`group-${groupId}`}
      className="flex scroll-mt-14 flex-col gap-3"
    >
      {/* 顶部 group 信息条(紧凑 · 一行平铺) */}
      <header className="flex items-center justify-between rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 py-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[length:1.1em] font-semibold">{group.number}</h2>
          <span className="text-[length:0.85em] text-[hsl(var(--color-muted-foreground))]">
            {shots.length} 镜 · {group.durationS.toFixed(1)} s · {group.status}
          </span>
        </div>
        <span className="text-[length:0.78em] text-[hsl(var(--color-muted-foreground))]">
          group #{group.positionIdx}
        </span>
      </header>

      {/* 2026-05-27 用户反馈:删原始剧本 + 视频预览扩宽 → 3 列布局
       *   xl 屏:资产 14rem / 提示词 1fr(吃剩余)/ 视频 28rem(扩了 6rem)
       *   小屏 fallback:单列上下堆 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[14rem_1fr_28rem] xl:items-start">
      {/* Section 1: 资产关联 + 关键帧(M3a) */}
      <div className="flex flex-col gap-3">
      <section className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[length:0.95em] font-semibold">资产关联</h3>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => onAutoMatch(groupId)}
              disabled={autoMatchPending}
              className="rounded border border-[hsl(var(--color-border))] px-2 py-1 text-[length:0.78em] hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
            >
              {autoMatchPending ? '匹配中...' : '自动匹配'}
            </button>
            <button
              onClick={() => onOpenBindDialog(groupId)}
              className="rounded border border-[hsl(var(--color-border))] px-2 py-1 text-[length:0.78em] hover:bg-[hsl(var(--color-muted))]"
            >
              关联素材
            </button>
          </div>
        </div>
        {bindings.length === 0 ? (
          <p className="text-[length:0.78em] text-[hsl(var(--color-muted-foreground))]">
            还没有关联资产 — 点"自动匹配"或"关联素材"
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {bindings.map((b) => (
              <BindingCard
                key={b.id}
                binding={b}
                onUnbind={() => onUnbind(b.id)}
                unbindPending={unbindPending}
              />
            ))}
          </div>
        )}
      </section>

      {/* Section 1.5: 关键帧先行(M3a 六八)— 出首帧候选 → 确认 → 视频生成作首帧约束 */}
      <KeyframeSection groupId={groupId} />
      </div>

      {/* 2026-05-27 用户反馈:删原始剧本 section,提示词区一目了然 + 节省横向空间给视频预览 */}

      {/* Section 3: 视频提示词 */}
      <section className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[length:0.95em] font-semibold">视频提示词</h3>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => onAutoTag(groupId)}
              disabled={autoTagPending || editingPrompt}
              className="rounded border border-[hsl(var(--color-border))] px-2 py-1 text-[length:0.78em] hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
            >
              {autoTagPending ? '标记中...' : '自动 @'}
            </button>
            {editingPrompt ? (
              <>
                <button
                  onClick={() => {
                    setDraftPrompt(normalizedGroupPrompt);
                    setEditingPrompt(false);
                  }}
                  className="rounded border border-[hsl(var(--color-border))] px-2 py-1 text-[length:0.78em] hover:bg-[hsl(var(--color-muted))]"
                >
                  取消
                </button>
                <button
                  onClick={savePrompt}
                  disabled={savePromptPending}
                  className="rounded bg-blue-600 px-2 py-1 text-[length:0.78em] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savePromptPending ? '保存中...' : '保存'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditingPrompt(true)}
                  className="rounded border border-[hsl(var(--color-border))] px-2 py-1 text-[length:0.78em] hover:bg-[hsl(var(--color-muted))]"
                >
                  编辑
                </button>
                {/* M6:AI 优化(LLM 按目标视频模型风格改写,@token 服务端保全校验) */}
                <button
                  onClick={() => optimizeMut.mutate({ groupId })}
                  disabled={optimizeMut.isPending}
                  className="rounded border border-[hsl(var(--color-border))] px-2 py-1 text-[length:0.78em] hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
                  title="用 LLM 优化本组提示词(写回后仍可手动编辑;需先在 /admin/bindings 配优化器模型)"
                >
                  {optimizeMut.isPending ? '✨ 优化中…' : '✨ AI 优化'}
                </button>
              </>
            )}
          </div>
        </div>
        {editingPrompt ? (
          <textarea
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            className="min-h-[12rem] w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-2 text-[length:0.85em] leading-relaxed outline-none focus:border-blue-500"
            placeholder="编辑提示词,保存会写入 PromptEdit 训练集"
          />
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] p-2 text-[length:0.85em] whitespace-pre-wrap leading-relaxed">
            {normalizedGroupPrompt || '(还没有 prompt — 去导演工作台生成)'}
          </div>
        )}
        {compiled &&
          (compiled.warnings.unknownTokens.length > 0 ||
            compiled.warnings.unusedReferences.length > 0 ||
            compiled.warnings.missingMedia.length > 0) && (
            <div className="mt-2 space-y-1 text-xs">
              {compiled.warnings.missingMedia.length > 0 && (
                <p className="text-red-600 dark:text-red-400">
                  ⛔ 缺主图(去美术工作台补图):
                  {compiled.warnings.missingMedia
                    .map(
                      (m) =>
                        `${m.assetName}(${m.kind === 'AUDIO' ? '音频' : '图片'}${m.refSlotIdx})`,
                    )
                    .join(', ')}
                </p>
              )}
              {compiled.warnings.unknownTokens.length > 0 && (
                <p className="text-amber-600 dark:text-amber-400">
                  ⚠️ 提示词里用了但未关联:{compiled.warnings.unknownTokens.join(', ')}
                </p>
              )}
              {compiled.warnings.unusedReferences.length > 0 && (
                <p className="text-[hsl(var(--color-muted-foreground))]">
                  ℹ️ 关联了但未在提示词中引用:slot{' '}
                  {compiled.warnings.unusedReferences.join(', ')}
                </p>
              )}
            </div>
          )}
        {/* 六八(关联即全喂):人物 形象/三视图/声线 自动附带提示(身份级,不依赖 @token) */}
        {compiled &&
          (compiled.voiceRefs.length > 0 ||
            compiled.voiceMissing.length > 0 ||
            compiled.characterImageRefs.length > 0) && (
            <div className="mt-2 space-y-1 text-xs">
              {compiled.characterImageRefs.length > 0 && (
                <p className="text-emerald-600 dark:text-emerald-400">
                  🖼 生成时自动附带人物图参考:
                  {Object.entries(
                    compiled.characterImageRefs.reduce<Record<string, string[]>>(
                      (acc, r) => {
                        (acc[r.name] ??= []).push(
                          r.kind === 'portrait' ? '形象' : '三视图',
                        );
                        return acc;
                      },
                      {},
                    ),
                  )
                    .map(([name, kinds]) => `${name}(${kinds.join('+')})`)
                    .join('、')}
                </p>
              )}
              {compiled.voiceRefs.length > 0 && (
                <p className="text-emerald-600 dark:text-emerald-400">
                  🔊 生成时自动附带参考声线:
                  {compiled.voiceRefs.map((v) => v.name).join('、')}
                </p>
              )}
              {compiled.voiceMissing.length > 0 && (
                <p className="text-amber-600 dark:text-amber-400">
                  ⚠️ 人物缺参考声线(去美术工坊生成,否则视频不带其声音参考):
                  {compiled.voiceMissing.map((v) => v.name).join('、')}
                </p>
              )}
            </div>
          )}
      </section>

      {/* Section 4: 视频预览(W5.4)*/}
      <section className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-3">
        <VideoPreviewSection
          groupId={groupId}
          onGenerate={(opts) => onGenerateVideo(groupId, opts)}
          generatePending={generateVideoPending}
          onReject={onRejectTake}
          rejectPending={rejectTakePending}
          autoSelectAttemptId={autoSelectAttemptId}
          onAutoSelectConsumed={onAutoSelectConsumed}
        />
      </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 资产卡片
// ---------------------------------------------------------------------------

interface BindingCardProps {
  binding: {
    id: string;
    usageType: string;
    refSlotIdx: number | null;
    kind: 'IMAGE' | 'AUDIO';
    mediaUrl: string | null;
    asset: { id: string; type: string; name: string; maturity: string };
    // 六八下:人物可投喂文件清单(有才显示;生成时全部自动作为参考送出)
    files?: { portrait: boolean; threeView: boolean; voice: boolean } | null;
  };
  onUnbind: () => void;
  unbindPending: boolean;
}

function BindingCard({
  binding,
  onUnbind,
  unbindPending,
}: BindingCardProps): React.ReactElement {
  const token =
    binding.refSlotIdx != null
      ? binding.kind === 'AUDIO'
        ? `@音频${binding.refSlotIdx}`
        : `@图片${binding.refSlotIdx}`
      : '(未编号)';

  return (
    <div className="group overflow-hidden rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]">
      <div className="relative aspect-square bg-[hsl(var(--color-muted))]">
        {binding.mediaUrl ? (
          binding.kind === 'AUDIO' ? (
            <div className="flex h-full items-center justify-center text-2xl">🔊</div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={binding.mediaUrl}
              alt={binding.asset.name}
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[hsl(var(--color-muted-foreground))]">
            {binding.kind === 'AUDIO' ? '无音频' : '无主图'}
          </div>
        )}
        <span className="absolute left-1 top-1 rounded bg-blue-500/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {token}
        </span>
        {/* W5 P2 a11y:opacity 替代 hidden,触屏 / 键盘可访问;hover/focus 时变红凸显 */}
        <button
          onClick={onUnbind}
          disabled={unbindPending}
          aria-label={`移除资产 ${binding.asset.name} 的关联`}
          title="移除关联"
          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/40 text-xs text-white opacity-60 transition-opacity hover:bg-red-600 hover:opacity-100 focus-visible:bg-red-600 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white group-hover:opacity-100 disabled:opacity-30"
        >
          ×
        </button>
      </div>
      <div className="p-2">
        <div className="truncate text-xs font-medium">{binding.asset.name}</div>
        <div className="mt-0.5 flex items-center justify-between text-[10px] text-[hsl(var(--color-muted-foreground))]">
          <span>{binding.asset.type}</span>
          <span>{binding.asset.maturity?.replace(/_.*/, '')}</span>
        </div>
        {/* 六八下(关联即全喂):人物可投喂文件 chips — 有的文件全部自动作为参考送给视频模型 */}
        {binding.files && (
          <div className="mt-1 flex flex-wrap gap-1">
            {binding.files.portrait && (
              <span
                title="形象图将自动作为图参考投喂"
                className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-medium text-emerald-600 dark:text-emerald-400"
              >
                🖼 形象
              </span>
            )}
            {binding.files.threeView && (
              <span
                title="三视图将自动作为图参考投喂"
                className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-medium text-emerald-600 dark:text-emerald-400"
              >
                🖼 三视图
              </span>
            )}
            {binding.files.voice && (
              <span
                title="参考声音将自动作为音频参考投喂"
                className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-medium text-emerald-600 dark:text-emerald-400"
              >
                🔊 声音
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 关键帧先行(M3a 六八)— 候选生成 / 确认首帧 / 尾帧链到下一组
// 自包含组件(模式同 VideoPreviewSection):自己拉数据,不经 workspace 回调。
// ---------------------------------------------------------------------------

function KeyframeSection({ groupId }: { groupId: string }): React.ReactElement {
  const utils = trpc.useUtils();
  const { data } = trpc.aigc.listKeyframes.useQuery({ groupId });
  const invalidate = (): void => {
    void utils.aigc.listKeyframes.invalidate({ groupId });
  };

  const genMut = trpc.aigc.generateKeyframe.useMutation({
    onSuccess: (r) => {
      toast.success(
        `关键帧生成完成 · ${r.mediaIds.length} 张候选 · ¥${r.cost.toFixed(4)}${r.refCount > 0 ? ` · 带 ${r.refCount} 张一致性参考` : ''}`,
      );
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const confirmMut = trpc.aigc.confirmKeyframe.useMutation({
    onSuccess: (r) => {
      toast.success(r.mediaId ? '已设为本组首帧(生成视频将作首帧约束)' : '已清除首帧');
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const chainMut = trpc.aigc.chainTailFrame.useMutation({
    onSuccess: (r) =>
      toast.success(`已抽本组尾帧 → 设为下一组 ${r.nextGroupNumber} 的首帧(场内链)`),
    onError: (e) => toast.error(e.message),
  });

  const confirmedId = data?.confirmedMediaId ?? null;
  const candidateIds = React.useMemo(() => {
    const ids: string[] = [];
    for (const a of data?.attempts ?? []) {
      for (const id of a.mediaIds) if (!ids.includes(id)) ids.push(id);
    }
    return ids.slice(0, 8);
  }, [data?.attempts]);

  return (
    <section className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[length:0.95em] font-semibold">关键帧</h3>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => genMut.mutate({ groupId })}
            disabled={genMut.isPending}
            title="用本组提示词出一张首帧候选(图片模型,~¥0.1 量级);自动带上一组已确认关键帧 + 绑定资产形象作一致性参考"
            className="rounded border border-[hsl(var(--color-border))] px-2 py-1 text-[length:0.78em] hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
          >
            {genMut.isPending ? '生成中...' : '生成关键帧'}
          </button>
          <button
            onClick={() => chainMut.mutate({ groupId })}
            disabled={chainMut.isPending}
            title="抽本组最新成功 take 的尾帧 → 设为下一组首帧(同场景才允许,切场自动拒绝)"
            className="rounded border border-[hsl(var(--color-border))] px-2 py-1 text-[length:0.78em] hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
          >
            {chainMut.isPending ? '链接中...' : '尾帧链下一组'}
          </button>
        </div>
      </div>

      {confirmedId && data?.urlMap[confirmedId] ? (
        <div className="mb-2">
          <div className="relative overflow-hidden rounded-md border-2 border-[hsl(var(--color-accent))]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.urlMap[confirmedId]}
              alt="已确认首帧"
              className="max-h-40 w-full object-cover"
            />
            <span className="absolute left-1 top-1 rounded bg-[hsl(var(--color-accent))] px-1.5 py-0.5 text-[10px] font-medium text-white">
              ✓ 首帧约束
            </span>
            <button
              onClick={() => confirmMut.mutate({ groupId, mediaId: null })}
              disabled={confirmMut.isPending}
              title="清除首帧约束"
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/40 text-xs text-white hover:bg-red-600"
            >
              ×
            </button>
          </div>
        </div>
      ) : (
        <p className="mb-2 text-[length:0.74em] leading-snug text-[hsl(var(--color-muted-foreground))]">
          还没有首帧。先出关键帧候选并确认,生成视频时会作为首帧约束(一致性先在图层收敛,再烧视频钱)。
        </p>
      )}

      {candidateIds.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {candidateIds.map((id) => {
            const url = data?.urlMap[id];
            const isConfirmed = id === confirmedId;
            return (
              <button
                key={id}
                onClick={() => !isConfirmed && confirmMut.mutate({ groupId, mediaId: id })}
                disabled={confirmMut.isPending || isConfirmed}
                title={isConfirmed ? '当前首帧' : '设为本组首帧'}
                className={
                  'relative aspect-[9/16] overflow-hidden rounded border ' +
                  (isConfirmed
                    ? 'border-[hsl(var(--color-accent))] opacity-60'
                    : 'border-[hsl(var(--color-border))] hover:border-[hsl(var(--color-accent))]')
                }
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="关键帧候选" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-[10px] text-[hsl(var(--color-muted-foreground))]">
                    加载中
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
