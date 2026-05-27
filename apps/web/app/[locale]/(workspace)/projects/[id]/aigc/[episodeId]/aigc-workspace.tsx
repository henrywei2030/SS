'use client';
import * as React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Download, History, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { useAigcProgress, type AigcProgressState } from '@/lib/hooks/use-aigc-progress';
// 三十三收工 R1 Phase A1:dialog / confirm 态聚合
import { useGenerationUI } from '@/lib/hooks/use-generation-ui';
// 三十三收工 R1 Phase A2:video 派生 state + 跟随 capabilities effects
import { useVideoSettings } from '@/lib/hooks/use-video-settings';
import { ASPECT_RATIOS, type AspectRatio } from '@ss/shared/constants';
import { normalizePrompt } from '@ss/shared';

// 用户反馈 2026-05-27:6 个画面比例的中文标签 + Tailwind aspect class 映射
// 横屏(16:9 / 21:9)走 aspect-video / aspect-[21/9];竖屏(9:16 / 3:4)走对应比例 class
const ASPECT_LABEL: Record<AspectRatio, string> = {
  '16:9': '16:9 横屏',
  '4:3': '4:3 标清',
  '1:1': '1:1 方形',
  '3:4': '3:4 竖向',
  '9:16': '9:16 竖屏',
  '21:9': '21:9 宽银幕',
};
const ASPECT_CLASS: Record<AspectRatio, string> = {
  '16:9': 'aspect-video',
  '4:3': 'aspect-[4/3]',
  '1:1': 'aspect-square',
  '3:4': 'aspect-[3/4]',
  '9:16': 'aspect-[9/16]',
  '21:9': 'aspect-[21/9]',
};

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

// ---------------------------------------------------------------------------
// 受控 dialog 组件(W5 P2:取代 window.prompt / window.confirm)
// ---------------------------------------------------------------------------

interface PromptDialogProps {
  title: string;
  description?: string;
  defaultValue: string;
  placeholder?: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
}

