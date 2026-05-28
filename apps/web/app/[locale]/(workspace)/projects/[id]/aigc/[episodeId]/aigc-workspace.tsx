'use client';
import * as React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
// 三十三收工 R1 Phase A1:dialog / confirm 态聚合
import { useGenerationUI } from '@/lib/hooks/use-generation-ui';
// 三十五收工 R1 Phase B:子组件抽到独立文件
import { BindAssetDialog } from './components/bind-asset-dialog';
import { PromptDialog } from './components/prompt-dialog';
import { ConfirmDialog } from './components/confirm-dialog';
import { GroupDetail } from './components/group-detail';
import { type AspectRatio } from '@ss/shared/constants';

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
  const { data: groups, refetch: refetchGroups } =
    trpc.aigc.listGroups.useQuery({ episodeId });

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
      document.getElementById(`group-${id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
      // 同步 URL,refresh/分享也能定位
      const params = new URLSearchParams(window.location.search);
      params.set('g', id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
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

  // ---------- mutations ----------
  // onSuccess 通过 variables.groupId 拿 group(同页堆叠后没有"selected"概念)

  const autoMatchMutation = trpc.aigc.autoMatchAssets.useMutation({
    onSuccess: (data, variables) => {
      toast.success(`自动匹配:新增 ${data.created} 项,跳过 ${data.skipped} 项重复`);
      invalidateGroup(variables.groupId);
    },
    onError: (e) => toast.error(`自动匹配失败:${e.message}`),
  });

  const autoTagMutation = trpc.aigc.autoTagPrompt.useMutation({
    onSuccess: (data, variables) => {
      if (data.changed) toast.success('已在提示词中插入 @图片N / @音频N token');
      else toast.info('没有可插入的新 token(资产已全部标记)');
      invalidateGroup(variables.groupId);
    },
    onError: (e) => toast.error(`自动 @ 失败:${e.message}`),
  });

  const bindAssetMutation = trpc.aigc.bindAssetToGroup.useMutation({
    onSuccess: (_data, variables) => {
      toast.success('已关联资产');
      invalidateGroup(variables.groupId);
    },
    onError: (e) => toast.error(`关联失败:${e.message}`),
  });

  const unbindMutation = trpc.aigc.unbindAsset.useMutation({
    onSuccess: (data) => {
      toast.success('已移除资产');
      // 2026-05-27 audit r15:用 server 返的 shotGroupId 定向 invalidate,防跨 group 污染
      void utils.aigc.listGroups.invalidate({ episodeId });
      if (data?.shotGroupId) {
        void utils.aigc.getGroupDetail.invalidate({ groupId: data.shotGroupId });
        void utils.aigc.previewCompiledPrompt.invalidate({
          groupId: data.shotGroupId,
        });
        void utils.aigc.listAvailableAssets.invalidate({
          groupId: data.shotGroupId,
        });
      } else {
        void utils.aigc.getGroupDetail.invalidate();
        void utils.aigc.previewCompiledPrompt.invalidate();
        void utils.aigc.listAvailableAssets.invalidate();
      }
    },
    onError: (e) => toast.error(`移除失败:${e.message}`),
  });

  const updatePromptMutation = trpc.aigc.updateGroupPrompt.useMutation({
    onSuccess: (data, variables) => {
      if (data.changed) toast.success('提示词已保存(进训练集)');
      invalidateGroup(variables.groupId);
    },
    onError: (e) => toast.error(`保存失败:${e.message}`),
  });

  // 三十三收工 R1 Phase A1:4 dialog/confirm state 抽到 useGenerationUI hook
  // bindDialogGroupId / promptDialog / confirmDialog / autoSelect 全部 destructure
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

  const generateVideoMutation = trpc.aigc.generateVideo.useMutation({
    onSuccess: (data, variables) => {
      // W5.5:视频生成异步化(ADR-25),handler 入队后立即返回 attemptId(status=RUNNING)
      toast.success('视频任务已提交,等待生成完成');
      invalidateGroup(variables.groupId);
      setAutoSelect({ groupId: variables.groupId, attemptId: data.attemptId });
    },
    onError: (e) => {
      const msg = e.message ?? '';
      const isLong = msg.length > 40;
      toast.error(isLong ? '视频生成被拒' : `视频生成失败:${msg}`, {
        description: isLong ? msg : undefined,
        duration: isLong ? 8000 : 4000,
      });
    },
  });

  const rejectTakeMutation = trpc.aigc.rejectVideoTake.useMutation({
    onSuccess: (data) => {
      toast.success('已从历史中删除');
      // 2026-05-27 audit r14 P0:用 server 返的 shotGroupId 定向 invalidate
      // 防同页多 group 堆叠时全量 invalidate 触发跨 group cache 污染
      if (data.shotGroupId) {
        void utils.aigc.listVideoTakes.invalidate({ groupId: data.shotGroupId });
      } else {
        void utils.aigc.listVideoTakes.invalidate();
      }
    },
    onError: (e) => toast.error(`操作失败:${e.message}`),
  });

  const createGroupMutation = trpc.aigc.createEmptyGroup.useMutation({
    onSuccess: async (data) => {
      toast.success(`新建生成段:${data.number}`);
      await utils.aigc.listGroups.invalidate({ episodeId });
      // 等下一帧 DOM 渲染出新 group 再 scroll
      requestAnimationFrame(() => scrollToGroup(data.id));
    },
    onError: (e) => toast.error(`新建失败:${e.message}`),
  });
  const renameGroupMutation = trpc.aigc.renameGroup.useMutation({
    onSuccess: async (data, variables) => {
      toast.success(`已重命名为 "${data.number}"`);
      await utils.aigc.listGroups.invalidate({ episodeId });
      invalidateGroup(variables.groupId);
    },
    onError: (e) => toast.error(`重命名失败:${e.message}`),
  });
  const archiveGroupMutation = trpc.aigc.archiveGroup.useMutation({
    onSuccess: async () => {
      toast.success('已归档');
      await utils.aigc.listGroups.invalidate({ episodeId });
    },
    onError: (e) => toast.error(`归档失败:${e.message}`),
  });

  // bindDialogGroupId / promptDialog / confirmDialog 已抽到 useGenerationUI(三十三收工 R1 Phase A1)

  const onCreateGroup = (): void => {
    setPromptDialog({
      title: '新建生成段',
      description: '随便起名,后续可改。例:"陆乘·开场" / "梦境场景" / "B 卷备份"',
      defaultValue: '新片段',
      placeholder: '生成段名称',
      onConfirm: (label) => {
        if (!label.trim()) return;
        createGroupMutation.mutate({ episodeId, label: label.trim() });
      },
    });
  };

  const onRenameGroup = (g: { id: string; number: string }): void => {
    setPromptDialog({
      title: '重命名生成段',
      description: '"1-8" 只是 W3 默认,可改成任意有意义的名称',
      defaultValue: g.number,
      placeholder: '新名称',
      onConfirm: (label) => {
        if (!label.trim() || label.trim() === g.number) return;
        renameGroupMutation.mutate({ groupId: g.id, label: label.trim() });
      },
    });
  };

  const onArchiveGroup = (g: { id: string; number: string }): void => {
    setConfirmDialog({
      title: `归档生成段 "${g.number}"?`,
      description: '资产关联会一起归档;视频抽卡记录保留可查(listVideoTakes 仍能读)。归档后不可直接撤销,需 DB 操作恢复。',
      confirmLabel: '归档',
      danger: true,
      onConfirm: () => archiveGroupMutation.mutate({ groupId: g.id }),
    });
  };

  // ---------- group-scoped callbacks(GroupDetail 调用时传自己的 groupId) ----------

  const onAutoMatch = React.useCallback(
    (groupId: string) => autoMatchMutation.mutate({ groupId }),
    [autoMatchMutation],
  );

  const onAutoTag = React.useCallback(
    (groupId: string) => autoTagMutation.mutate({ groupId }),
    [autoTagMutation],
  );

  const onOpenBindDialog = React.useCallback(
    (groupId: string) => setBindDialogGroupId(groupId),
    [],
  );

  const onUnbind = React.useCallback(
    (bindingId: string) => unbindMutation.mutate({ bindingId }),
    [unbindMutation],
  );

  const onSavePrompt = React.useCallback(
    (groupId: string, prompt: string, diffNote?: string) => {
      updatePromptMutation.mutate({ groupId, prompt, diffNote });
    },
    [updatePromptMutation],
  );

  const onGenerateVideo = React.useCallback(
    (
      groupId: string,
      opts: {
        durationS?: number;
        aspectRatio?: AspectRatio;
        resolution?: '480p' | '720p' | '1080p';
        generateAudio?: boolean;
        providerOverride?: string;
      },
    ) => {
      generateVideoMutation.mutate({ groupId, ...opts });
    },
    [generateVideoMutation],
  );

  const onRejectTake = React.useCallback(
    (attemptId: string) => rejectTakeMutation.mutate({ attemptId }),
    [rejectTakeMutation],
  );

  const onAutoSelectConsumed = React.useCallback(() => {
    setAutoSelect(null);
  }, []);

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
                    {hasBadges && (
                      <span className="flex shrink-0 items-center gap-1">
                        {successCount > 0 && (
                          <span className="text-green-700 dark:text-green-400">
                            ✓{successCount}
                          </span>
                        )}
                        {failed > 0 && (
                          <span className="text-red-700 dark:text-red-400">
                            ✕{failed}
                          </span>
                        )}
                        {running > 0 && (
                          <span className="text-amber-700 dark:text-amber-400">
                            ⋯{running}
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
                    className="rounded px-1 py-0.5 hover:bg-black/10 focus-visible:bg-black/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-500 dark:hover:bg-white/10 dark:focus-visible:bg-white/10"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => onArchiveGroup(g)}
                    aria-label={`归档生成段 ${g.number}(软删,可在 DB 恢复)`}
                    title="归档(软删,可在 DB 恢复)"
                    className="rounded px-1 py-0.5 hover:bg-red-500/20 hover:text-red-500 focus-visible:bg-red-500/20 focus-visible:text-red-500 focus-visible:outline focus-visible:outline-1 focus-visible:outline-red-500"
                  >
                    🗄
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
        <div className="flex-1 overflow-y-auto p-4">
          {!groups ? (
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

