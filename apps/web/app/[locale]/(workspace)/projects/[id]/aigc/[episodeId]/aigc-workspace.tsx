'use client';
import * as React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Archive, Check, Loader2, Pencil, X } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
// 三十三收工 R1 Phase A1:dialog / confirm 态聚合
import { useGenerationUI } from '@/lib/hooks/use-generation-ui';
// 三十六收工 R1 收尾:10 mutation + 11 callback/opener 聚合
import { useAigcMutations } from '@/lib/hooks/use-aigc-mutations';
// 三十五收工 R1 Phase B:子组件抽到独立文件
import { BindAssetDialog } from './components/bind-asset-dialog';
import { PromptDialog } from './components/prompt-dialog';
import { ConfirmDialog } from './components/confirm-dialog';
import { GroupDetail } from './components/group-detail';
// M1 成片:工作台「成片」tab(?tab=renders)
import { RenderPanel } from './components/render-panel';
// F4(M4):整集批量生成工具条(估算→确认→入队 + 总进度 + 取消排队)
import { BatchToolbar } from './components/batch-toolbar';
// 三十六收工 UX 改造:全局返回按钮
import { BackButton } from '@/components/ui/back-button';

interface Props {
  projectId: string;
  episodeId: string;
  initialGroupId?: string;
  locale?: string;
}

