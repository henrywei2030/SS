'use client';
import * as React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';

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

  // W1-W5 audit P1 followup(R7):useMemo + useCallback 减少子组件不必要 re-render
  // 1235 行单组件渲染开销大,GroupDetail / BindAssetDialog 接受 N 个 callback,
  // parent 每次 re-render 都新建 inline arrow → 破坏后续 React.memo 优化。
  const gFromUrl = searchParams.get('g');
  const selectedGroupId = React.useMemo(
    () => gFromUrl ?? initialGroupId ?? groups?.[0]?.id,
    [gFromUrl, initialGroupId, groups],
  );

  const selectGroup = React.useCallback(
    (id: string): void => {
      const params = new URLSearchParams(window.location.search);
      params.set('g', id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  const invalidateGroup = React.useCallback(
    (groupId: string): void => {
      // W1-W5 audit 三轮 U1:补 listVideoTakes + listAvailableAssets,防陈旧数据
      utils.aigc.getGroupDetail.invalidate({ groupId });
      utils.aigc.previewCompiledPrompt.invalidate({ groupId });
      utils.aigc.listVideoTakes.invalidate({ groupId });
      utils.aigc.listAvailableAssets.invalidate({ groupId });
      void utils.aigc.listGroups.invalidate({ episodeId });
    },
    [utils, episodeId],
  );

  const autoMatchMutation = trpc.aigc.autoMatchAssets.useMutation({
    onSuccess: (data) => {
      toast.success(`自动匹配:新增 ${data.created} 项,跳过 ${data.skipped} 项重复`);
      if (selectedGroupId) invalidateGroup(selectedGroupId);
    },
    onError: (e) => toast.error(`自动匹配失败:${e.message}`),
  });

  const autoTagMutation = trpc.aigc.autoTagPrompt.useMutation({
    onSuccess: (data) => {
      if (data.changed) toast.success('已在提示词中插入 @图片N / @音频N token');
      else toast.info('没有可插入的新 token(资产已全部标记)');
      if (selectedGroupId) invalidateGroup(selectedGroupId);
    },
    onError: (e) => toast.error(`自动 @ 失败:${e.message}`),
  });

  const bindAssetMutation = trpc.aigc.bindAssetToGroup.useMutation({
    onSuccess: () => {
      toast.success('已关联资产');
      if (selectedGroupId) invalidateGroup(selectedGroupId);
    },
    onError: (e) => toast.error(`关联失败:${e.message}`),
  });

  const unbindMutation = trpc.aigc.unbindAsset.useMutation({
    onSuccess: () => {
      toast.success('已移除资产');
      if (selectedGroupId) invalidateGroup(selectedGroupId);
    },
    onError: (e) => toast.error(`移除失败:${e.message}`),
  });

  const updatePromptMutation = trpc.aigc.updateGroupPrompt.useMutation({
    onSuccess: (data) => {
      if (data.changed) toast.success('提示词已保存(进训练集)');
      if (selectedGroupId) invalidateGroup(selectedGroupId);
    },
    onError: (e) => toast.error(`保存失败:${e.message}`),
  });

  const [autoSelectAttemptId, setAutoSelectAttemptId] = React.useState<string | null>(
    null,
  );

  const generateVideoMutation = trpc.aigc.generateVideo.useMutation({
    onSuccess: (data) => {
      toast.success(`视频已生成(${data.providerId}, ${data.durationS}s)`);
      if (selectedGroupId) invalidateGroup(selectedGroupId);
      // W5 完善 U1:生成成功后 UI 自动切到新 take
      setAutoSelectAttemptId(data.attemptId);
    },
    onError: (e) => {
      // W1-W5 audit 三轮 T1:budget / lock 长消息用 description 拆,toast 标题简洁
      const msg = e.message ?? '';
      const isLong = msg.length > 40;
      toast.error(isLong ? '视频生成被拒' : `视频生成失败:${msg}`, {
        description: isLong ? msg : undefined,
        duration: isLong ? 8000 : 4000,
      });
    },
  });

  // group CRUD(W5 完善 G1)
  const createGroupMutation = trpc.aigc.createEmptyGroup.useMutation({
    // W1-W5 audit 三轮 U2:用 onSuccess 拿到 data.id,refetch 后 selectGroup 用 fresh 数据
    onSuccess: async (data) => {
      toast.success(`新建生成段:${data.number}`);
      await utils.aigc.listGroups.invalidate({ episodeId });
      selectGroup(data.id);
    },
    onError: (e) => toast.error(`新建失败:${e.message}`),
  });
  const renameGroupMutation = trpc.aigc.renameGroup.useMutation({
    onSuccess: async (data) => {
      toast.success(`已重命名为 "${data.number}"`);
      await utils.aigc.listGroups.invalidate({ episodeId });
      if (selectedGroupId) invalidateGroup(selectedGroupId);
    },
    onError: (e) => toast.error(`重命名失败:${e.message}`),
  });
  const archiveGroupMutation = trpc.aigc.archiveGroup.useMutation({
    onSuccess: async (data) => {
      toast.success('已归档');
      // W1-W5 audit 三轮 U2:await invalidate 后用 fresh 数据选下一个,
      // 避免用闭包里的旧 groups 选错
      await utils.aigc.listGroups.invalidate({ episodeId });
      const fresh = utils.aigc.listGroups.getData({ episodeId });
      const remaining = fresh?.filter((g) => g.id !== data.id) ?? [];
      if (remaining.length > 0) selectGroup(remaining[0]!.id);
    },
    onError: (e) => toast.error(`归档失败:${e.message}`),
  });

  // W5 P2:window.prompt / confirm → 内嵌 dialog
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

  const rejectTakeMutation = trpc.aigc.rejectVideoTake.useMutation({
    onSuccess: () => {
      toast.success('已标为废片');
      if (selectedGroupId) {
        utils.aigc.listVideoTakes.invalidate({ groupId: selectedGroupId });
      }
    },
    onError: (e) => toast.error(`操作失败:${e.message}`),
  });

  const [bindDialogOpen, setBindDialogOpen] = React.useState(false);

  // W5 P2:用受控 dialog 取代 window.prompt / window.confirm,符合 W4 三栏风格 + 移动友好
  const [promptDialog, setPromptDialog] = React.useState<{
    title: string;
    description?: string;
    defaultValue: string;
    placeholder?: string;
    onConfirm: (value: string) => void;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = React.useState<{
    title: string;
    description?: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  // W1-W5 audit P1 followup(R7):传给 GroupDetail 的 N 个 handler 全部 useCallback
  // 防 parent re-render 时 inline arrow 重建,破坏下游 React.memo
  const onAutoMatch = React.useCallback(() => {
    if (selectedGroupId) autoMatchMutation.mutate({ groupId: selectedGroupId });
  }, [autoMatchMutation, selectedGroupId]);

  const onAutoTag = React.useCallback(() => {
    if (selectedGroupId) autoTagMutation.mutate({ groupId: selectedGroupId });
  }, [autoTagMutation, selectedGroupId]);

  const onOpenBindDialog = React.useCallback(() => {
    setBindDialogOpen(true);
  }, []);

  const onUnbind = React.useCallback(
    (bindingId: string) => unbindMutation.mutate({ bindingId }),
    [unbindMutation],
  );

  const onSavePrompt = React.useCallback(
    (prompt: string, diffNote?: string) => {
      if (selectedGroupId)
        updatePromptMutation.mutate({ groupId: selectedGroupId, prompt, diffNote });
    },
    [updatePromptMutation, selectedGroupId],
  );

  const onGenerateVideo = React.useCallback(
    (opts: Parameters<typeof generateVideoMutation.mutate>[0] extends infer T
      ? T extends { groupId: string }
        ? Omit<T, 'groupId'>
        : never
      : never) => {
      if (selectedGroupId)
        generateVideoMutation.mutate({ groupId: selectedGroupId, ...opts });
    },
    [generateVideoMutation, selectedGroupId],
  );

  const onRejectTake = React.useCallback(
    (attemptId: string) => rejectTakeMutation.mutate({ attemptId }),
    [rejectTakeMutation],
  );

  const onAutoSelectConsumed = React.useCallback(() => {
    setAutoSelectAttemptId(null);
  }, []);

  return (
    <div className="grid h-[calc(100vh-2.75rem)] grid-cols-[280px_1fr] gap-0 bg-[hsl(var(--color-background))]">
      {/* 左:生成段列表 */}
      <aside className="overflow-y-auto border-r border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]">
        <div className="sticky top-0 z-10 border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-[hsl(var(--color-muted-foreground))]">
                AIGC 生成段
              </div>
              <div className="mt-1 text-sm font-medium">
                {groups?.length ?? 0} 段
              </div>
            </div>
            <button
              onClick={onCreateGroup}
              disabled={createGroupMutation.isPending}
              title="新建空白生成段(可重命名 / 自定义命名,如'陆乘·开场')"
              className="rounded-md border border-[hsl(var(--color-border))] px-2 py-1 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
            >
              + 新建
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1 p-2">
          {(groups ?? []).map((g) => {
            const isSelected = selectedGroupId === g.id;
            const successCount = g.videoTakes?.success ?? 0;
            return (
              <div
                key={g.id}
                className={`group rounded-md transition ${
                  isSelected
                    ? 'bg-[hsl(var(--color-accent))] text-[hsl(var(--color-accent-foreground))]'
                    : 'hover:bg-[hsl(var(--color-muted))]'
                }`}
              >
                <button
                  onClick={() => selectGroup(g.id)}
                  className="flex w-full flex-col items-start gap-1 px-3 py-2.5 text-left text-sm"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate font-medium">{g.number}</span>
                    <span className="shrink-0 text-xs opacity-60">
                      {g.shotCount} 镜
                    </span>
                  </div>
                  <div className="flex w-full items-center justify-between text-xs opacity-70">
                    <span>资产 {g.bindingCount}</span>
                    <span>{g.durationS.toFixed(1)}s</span>
                  </div>
                  {/* W7 audit R9:解构出 vt 用 ?? 0 安全访问,消除 g.videoTakes! 非空断言 */}
                  {(() => {
                    const vt = g.videoTakes;
                    const failed = vt?.failed ?? 0;
                    const running = vt?.running ?? 0;
                    if (successCount === 0 && failed === 0 && running === 0) return null;
                    return (
                      <div className="flex w-full items-center gap-2 text-[10px]">
                        {successCount > 0 && (
                          <span className="rounded bg-green-600/20 px-1.5 py-0.5 text-green-700 dark:text-green-400">
                            ✓ {successCount}
                          </span>
                        )}
                        {failed > 0 && (
                          <span className="rounded bg-red-600/20 px-1.5 py-0.5 text-red-700 dark:text-red-400">
                            ✕ {failed}
                          </span>
                        )}
                        {running > 0 && (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">
                            ⋯ {running}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </button>
                {/* W5 P2 a11y:opacity 替代 hidden,触屏 / 键盘 / focus 都能访问;hover/focus-within 时全显 */}
                <div
                  className={`flex justify-end gap-1 px-2 pb-1.5 text-[10px] transition-opacity ${
                    isSelected
                      ? 'opacity-100'
                      : 'opacity-40 group-hover:opacity-100 group-focus-within:opacity-100'
                  }`}
                >
                  <button
                    onClick={() => onRenameGroup(g)}
                    aria-label={`重命名生成段 ${g.number}`}
                    title="重命名"
                    className="rounded px-1.5 py-0.5 hover:bg-black/10 focus-visible:bg-black/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-500 dark:hover:bg-white/10 dark:focus-visible:bg-white/10"
                  >
                    ✎ 重命名
                  </button>
                  <button
                    onClick={() => onArchiveGroup(g)}
                    aria-label={`归档生成段 ${g.number}(软删,可在 DB 恢复)`}
                    title="归档(软删,可在 DB 恢复)"
                    className="rounded px-1.5 py-0.5 hover:bg-red-500/20 hover:text-red-500 focus-visible:bg-red-500/20 focus-visible:text-red-500 focus-visible:outline focus-visible:outline-1 focus-visible:outline-red-500"
                  >
                    🗄 归档
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

      {/* 右:详情面板 */}
      <main className="overflow-y-auto p-6">
        {selectedGroupId ? (
          <GroupDetail
            groupId={selectedGroupId}
            onAutoMatch={onAutoMatch}
            autoMatchPending={autoMatchMutation.isPending}
            onAutoTag={onAutoTag}
            autoTagPending={autoTagMutation.isPending}
            onOpenBindDialog={onOpenBindDialog}
            onUnbind={onUnbind}
            unbindPending={unbindMutation.isPending}
            onSavePrompt={onSavePrompt}
            savePromptPending={updatePromptMutation.isPending}
            onGenerateVideo={onGenerateVideo}
            generateVideoPending={generateVideoMutation.isPending}
            onRejectTake={onRejectTake}
            rejectTakePending={rejectTakeMutation.isPending}
            autoSelectAttemptId={autoSelectAttemptId}
            onAutoSelectConsumed={onAutoSelectConsumed}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--color-muted-foreground))]">
            选择左侧一个生成段开始
          </div>
        )}
      </main>

      {bindDialogOpen && selectedGroupId && (
        <BindAssetDialog
          groupId={selectedGroupId}
          locale={locale}
          projectId={projectId}
          onClose={() => setBindDialogOpen(false)}
          onBind={(assetId, usageType) => {
            bindAssetMutation.mutate({ groupId: selectedGroupId, assetId, usageType });
            setBindDialogOpen(false);
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
  onAutoMatch: () => void;
  autoMatchPending: boolean;
  onAutoTag: () => void;
  autoTagPending: boolean;
  onOpenBindDialog: () => void;
  onUnbind: (bindingId: string) => void;
  unbindPending: boolean;
  onSavePrompt: (prompt: string, diffNote?: string) => void;
  savePromptPending: boolean;
  onGenerateVideo: (opts: {
    durationS?: number;
    aspectRatio?: '9:16' | '16:9' | '1:1';
  }) => void;
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
  // W1-W5 audit 三轮 U3:加 savePromptPending 守卫,防 mutation 异步期间 useEffect
  // 用旧 data.group.prompt 覆盖用户刚输入的草稿(原 bug:保存后草稿闪一下变回旧值)
  React.useEffect(() => {
    if (data && !editingPrompt && !savePromptPending) {
      setDraftPrompt(data.group.prompt);
    }
  }, [data, editingPrompt, savePromptPending]);

  if (isLoading || !data) {
    return (
      <div className="text-sm text-[hsl(var(--color-muted-foreground))]">
        加载中...
      </div>
    );
  }

  const { group, shots, bindings } = data;

  const savePrompt = (): void => {
    if (draftPrompt.trim() === group.prompt.trim()) {
      setEditingPrompt(false);
      return;
    }
    onSavePrompt(draftPrompt);
    setEditingPrompt(false);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部 group 信息 */}
      <header className="flex items-center justify-between border-b border-[hsl(var(--color-border))] pb-3">
        <div>
          <h2 className="text-lg font-semibold">{group.number}</h2>
          <div className="mt-0.5 text-xs text-[hsl(var(--color-muted-foreground))]">
            {shots.length} 个镜头 · {group.durationS.toFixed(1)}s · {group.status}
          </div>
        </div>
        <div className="text-xs text-[hsl(var(--color-muted-foreground))]">
          group #{group.positionIdx}
        </div>
      </header>

      {/* Section 1: 资产关联 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">资产关联</h3>
          <div className="flex gap-2">
            <button
              onClick={onAutoMatch}
              disabled={autoMatchPending}
              className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
            >
              {autoMatchPending ? '匹配中...' : '自动匹配'}
            </button>
            <button
              onClick={onOpenBindDialog}
              className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))]"
            >
              关联素材
            </button>
            <button
              disabled
              title="W5.2.1.1:上传素材到项目库 — 暂走 /art 工作台手动上传"
              className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs opacity-40"
            >
              上传素材
            </button>
          </div>
        </div>
        {bindings.length === 0 ? (
          <p className="text-xs text-[hsl(var(--color-muted-foreground))]">
            还没有关联资产 — 点"自动匹配"或"关联素材"
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
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

      {/* Section 2: 原始剧本(只读) */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">原始剧本</h3>
        <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))] p-3 text-xs whitespace-pre-wrap leading-relaxed">
          {shots.length === 0
            ? '(无 shot)'
            : shots
                .map(
                  (s) =>
                    `${s.scene?.number ?? '?'} ${s.scene?.location ?? ''}\n${s.content || s.prompt}`,
                )
                .join('\n\n')}
        </div>
      </section>

      {/* Section 3: 视频提示词 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">视频提示词</h3>
          <div className="flex gap-2">
            <button
              onClick={onAutoTag}
              disabled={autoTagPending || editingPrompt}
              className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
            >
              {autoTagPending ? '标记中...' : '自动 @'}
            </button>
            {editingPrompt ? (
              <>
                <button
                  onClick={() => {
                    setDraftPrompt(group.prompt);
                    setEditingPrompt(false);
                  }}
                  className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))]"
                >
                  取消
                </button>
                <button
                  onClick={savePrompt}
                  disabled={savePromptPending}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savePromptPending ? '保存中...' : '保存'}
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditingPrompt(true)}
                className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))]"
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
            className="h-48 w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-3 text-xs leading-relaxed font-mono outline-none focus:border-blue-500"
            placeholder="编辑提示词,保存会写入 PromptEdit 训练集"
          />
        ) : (
          <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-3 text-xs whitespace-pre-wrap leading-relaxed font-mono">
            {group.prompt || '(还没有 prompt — 去导演工作台生成)'}
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
      <VideoPreviewSection
        groupId={groupId}
        onGenerate={onGenerateVideo}
        generatePending={generateVideoPending}
        onReject={onRejectTake}
        rejectPending={rejectTakePending}
        autoSelectAttemptId={autoSelectAttemptId}
        onAutoSelectConsumed={onAutoSelectConsumed}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 视频预览区(W5.4)
// ---------------------------------------------------------------------------

interface VideoPreviewProps {
  groupId: string;
  onGenerate: (opts: {
    durationS?: number;
    aspectRatio?: '9:16' | '16:9' | '1:1';
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
  const { data: takes, isLoading } = trpc.aigc.listVideoTakes.useQuery({ groupId });
  const [selectedTakeId, setSelectedTakeId] = React.useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = React.useState<'9:16' | '16:9' | '1:1'>('9:16');
  const [durationS, setDurationS] = React.useState<number>(5);

  // 默认选中最新成功的 take
  React.useEffect(() => {
    if (!takes || selectedTakeId) return;
    const firstSuccess = takes.find((t) => t.status === 'SUCCESS' && t.videoUrl);
    if (firstSuccess) setSelectedTakeId(firstSuccess.id);
  }, [takes, selectedTakeId]);

  // W5 完善 U1:外部触发自动切到新生成的 take(generateVideo onSuccess)
  React.useEffect(() => {
    if (!autoSelectAttemptId || !takes) return;
    const exists = takes.find((t) => t.id === autoSelectAttemptId);
    if (exists) {
      setSelectedTakeId(autoSelectAttemptId);
      onAutoSelectConsumed();
    }
  }, [autoSelectAttemptId, takes, onAutoSelectConsumed]);

  const selectedTake = takes?.find((t) => t.id === selectedTakeId);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">视频预览</h3>
        <div className="flex items-center gap-2">
          <select
            value={aspectRatio}
            onChange={(e) =>
              setAspectRatio(e.target.value as '9:16' | '16:9' | '1:1')
            }
            className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
          >
            <option value="9:16">9:16 竖屏</option>
            <option value="16:9">16:9 横屏</option>
            <option value="1:1">1:1 方形</option>
          </select>
          <select
            value={durationS}
            onChange={(e) => setDurationS(Number(e.target.value))}
            className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
          >
            <option value={3}>3s</option>
            <option value={5}>5s</option>
            <option value={8}>8s</option>
            <option value={10}>10s</option>
          </select>
          <button
            onClick={() => onGenerate({ aspectRatio, durationS })}
            disabled={generatePending}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {generatePending ? '生成中...' : '生成视频'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[280px_1fr] gap-4">
        {/* 左:主预览 */}
        <div>
          {selectedTake && selectedTake.videoUrl ? (
            <div
              className={`relative overflow-hidden rounded-md border border-[hsl(var(--color-border))] bg-black ${
                selectedTake.aspectRatio === '16:9'
                  ? 'aspect-video'
                  : selectedTake.aspectRatio === '1:1'
                    ? 'aspect-square'
                    : 'aspect-[9/16]'
              }`}
            >
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                key={selectedTake.id}
                src={selectedTake.videoUrl}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full object-contain"
              />
              {selectedTake.rejected && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-medium text-red-400">
                  已标废片
                </div>
              )}
            </div>
          ) : (
            <div className="flex aspect-[9/16] items-center justify-center rounded-md border border-dashed border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))] text-xs text-[hsl(var(--color-muted-foreground))]">
              {isLoading
                ? '加载中...'
                : '还没有视频 — 点右上"生成视频"开始抽卡'}
            </div>
          )}
          {selectedTake && (
            <div className="mt-2 space-y-1 text-xs text-[hsl(var(--color-muted-foreground))]">
              <div className="flex items-center justify-between">
                <span>provider: {selectedTake.providerId}</span>
                {selectedTake.status === 'SUCCESS' && !selectedTake.rejected && (
                  <button
                    onClick={() => onReject(selectedTake.id)}
                    disabled={rejectPending}
                    className="rounded-md border border-[hsl(var(--color-border))] px-2 py-0.5 text-[10px] hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                    title="标为废片(不会删除文件)"
                  >
                    标废片
                  </button>
                )}
              </div>
              <div>
                {new Date(selectedTake.createdAt).toLocaleString('zh-CN')}
                {selectedTake.durationMs &&
                  ` · 耗时 ${Math.round(selectedTake.durationMs / 100) / 10}s`}
                {' · '}
                {Number(selectedTake.costCny ?? 0).toFixed(2)} ¥
              </div>
            </div>
          )}
        </div>

        {/* 右:历史记录列表 */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-[hsl(var(--color-muted-foreground))]">
            历史记录({takes?.length ?? 0})
          </div>
          {takes && takes.length > 0 ? (
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {takes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => t.videoUrl && setSelectedTakeId(t.id)}
                  disabled={!t.videoUrl}
                  className={`flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-xs ${
                    selectedTakeId === t.id
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-muted))]'
                  } ${t.rejected ? 'opacity-50' : ''} ${!t.videoUrl ? 'cursor-not-allowed' : ''}`}
                >
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded text-[10px] font-medium ${
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
                        : '...'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {t.providerId}
                      {t.rejected && ' · 废片'}
                    </div>
                    <div className="truncate text-[10px] text-[hsl(var(--color-muted-foreground))]">
                      {new Date(t.createdAt).toLocaleTimeString('zh-CN')}
                      {' · '}
                      {Number(t.costCny ?? 0).toFixed(2)}¥
                      {t.errorMsg && ` · ${t.errorMsg.slice(0, 30)}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-[hsl(var(--color-border))] p-4 text-center text-xs text-[hsl(var(--color-muted-foreground))]">
              还没有抽卡记录
            </div>
          )}
        </div>
      </div>
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
