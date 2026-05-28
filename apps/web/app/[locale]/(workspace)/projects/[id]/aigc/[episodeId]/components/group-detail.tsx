'use client';
import * as React from 'react';

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
      {/* Section 1: 资产关联 */}
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
              <button
                onClick={() => setEditingPrompt(true)}
                className="rounded border border-[hsl(var(--color-border))] px-2 py-1 text-[length:0.78em] hover:bg-[hsl(var(--color-muted))]"
              >
                编辑
              </button>
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
      </div>
    </div>
  );
}