export function AigcWorkspace({
  projectId,
  episodeId,
  initialGroupId,
  locale = 'zh',
}: Props): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const utils = trpc.useUtils();
  // F4 批量:有组在跑时 5s 轮询(总进度横幅 + 组卡状态跟进;无任务零开销)
  const { data: groups } = trpc.aigc.listGroups.useQuery(
    { episodeId },
    {
      refetchInterval: (query) =>
        query.state.data?.some((g) => g.videoTakes.running > 0) ? 5_000 : false,
    },
  );

  // M1 成片 tab:?tab=renders(默认 groups)— 对齐 storyboard 的 URL tab 约定
  const tab = searchParams.get('tab') === 'renders' ? 'renders' : 'groups';
  const setTab = React.useCallback(
    (next: 'groups' | 'renders'): void => {
      const params = new URLSearchParams(window.location.search);
      if (next === 'groups') params.delete('tab');
      else params.set('tab', next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  // 用户反馈 r8:不再切换"选中 group",所有 group 在主区垂直堆叠同时显示
  // ?g=xxx URL 参数仅作初始 scroll 锚点(进入页面后定位到指定 group)
  const gFromUrl = searchParams.get('g');
  const initialScrollGroupId = gFromUrl ?? initialGroupId;
  const [hasInitiallyScrolled, setHasInitiallyScrolled] = React.useState(false);
  React.useEffect(() => {
    if (hasInitiallyScrolled || !groups || groups.length === 0) return;
    if (!initialScrollGroupId) {
      setHasInitiallyScrolled(true);
      return;
    }
    const target = groups.find((g) => g.id === initialScrollGroupId);
    if (!target) {
      setHasInitiallyScrolled(true);
      return;
    }
    // 等下一帧 DOM render 完
    requestAnimationFrame(() => {
      document.getElementById(`group-${initialScrollGroupId}`)?.scrollIntoView({
        behavior: 'auto',
        block: 'start',
      });
      setHasInitiallyScrolled(true);
    });
  }, [groups, initialScrollGroupId, hasInitiallyScrolled]);

  const scrollToGroup = React.useCallback(
    (id: string): void => {
      // 在成片 tab 时点左栏段导航 → 先切回生成段视图再滚动(等下一帧 DOM 出来)
      const params = new URLSearchParams(window.location.search);
      const onRendersTab = params.get('tab') === 'renders';
      params.delete('tab');
      params.set('g', id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      const doScroll = (): void => {
        document.getElementById(`group-${id}`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      };
      if (onRendersTab) requestAnimationFrame(() => requestAnimationFrame(doScroll));
      else doScroll();
    },
    [router, pathname],
  );

  const invalidateGroup = React.useCallback(
    (groupId: string): void => {
      utils.aigc.getGroupDetail.invalidate({ groupId });
      utils.aigc.previewCompiledPrompt.invalidate({ groupId });
      utils.aigc.listVideoTakes.invalidate({ groupId });
      utils.aigc.listAvailableAssets.invalidate({ groupId });
      void utils.aigc.listGroups.invalidate({ episodeId });
    },
    [utils, episodeId],
  );

  // 三十三收工 R1 Phase A1:4 dialog/confirm state 聚合
  const {
    bindDialogGroupId,
    setBindDialogGroupId,
    promptDialog,
    setPromptDialog,
    confirmDialog,
    setConfirmDialog,
    autoSelect,
    setAutoSelect,
  } = useGenerationUI();

  // 三十六收工 R1 收尾:10 mutation + 11 callback/opener 全部聚合
  const {
    autoMatchMutation,
    autoTagMutation,
    bindAssetMutation,
    unbindMutation,
    updatePromptMutation,
    generateVideoMutation,
    rejectTakeMutation,
    createGroupMutation,
    onAutoMatch,
    onAutoTag,
    onOpenBindDialog,
    onUnbind,
    onSavePrompt,
    onGenerateVideo,
    onRejectTake,
    onAutoSelectConsumed,
    onCreateGroup,
    onRenameGroup,
    onArchiveGroup,
  } = useAigcMutations({
    episodeId,
    invalidateGroup,
    scrollToGroup,
    setBindDialogGroupId,
    setAutoSelect,
    setPromptDialog,
    setConfirmDialog,
  });

  // 用户反馈 r6:字号跟分镜界面联动 — 沿用 --storyboard-fs(分镜顶栏 A- 13 A+ 控制)
  // localStorage key 同源 'storyboard.fontSize',跨页持久 + 跨工作台一致
  const [fontSize, setFontSize] = React.useState<number>(15);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = Number(window.localStorage.getItem('storyboard.fontSize'));
    if (stored >= 11 && stored <= 18) setFontSize(stored);
  }, []);
  const FONT_SIZES = [11, 12, 13, 14, 15, 16, 17, 18] as const;
  const changeFontSize = (delta: 1 | -1): void => {
    const idx = FONT_SIZES.indexOf(fontSize as (typeof FONT_SIZES)[number]);
    const next = FONT_SIZES[Math.max(0, Math.min(FONT_SIZES.length - 1, idx + delta))]!;
    setFontSize(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('storyboard.fontSize', String(next));
    }
  };

  return (
    <div
      className="grid h-[calc(100vh-2.75rem)] grid-cols-[192px_1fr] gap-0 bg-[hsl(var(--color-background))]"
      style={{ ['--storyboard-fs' as string]: `${fontSize}px`, fontSize: `${fontSize}px` }}
    >
      {/* 左:生成段 quick nav — 紧凑模式(2026-05-27 用户反馈)
       *   栏宽 220→192px / 每行 py-1.5 / 段号+镜·时长一行 / 资产+badges 一行 / hover icon-only */}
      <aside className="overflow-y-auto border-r border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]">
        <div className="sticky top-0 z-10 border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2.5 py-1.5">
          {/* 三十六收工 UX 改造:加返回 AIGC 集数总览按钮 */}
          <div className="mb-1.5">
            <BackButton
              href={`/${locale}/projects/${projectId}/aigc`}
              label="返回集数总览"
              className="text-[10px]"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                AIGC 生成段
              </div>
              <div className="text-xs font-medium">
                {groups?.length ?? 0} 段 · 点击跳转
              </div>
            </div>
            <button
              onClick={onCreateGroup}
              disabled={createGroupMutation.isPending}
              title="新建空白生成段(可重命名 / 自定义命名,如'陆乘·开场')"
              className="shrink-0 rounded-md border border-[hsl(var(--color-border))] px-1.5 py-0.5 text-[10px] hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
            >
              + 新建
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-0.5 p-1.5">
          {(groups ?? []).map((g) => {
            const successCount = g.videoTakes?.success ?? 0;
            const vt = g.videoTakes;
            const failed = vt?.failed ?? 0;
            const running = vt?.running ?? 0;
            const hasBadges = successCount > 0 || failed > 0 || running > 0;
            return (
              <div
                key={g.id}
                className="group rounded-md transition hover:bg-[hsl(var(--color-muted))]"
              >
                <button
                  onClick={() => scrollToGroup(g.id)}
                  className="flex w-full flex-col items-start gap-0 px-2 py-1.5 text-left text-xs"
                >
                  {/* 行 1:段号 + (镜·时长) — 合并原来的两行省垂直空间 */}
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate font-medium">{g.number}</span>
                    <span className="shrink-0 text-[10px] opacity-60">
                      {g.shotCount} 镜 · {g.durationS.toFixed(1)} s
                    </span>
                  </div>
                  {/* 行 2:资产数 + badges 内联 — 仅有 badges 或 binding 时显 */}
                  <div className="flex w-full items-center justify-between text-[10px] opacity-70">
                    <span>资产 {g.bindingCount}</span>
                    {/* 七二 UI-P0(docs/08 §1-2):✓1✕1⋯ 符号串 → 可读 mini-chip(lucide 图标+数字+tooltip) */}
                    {hasBadges && (
                      <span className="flex shrink-0 items-center gap-1">
                        {successCount > 0 && (
                          <span
                            title={`成功 ${successCount} 条`}
                            className="flex items-center gap-0.5 rounded bg-[hsl(var(--color-success-bg))] px-1 py-px text-[hsl(var(--color-success))]"
                          >
                            <Check className="size-2.5" />
                            {successCount}
                          </span>
                        )}
                        {failed > 0 && (
                          <span
                            title={`失败 ${failed} 条`}
                            className="flex items-center gap-0.5 rounded bg-[hsl(var(--color-danger-bg))] px-1 py-px text-[hsl(var(--color-danger))]"
                          >
                            <X className="size-2.5" />
                            {failed}
                          </span>
                        )}
                        {running > 0 && (
                          <span
                            title={`生成中 ${running} 条`}
                            className="flex items-center gap-0.5 rounded bg-[hsl(var(--color-warning-bg))] px-1 py-px text-[hsl(var(--color-warning))]"
                          >
                            <Loader2 className="size-2.5 animate-spin" />
                            {running}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </button>
                {/* hover 显 actions — icon-only 节省横向空间 */}
                <div className="flex justify-end gap-0.5 px-1.5 pb-1 text-[10px] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    onClick={() => onRenameGroup(g)}
                    aria-label={`重命名生成段 ${g.number}`}
                    title="重命名"
                    className="rounded px-1 py-0.5 hover:bg-black/10 focus-visible:bg-black/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[hsl(var(--color-info))] dark:hover:bg-white/10 dark:focus-visible:bg-white/10"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    onClick={() => onArchiveGroup(g)}
                    aria-label={`归档生成段 ${g.number}(软删,可在 DB 恢复)`}
                    title="归档(软删,可在 DB 恢复)"
                    className="rounded px-1 py-0.5 hover:bg-[hsl(var(--color-danger)/0.2)] hover:text-[hsl(var(--color-danger))] focus-visible:bg-[hsl(var(--color-danger)/0.2)] focus-visible:text-[hsl(var(--color-danger))] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[hsl(var(--color-danger))]"
                  >
                    <Archive className="size-3" />
                  </button>
                </div>
              </div>
            );
          })}
          {groups && groups.length === 0 && (
            <div className="p-4 text-center text-sm text-[hsl(var(--color-muted-foreground))]">
              本集还没有生成段
              <br />
              先去导演工作台生成分镜,或点上方"+ 新建"
            </div>
          )}
        </div>
      </aside>

      {/* 右:详情面板 — 用户反馈 r6:参考分镜布局,加顶栏 toolbar + 主体横向 4 列 */}
      <main className="flex h-full flex-col overflow-hidden">
        {/* 顶栏 toolbar — 参考截图右上 A- 13 A+ 字号控制 */}
        <div className="sticky top-0 z-10 flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-4">
          <div className="flex items-center gap-3 text-[length:0.85em] text-[hsl(var(--color-muted-foreground))]">
            {/* M1:生成段 / 成片 视图切换 */}
            <div className="flex items-center rounded border border-[hsl(var(--color-border))] p-0.5">
              <button
                type="button"
                onClick={() => setTab('groups')}
                className={
                  tab === 'groups'
                    ? 'rounded bg-[hsl(var(--color-secondary))] px-2 py-0.5 text-[hsl(var(--color-foreground))]'
                    : 'rounded px-2 py-0.5 hover:text-[hsl(var(--color-foreground))]'
                }
              >
                生成段
              </button>
              <button
                type="button"
                onClick={() => setTab('renders')}
                className={
                  tab === 'renders'
                    ? 'rounded bg-[hsl(var(--color-secondary))] px-2 py-0.5 text-[hsl(var(--color-foreground))]'
                    : 'rounded px-2 py-0.5 hover:text-[hsl(var(--color-foreground))]'
                }
              >
                成片
              </button>
            </div>
            <span>共 <span className="text-[hsl(var(--color-foreground))] font-medium">{groups?.length ?? 0}</span> 段</span>
            {groups && groups.length > 0 && (
              <>
                <span className="text-[hsl(var(--color-border))]">·</span>
                <span>
                  镜头 <span className="text-[hsl(var(--color-foreground))] font-medium">
                    {groups.reduce((a, g) => a + g.shotCount, 0)}
                  </span>
                </span>
                <span className="text-[hsl(var(--color-border))]">·</span>
                <span>
                  时长 <span className="text-[hsl(var(--color-foreground))] font-medium">
                    {groups.reduce((a, g) => a + g.durationS, 0).toFixed(1)} s
                  </span>
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* F4:批量生成工具条(估算→成本确认→按优先级入队 + 进行中横幅 + 取消排队) */}
            {tab === 'groups' && (
              <BatchToolbar
                episodeId={episodeId}
                groups={groups}
                onAfterChange={() => {
                  void utils.aigc.listGroups.invalidate({ episodeId });
                  void utils.aigc.listVideoTakes.invalidate();
                }}
              />
            )}
            {/* 字号控制器(跟分镜共享 --storyboard-fs · localStorage 同 key) */}
            <div className="flex items-center gap-0.5 rounded border border-[hsl(var(--color-border))] px-1 py-0.5">
              <button
                type="button"
                onClick={() => changeFontSize(-1)}
                disabled={fontSize <= 11}
                className="rounded px-1.5 py-0.5 text-[10px] hover:bg-[hsl(var(--color-muted))] disabled:cursor-not-allowed disabled:opacity-30"
                title="字号减小"
                aria-label="字号减小"
              >
                A-
              </button>
              <span className="w-6 text-center font-mono text-[10px]">{fontSize}</span>
              <button
                type="button"
                onClick={() => changeFontSize(1)}
                disabled={fontSize >= 18}
                className="rounded px-1.5 py-0.5 text-[10px] hover:bg-[hsl(var(--color-muted))] disabled:cursor-not-allowed disabled:opacity-30"
                title="字号增大"
                aria-label="字号增大"
              >
                A+
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'renders' ? (
            <RenderPanel projectId={projectId} episodeId={episodeId} />
          ) : !groups ? (
            <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--color-muted-foreground))]">
              加载中...
            </div>
          ) : groups.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--color-muted-foreground))]">
              本集还没有生成段 — 先去导演工作台生成分镜,或点左上"+ 新建"
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((g) => (
                <GroupDetail
                  key={g.id}
                  groupId={g.id}
                  onAutoMatch={onAutoMatch}
                  autoMatchPending={
                    autoMatchMutation.isPending &&
                    autoMatchMutation.variables?.groupId === g.id
                  }
                  onAutoTag={onAutoTag}
                  autoTagPending={
                    autoTagMutation.isPending &&
                    autoTagMutation.variables?.groupId === g.id
                  }
                  onOpenBindDialog={onOpenBindDialog}
                  onUnbind={onUnbind}
                  unbindPending={unbindMutation.isPending}
                  onSavePrompt={onSavePrompt}
                  savePromptPending={
                    updatePromptMutation.isPending &&
                    updatePromptMutation.variables?.groupId === g.id
                  }
                  onGenerateVideo={onGenerateVideo}
                  generateVideoPending={
                    generateVideoMutation.isPending &&
                    generateVideoMutation.variables?.groupId === g.id
                  }
                  onRejectTake={onRejectTake}
                  rejectTakePending={rejectTakeMutation.isPending}
                  autoSelectAttemptId={
                    autoSelect?.groupId === g.id ? autoSelect.attemptId : null
                  }
                  onAutoSelectConsumed={onAutoSelectConsumed}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {bindDialogGroupId && (
        <BindAssetDialog
          groupId={bindDialogGroupId}
          locale={locale}
          projectId={projectId}
          onClose={() => setBindDialogGroupId(null)}
          onBind={(assetId, usageType) => {
            bindAssetMutation.mutate({
              groupId: bindDialogGroupId,
              assetId,
              usageType,
            });
            setBindDialogGroupId(null);
          }}
        />
      )}

      {promptDialog && (
        <PromptDialog
          title={promptDialog.title}
          description={promptDialog.description}
          defaultValue={promptDialog.defaultValue}
          placeholder={promptDialog.placeholder}
          onClose={() => setPromptDialog(null)}
          onConfirm={(value) => {
            promptDialog.onConfirm(value);
            setPromptDialog(null);
          }}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          danger={confirmDialog.danger}
          onClose={() => setConfirmDialog(null)}
          onConfirm={() => {
            confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
        />
      )}
    </div>
  );
}