function PromptDialog({
  title,
  description,
  defaultValue,
  placeholder,
  onClose,
  onConfirm,
}: PromptDialogProps): React.ReactElement {
  const [value, setValue] = React.useState(defaultValue);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // 空值不触发(与"确定"按钮 disabled 一致),否则 dialog 关闭但啥都没干,体验误导
      if (value.trim()) onConfirm(value);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-dialog-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-[hsl(var(--color-card))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-[hsl(var(--color-border))] px-5 py-3">
          <h3 id="prompt-dialog-title" className="text-sm font-semibold">
            {title}
          </h3>
          {description && (
            <p className="mt-1 text-xs text-[hsl(var(--color-muted-foreground))]">
              {description}
            </p>
          )}
        </header>
        <div className="p-5">
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={100}
            aria-label={title}
            className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
        <footer className="flex justify-end gap-2 border-t border-[hsl(var(--color-border))] px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))]"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(value)}
            disabled={!value.trim()}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            确定
          </button>
        </footer>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({
  title,
  description,
  confirmLabel = '确定',
  danger,
  onClose,
  onConfirm,
}: ConfirmDialogProps): React.ReactElement {
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-full max-w-md rounded-lg bg-[hsl(var(--color-card))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-[hsl(var(--color-border))] px-5 py-3">
          <h3 id="confirm-dialog-title" className="text-sm font-semibold">
            {title}
          </h3>
          {description && (
            <p className="mt-1 text-xs text-[hsl(var(--color-muted-foreground))]">
              {description}
            </p>
          )}
        </header>
        <footer className="flex justify-end gap-2 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))]"
          >
            取消
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-xs font-medium text-white ${
              danger
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 右侧详情:4 个 section
// ---------------------------------------------------------------------------

interface DetailProps {
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

function GroupDetail({
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
// 视频预览区(W5.4 + W5.5.1 扩展选项)
// ---------------------------------------------------------------------------

// ToggleRow 已删除(高级选项 details 移除,音频 toggle 改 toolbar inline checkbox)

interface VideoPreviewProps {
  groupId: string;
  onGenerate: (opts: {
    durationS?: number;
    aspectRatio?: AspectRatio;
    // W5.5.1 扩展
    resolution?: '480p' | '720p' | '1080p';
    generateAudio?: boolean;
    // 2026-05-27:用户在视频预览选了非 binding 默认的 provider 时传过来
    providerOverride?: string;
  }) => void;
  generatePending: boolean;
  onReject: (attemptId: string) => void;
  rejectPending: boolean;
  autoSelectAttemptId: string | null;
  onAutoSelectConsumed: () => void;
}

function VideoPreviewSection({
  groupId,
  onGenerate,
  generatePending,
  onReject,
  rejectPending,
  autoSelectAttemptId,
  onAutoSelectConsumed,
}: VideoPreviewProps): React.ReactElement {
  const { data: takes, isLoading } = trpc.aigc.listVideoTakes.useQuery(
    { groupId },
    {
      // 2026-05-27 audit r15:列表含 RUNNING/QUEUED take 时自动 polling 等终态
      // 防 worker 升 SUCCESS 但 SSE invalidate 失败 / 用户重新打开页面时显陈旧 RUNNING
      refetchInterval: (query) => {
        const data = query.state.data;
        const hasInflight = data?.some(
          (t) => t.status === 'RUNNING' || t.status === 'QUEUED',
        );
        return hasInflight ? 5_000 : false;
      },
    },
  );
  const [selectedTakeId, setSelectedTakeId] = React.useState<string | null>(null);
  // 2026-05-27 用户反馈:历史改主预览下方常驻列表,点条目自动播放
  // r14 P1:requestAnimationFrame 不够稳(video src 切换是异步,可能 play 旧 src);
  // 改用 pendingPlay state + onLoadedMetadata 回调,等元数据加载完再 play
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [pendingPlayId, setPendingPlayId] = React.useState<string | null>(null);
  const handleSelectHistoryTake = React.useCallback((takeId: string) => {
    setSelectedTakeId(takeId);
    setPendingPlayId(takeId); // 标记需要播,onLoadedMetadata 回调消费
  }, []);
  // 三十三收工 R1 Phase A2:4 个 video setting state + 4 effect 抽到 useVideoSettings
  // selectedProviderId 留主组件管理(capabilities query input,避免循环依赖)
  const [selectedProviderId, setSelectedProviderId] = React.useState<string | null>(null);
  const { data: videoProviders } = trpc.aigc.listVideoProviders.useQuery();

  // W5.5 D6:Provider 能力查询 — providerId 传 selectedProviderId(null 时 server 走 binding)
  // 2026-05-27:error 时 UI 显红色 banner,引导用户切换或去 /admin/providers 配置
  const { data: capabilities, error: capabilitiesError } =
    trpc.aigc.getProviderCapabilities.useQuery({
      providerId: selectedProviderId ?? undefined,
    });
  // W5.5 D6:group.durationS 作为智能默认(按分镜复杂度,1 个 shot 6s / 3 个 shots 15s 等)
  const { data: groupDetail } = trpc.aigc.getGroupDetail.useQuery({ groupId });

  // 2026-05-27 audit r15 用户反馈:下载文件名规则化
  //   {项目名}-Ep{集号}-{分镜组号}-第{N}次-{时间}.mp4
  // takes 数组 server desc 排序,seq = takes.length - index(老的小 seq,新的大 seq)
  const buildDownloadFilename = React.useCallback(
    (takeId: string, createdAt: Date | string): string => {
      const sanitize = (s: string) =>
        s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled';
      const time = new Date(createdAt);
      const pad = (n: number) => String(n).padStart(2, '0');
      const ts = `${time.getFullYear()}${pad(time.getMonth() + 1)}${pad(time.getDate())}-${pad(time.getHours())}${pad(time.getMinutes())}`;
      const projectName = sanitize(groupDetail?.project?.name ?? '项目');
      const epNum = groupDetail?.episode?.number ?? '';
      const epPart = epNum ? `Ep${epNum}` : 'Ep';
      const grpNum = sanitize(groupDetail?.group?.number ?? groupId.slice(0, 6));
      const idx = takes?.findIndex((t) => t.id === takeId) ?? -1;
      const total = takes?.length ?? 0;
      const seq = idx >= 0 ? total - idx : 1; // 老的 seq 小,新的 seq 大
      return `${projectName}-${epPart}-${grpNum}-第${seq}次-${ts}.mp4`;
    },
    [groupDetail, takes, groupId],
  );
  // W5.5 D5:SSE 实时进度(对当前正在跑的 attempt 订阅)
  const progress = useAigcProgress(autoSelectAttemptId);
  const utils = trpc.useUtils();

  // 三十三收工 R1 Phase A2:4 个跟随 capabilities effect 抽到 useVideoSettings hook
  const {
    aspectRatio,
    setAspectRatio,
    durationS,
    setDurationS,
    resolution,
    setResolution,
    generateAudio,
    setGenerateAudio,
  } = useVideoSettings({ capabilities, groupDetail });

  // W5.5 D5:终态后 invalidate listVideoTakes + 当前 episode 的 listGroups
  // 2026-05-27 audit r12 P1:listGroups invalidate 限定 episodeId(从 groupDetail 取),防跨 episode cache 污染
  React.useEffect(() => {
    if (progress.kind === 'success' || progress.kind === 'failed') {
      void utils.aigc.listVideoTakes.invalidate({ groupId });
      const episodeId = groupDetail?.group.episodeId;
      if (episodeId) {
        void utils.aigc.listGroups.invalidate({ episodeId });
      } else {
        // 兜底:groupDetail 还未加载就走 fail/success(极少见)
        void utils.aigc.listGroups.invalidate();
      }
    }
  }, [progress.kind, groupId, utils, groupDetail]);

  // 2026-05-27 用户反馈:rejected take 视为"已删除",列表 + 主预览候选都 filter 掉
  const visibleTakes = React.useMemo(
    () => (takes ?? []).filter((t) => !t.rejected),
    [takes],
  );

  // 2026-05-27 用户反馈:动态进度条 — 基于 RUNNING take.createdAt + 预期时长估算
  // 真 SSE percent 优先,没有用时间估算(Seedance 2.0 fast ≈ 3min, std ≈ 6min)
  const inflightTake = React.useMemo(
    () =>
      visibleTakes.find(
        (t) => t.status === 'RUNNING' || t.status === 'QUEUED',
      ),
    [visibleTakes],
  );
  // 二十九收工 S1:1s timer 抽到 <InflightProgressPanel> 子组件,
  // 父组件不再因 nowTick state 全量 re-render(原 1949 行组件每秒刷新)
  // expected duration:2.0 fast 3 分钟 / 2.0 std 6 分钟(从 capabilities.providerId 区分)
  const expectedMs = (capabilities?.providerId ?? '').includes('fast')
    ? 3 * 60_000
    : 6 * 60_000;

  // 默认选中最新 take(无论 status — FAILED/RUNNING 也显,让用户看错误 / 进度)
  // 用户删了当前 selectedTake 后自动重选 latest
  // 2026-05-27 用户反馈:之前 firstSuccess 优先 → 失败时主预览空白不知所措,改 latest
  React.useEffect(() => {
    if (!takes) return;
    const currentValid =
      selectedTakeId && visibleTakes.some((t) => t.id === selectedTakeId);
    if (currentValid) return;
    // takes server desc 排序,visibleTakes[0] = latest
    setSelectedTakeId(visibleTakes[0]?.id ?? null);
  }, [takes, visibleTakes, selectedTakeId]);

  // W5 完善 U1:外部触发自动切到新生成的 take(generateVideo onSuccess)
  React.useEffect(() => {
    if (!autoSelectAttemptId || !takes) return;
    const exists = takes.find((t) => t.id === autoSelectAttemptId);
    if (exists) {
      setSelectedTakeId(autoSelectAttemptId);
      onAutoSelectConsumed();
    }
  }, [autoSelectAttemptId, takes, onAutoSelectConsumed]);

  const selectedTake = visibleTakes.find((t) => t.id === selectedTakeId);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          视频预览
          {capabilities?.isMock && (
            <span className="ml-1 rounded bg-amber-500/15 px-1 text-[10px] font-normal text-amber-700 dark:text-amber-400">
              MOCK
            </span>
          )}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {/* 用户反馈 2026-05-27:模型下拉 — 默认 binding 配置的(由 server 返回 providerId 决定),
           *  用户可切其他 active video provider · 切换后 capabilities refetch + generate 传 providerOverride */}
          <select
            value={selectedProviderId ?? capabilities?.providerId ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              // 切回 binding 默认:选择跟 capabilities.providerId 一样时清空 override
              setSelectedProviderId(
                v && v !== capabilities?.providerId ? v : null,
              );
            }}
            disabled={!videoProviders || videoProviders.length === 0}
            className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
            title="选择视频生成模型(默认用后台 binding 设定的)"
          >
            {videoProviders && videoProviders.length > 0 ? (
              videoProviders.map((p) => (
                <option key={p.providerId} value={p.providerId}>
                  {p.displayName}
                </option>
              ))
            ) : (
              <option value="">加载中...</option>
            )}
          </select>
          {/* W5.5 D7:aspectRatio 按 Provider 支持的渲染(用户反馈 2026-05-27 扩 6 选项) */}
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
            className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
          >
            {(capabilities?.supportedAspectRatios ?? ASPECT_RATIOS).map((r) => (
              <option key={r} value={r}>
                {ASPECT_LABEL[r as AspectRatio] ?? r}
              </option>
            ))}
          </select>
          {/* W5.5 D6:durationS 按 Provider maxDuration 动态渲染 1-N 秒 */}
          <select
            value={durationS}
            onChange={(e) => setDurationS(Number(e.target.value))}
            className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
            title={
              capabilities
                ? `${capabilities.displayName} 支持 ${capabilities.minDurationS}-${capabilities.maxDurationS} s`
                : '加载 Provider 能力中...'
            }
          >
            {(() => {
              if (!capabilities) {
                return [3, 5, 8, 10].map((s) => (
                  <option key={s} value={s}>{s} s</option>
                ));
              }
              const opts: number[] = [];
              for (let s = capabilities.minDurationS; s <= capabilities.maxDurationS; s++) {
                opts.push(s);
              }
              return opts.map((s) => (
                <option key={s} value={s}>{s} s</option>
              ));
            })()}
          </select>
          {/* 2026-05-27 用户反馈:删高级选项 details,分辨率 + 同步音频 直接平铺到 toolbar */}
          <select
            value={resolution}
            onChange={(e) =>
              setResolution(e.target.value as '480p' | '720p' | '1080p')
            }
            disabled={!capabilities}
            title="视频分辨率(Seedance 2.0 仅 480p/720p)"
            className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
          >
            {(capabilities?.supportedResolutions ?? ['480p', '720p', '1080p']).map(
              (r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ),
            )}
          </select>
          {capabilities?.supportsAudio && (
            <label
              className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
              title="生成同步音频(Seedance 2.0 真支持)"
            >
              <input
                type="checkbox"
                checked={generateAudio}
                onChange={(e) => setGenerateAudio(e.target.checked)}
                className="size-3 cursor-pointer accent-blue-600"
              />
              <span>音频</span>
            </label>
          )}
          <button
            onClick={() =>
              onGenerate({
                aspectRatio,
                durationS,
                // Provider 不支持的选项不传(router 透传给 worker → provider)
                resolution: capabilities?.supportedResolutions.includes(resolution)
                  ? resolution
                  : undefined,
                generateAudio: capabilities?.supportsAudio ? generateAudio : undefined,
                // 2026-05-27:用户改了 provider 下拉时传 override(空 = 用 binding 默认)
                providerOverride: selectedProviderId ?? undefined,
              })
            }
            disabled={
              generatePending ||
              progress.kind === 'connecting' ||
              progress.kind === 'running' ||
              progress.kind === 'progress' ||
              // 2026-05-27 audit r12 P1:capabilities 错误时禁点(否则会跑去 generate 失败误导用户)
              !!capabilitiesError ||
              !capabilities
            }
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            title={
              capabilitiesError
                ? `当前 Provider 不可用:${capabilitiesError.message}`
                : !capabilities
                  ? '加载 Provider 能力中...'
                  : undefined
            }
          >
            {generatePending
              ? '提交中...'
              : progress.kind === 'connecting'
                ? '连接中...'
                : progress.kind === 'running' || progress.kind === 'progress'
                  ? '生成中...'
                  : capabilitiesError
                    ? 'Provider 不可用'
                    : '生成视频'}
          </button>
        </div>
      </div>


      {/* 2026-05-27:capabilities query 失败 → 红色 banner 引导用户切换 / 去后台配置 */}
      {capabilitiesError && (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <div className="flex items-center gap-2">
            <span>⛔</span>
            <span className="font-medium">当前 Provider 不可用</span>
          </div>
          <div className="mt-1 break-words">{capabilitiesError.message}</div>
          <div className="mt-1 text-[10px] opacity-70">
            上方切换其他 Provider,或去 /admin/providers 检查模型激活状态 + token 配置
          </div>
        </div>
      )}

      {/* 2026-05-27 audit r12 P1:Mock fallback 时显式告诉用户原因 — 防止假装跑了真 Provider */}
      {capabilities?.isMock && capabilities.fallbackReason !== 'explicit_mock' && (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span className="font-medium">
              当前 Provider 未真实接入 — 生成的是占位样片(非真实视频)
            </span>
          </div>
          <div className="mt-1 break-words">
            {capabilities.fallbackReason === 'no_provider_config' &&
              `ProviderConfig 不存在 — 去 /admin/providers 添加 "${capabilities.displayName}"`}
            {capabilities.fallbackReason === 'provider_inactive' &&
              `Provider "${capabilities.displayName}" 已停用 — 去 /admin/providers 启用`}
            {capabilities.fallbackReason === 'adapter_route_failed' &&
              `Provider "${capabilities.displayName}" 已配置但 adapter 不识别 / token 缺失 — 去 /admin/providers 检查 token,确认 modelId 含 "seedance" 等已知适配器关键字`}
          </div>
        </div>
      )}

      {/* 2026-05-27 用户反馈:动态进度条 — SSE percent 优先,fallback 时间估算
       *  二十九收工 S1:整段抽到 <InflightProgressPanel> 子组件,
       *  timer 在子组件内跑,父组件 1949 行不再每秒 re-render */}
      {(inflightTake ||
        progress.kind === 'connecting' ||
        progress.kind === 'running' ||
        progress.kind === 'progress') && (
        <InflightProgressPanel
          startedAt={inflightTake ? new Date(inflightTake.createdAt) : null}
          expectedMs={expectedMs}
          providerDisplayName={capabilities?.displayName ?? 'provider'}
          progress={progress}
        />
      )}
      {progress.kind === 'failed' && (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          ⛔ 生成失败:{progress.errorMsg}
          {progress.retryable && (
            <span className="ml-2 text-[hsl(var(--color-muted-foreground))]">(可重试)</span>
          )}
        </div>
      )}

      {/* 主预览 — 用户反馈 2026-05-27:单列只显当前 take(默认 latest SUCCESS),
       *  历史进 dialog 看 + 下载小按钮 inline */}
      <div>
        {selectedTake && selectedTake.videoUrl ? (
          <div
            className={`relative overflow-hidden rounded-md border border-[hsl(var(--color-border))] bg-black ${
              ASPECT_CLASS[selectedTake.aspectRatio as AspectRatio] ??
              'aspect-[9/16]'
            }`}
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              key={selectedTake.id}
              src={selectedTake.videoUrl}
              controls
              playsInline
              preload="metadata"
              className="h-full w-full object-contain"
              onLoadedMetadata={(e) => {
                // 2026-05-27 audit r14 P1:metadata 加载完才能可靠 play(防 src 切换中断)
                if (pendingPlayId && pendingPlayId === selectedTake.id) {
                  e.currentTarget.play().catch((err) => {
                    console.debug('[VideoPreview] auto-play 被浏览器拒', err);
                  });
                  setPendingPlayId(null);
                }
              }}
            />
            {/* 删除"已标废片" overlay — 用户反馈 2026-05-27:rejected take 视为已删除,
             *  visibleTakes 已 filter,selectedTake 永不会含 rejected */}
          </div>
        ) : (
          // 2026-05-27 用户反馈:placeholder 区分 FAILED/RUNNING/empty 显具体原因
          <div
            className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-4 text-center text-xs ${
              ASPECT_CLASS[aspectRatio] ?? 'aspect-[9/16]'
            } ${
              selectedTake?.status === 'FAILED'
                ? 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300'
                : selectedTake?.status === 'RUNNING' ||
                    selectedTake?.status === 'QUEUED'
                  ? 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300'
                  : 'border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))] text-[hsl(var(--color-muted-foreground))]'
            }`}
          >
            {isLoading ? (
              <span>加载中...</span>
            ) : selectedTake?.status === 'FAILED' ? (
              <>
                <span className="text-lg">❌</span>
                <span className="font-medium">生成失败</span>
                <div className="max-h-32 max-w-full overflow-y-auto break-words text-[10px] leading-relaxed opacity-90">
                  {selectedTake.errorMsg ?? '(无具体原因 — 见管理后台 /admin/api-usage 复盘)'}
                </div>
                <div className="text-[10px] opacity-60">
                  可点上方"生成视频"重试,或调整提示词避开版权 / 敏感词
                </div>
              </>
            ) : selectedTake?.status === 'RUNNING' ||
              selectedTake?.status === 'QUEUED' ? (
              <>
                <span className="inline-block size-3 animate-pulse rounded-full bg-amber-500" />
                <span className="font-medium">生成中...</span>
                <span className="text-[10px] opacity-70">
                  Seedance 2.0 Fast 约 3-4 分钟,系统每 5 秒自动刷新状态
                </span>
              </>
            ) : (
              <span>还没有视频 — 点右上"生成视频"开始抽卡</span>
            )}
          </div>
        )}

        {/* info bar:左 meta + 右 actions(下载 / 历史 / 标废片) */}
        <div className="mt-2 flex items-start justify-between gap-2 text-[length:0.78em] text-[hsl(var(--color-muted-foreground))]">
          <div className="min-w-0 flex-1">
            {selectedTake ? (
              <>
                <div className="truncate">{selectedTake.providerId}</div>
                <div className="truncate text-[length:0.7em]">
                  {new Date(selectedTake.createdAt).toLocaleString()}
                  {selectedTake.durationMs &&
                    ` · 耗时 ${Math.round(selectedTake.durationMs / 100) / 10} s`}
                  {' · '}
                  {Number(selectedTake.costCny ?? 0).toFixed(2)} ¥
                </div>
              </>
            ) : (
              <span>
                {takes && takes.length > 0
                  ? '从历史中选择查看'
                  : '暂无视频'}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {selectedTake?.videoUrl && (
              <a
                href={selectedTake.videoUrl}
                download={buildDownloadFilename(selectedTake.id, selectedTake.createdAt)}
                title="下载视频"
                aria-label="下载视频"
                className="inline-flex h-7 items-center justify-center rounded-md border border-[hsl(var(--color-border))] px-2 hover:bg-[hsl(var(--color-muted))]"
              >
                <Download className="size-3.5" />
              </a>
            )}
            {selectedTake && (
              <button
                onClick={() => {
                  // 2026-05-27 用户反馈:删除 = 软删(rejected=true)前端 filter,DB 保审计
                  if (
                    window.confirm(
                      '确定从历史中删除这次视频抽卡?\n(DB 保留审计记录,前端不再显示)',
                    )
                  ) {
                    onReject(selectedTake.id);
                  }
                }}
                disabled={rejectPending}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-[hsl(var(--color-border))] px-2 hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                title="从历史中删除(DB 保审计,前端隐藏)"
              >
                <Trash2 className="size-3.5" />
                删除
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2026-05-27 用户反馈:历史常驻列表(不再 dialog),点条目自动播放;rejected take filter 掉(视为删除) */}
      {visibleTakes.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-[hsl(var(--color-muted-foreground))]">
            <span>
              <History className="mr-1 inline size-3" />
              历史 {visibleTakes.length}
            </span>
          </div>
          <div className="max-h-[40vh] space-y-1.5 overflow-y-auto pr-1">
            {visibleTakes.map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                  selectedTakeId === t.id
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-[hsl(var(--color-border))]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!t.videoUrl) return;
                    handleSelectHistoryTake(t.id);
                  }}
                  disabled={!t.videoUrl}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
                  title={
                    t.videoUrl
                      ? '点击切到主预览并自动播放'
                      : t.status === 'FAILED'
                        ? `失败:${t.errorMsg ?? '无 video URL'}`
                        : '生成中,稍候'
                  }
                >
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded text-[10px] font-medium ${
                      t.status === 'SUCCESS'
                        ? 'bg-green-600/20 text-green-700 dark:text-green-400'
                        : t.status === 'FAILED'
                          ? 'bg-red-600/20 text-red-700 dark:text-red-400'
                          : 'bg-amber-500/20 text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {t.status === 'SUCCESS'
                      ? '✓'
                      : t.status === 'FAILED'
                        ? '✕'
                        : '⋯'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[length:0.78em] font-medium">
                      {new Date(t.createdAt).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                      {Number(t.costCny ?? 0).toFixed(2)}¥
                      {t.durationMs &&
                        ` · 耗时 ${Math.round(t.durationMs / 100) / 10} s`}
                    </div>
                    {/* 2026-05-27 用户反馈:errorMsg 完整显(不再 slice),失败原因可见 */}
                    {t.errorMsg && (
                      <div className="mt-0.5 break-words text-[10px] leading-tight text-red-700 dark:text-red-400">
                        ❌ {t.errorMsg}
                      </div>
                    )}
                  </div>
                </button>
                {t.videoUrl && (
                  <a
                    href={t.videoUrl}
                    download={buildDownloadFilename(t.id, t.createdAt)}
                    title="下载此条视频"
                    aria-label="下载视频"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-muted))]"
                  >
                    <Download className="size-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        '确定从历史中删除这次抽卡?\n(DB 保留审计记录,前端不再显示)',
                      )
                    ) {
                      onReject(t.id);
                    }
                  }}
                  disabled={rejectPending}
                  title="从历史删除(DB 保审计)"
                  aria-label="删除"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-[hsl(var(--color-border))] hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
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

// ---------------------------------------------------------------------------
// 关联资产 Dialog(W5.2.1)
// ---------------------------------------------------------------------------

interface BindDialogProps {
  groupId: string;
  locale: string;
  projectId: string;
  onClose: () => void;
  onBind: (
    assetId: string,
    usageType?:
      | 'APPEAR'
      | 'SPEAK'
      | 'HOLD'
      | 'WEAR'
      | 'ENVIRONMENT'
      | 'BACKGROUND'
      | 'SOUND_BG'
      | 'SOUND_VOICE'
      | 'THEME'
      | 'REFERENCE',
  ) => void;
}

function BindAssetDialog({
  groupId,
  locale,
  projectId,
  onClose,
  onBind,
}: BindDialogProps): React.ReactElement {
  const [typeFilter, setTypeFilter] = React.useState<
    'ALL' | 'CHARACTER' | 'SCENE' | 'PROP'
  >('ALL');
  const { data: assets, isLoading } = trpc.aigc.listAvailableAssets.useQuery({
    groupId,
    type: typeFilter === 'ALL' ? undefined : typeFilter,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-[hsl(var(--color-card))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-5 py-3">
          <h3 className="text-sm font-semibold">关联素材到本生成段</h3>
          <button
            onClick={onClose}
            className="text-sm text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))]"
          >
            ✕
          </button>
        </header>
        <div className="flex gap-2 border-b border-[hsl(var(--color-border))] px-5 py-2">
          {(['ALL', 'CHARACTER', 'SCENE', 'PROP'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-md px-3 py-1 text-xs ${
                typeFilter === t
                  ? 'bg-[hsl(var(--color-accent))] text-[hsl(var(--color-accent-foreground))]'
                  : 'hover:bg-[hsl(var(--color-muted))]'
              }`}
            >
              {t === 'ALL' ? '全部' : t === 'CHARACTER' ? '人物' : t === 'SCENE' ? '场景' : '道具'}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="text-sm text-[hsl(var(--color-muted-foreground))]">加载中...</div>
          ) : assets && assets.length > 0 ? (
            <div className="grid grid-cols-3 gap-3 md:grid-cols-4 lg:grid-cols-5">
              {assets.map((a) => (
                <button
                  key={a.id}
                  disabled={a.alreadyBound}
                  onClick={() => onBind(a.id)}
                  className={`group flex flex-col overflow-hidden rounded-md border border-[hsl(var(--color-border))] text-left transition ${
                    a.alreadyBound
                      ? 'opacity-40'
                      : 'hover:border-blue-500'
                  }`}
                  title={
                    a.alreadyBound ? '已关联到本生成段' : `点击关联 — ${a.description ?? ''}`
                  }
                >
                  <div className="relative aspect-square bg-[hsl(var(--color-muted))]">
                    {a.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.thumbnailUrl}
                        alt={a.name}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-[hsl(var(--color-muted-foreground))]">
                        无图
                      </div>
                    )}
                    {a.alreadyBound && (
                      <span className="absolute right-1 top-1 rounded bg-green-600/90 px-1.5 py-0.5 text-[10px] text-white">
                        已关联
                      </span>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="truncate text-xs font-medium">{a.name}</div>
                    <div className="mt-0.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                      {a.type} · {a.maturity?.replace(/_.*/, '')}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-[hsl(var(--color-muted-foreground))]">
              本项目没有可用资产 — 去{' '}
              <a className="underline" href={`/${locale}/projects/${projectId}/art`}>
                美术工作台
              </a>{' '}
              创建
            </div>
          )}
        </div>
        <footer className="border-t border-[hsl(var(--color-border))] px-5 py-2 text-xs text-[hsl(var(--color-muted-foreground))]">
          usageType 自动按 asset.type 推导(CHARACTER→APPEAR / SCENE→ENVIRONMENT / PROP→APPEAR)。
          需要别的(SPEAK/HOLD/SOUND_VOICE 等)请用 API 或下版本 UI。
        </footer>
      </div>
    </div>
  );
}

// ============================================================================
// 二十九收工 S1:Inflight 进度面板 — timer 隔离子组件
//
// 原本父组件 AigcWorkspace(1900+ 行)直接持 nowTick state,
// 每秒 setInterval → 整个组件 re-render → 拖慢 video preview / 子组件 memoization
//
// 抽到这里后,timer 在子组件内独立跑,父组件不动。
// startedAt=null 时(SSE 已 connecting 但 attempt 还没出现)不跑 timer,只显文字
// ============================================================================
function InflightProgressPanel({
  startedAt,
  expectedMs,
  providerDisplayName,
  progress,
}: {
  startedAt: Date | null;
  expectedMs: number;
  providerDisplayName: string;
  progress: AigcProgressState;
}): React.ReactElement {
  const [nowTick, setNowTick] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const elapsedMs = startedAt ? nowTick - startedAt.getTime() : 0;
  const estimatedPercent = startedAt
    ? Math.min(95, Math.round((elapsedMs / expectedMs) * 100))
    : 0;
  const displayPercent =
    progress.kind === 'progress' && progress.percent ? progress.percent : estimatedPercent;
  const progressMessage =
    progress.kind === 'progress' && progress.message ? progress.message : null;

  return (
    <div className="mb-3 rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-blue-700 dark:text-blue-300">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="inline-block size-2 animate-pulse rounded-full bg-blue-500" />
          <span className="font-medium">
            {progress.kind === 'connecting' ? '建立连接中...' : '视频生成中'}
          </span>
        </span>
        {startedAt && (
          <span className="font-mono tabular-nums opacity-80">
            {Math.round(elapsedMs / 1000)} s · {displayPercent}%
          </span>
        )}
      </div>
      {startedAt && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-500/15">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-1000 ease-linear"
            style={{ width: `${displayPercent}%` }}
          />
        </div>
      )}
      <div className="mt-1.5 text-[10px] opacity-70">
        {providerDisplayName} · 预计 {Math.round(expectedMs / 60_000)} 分钟 · 系统每 5 秒自动刷新状态
        {progressMessage && ` · ${progressMessage}`}
      </div>
    </div>
  );
}
