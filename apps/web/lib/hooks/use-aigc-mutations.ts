'use client';
import * as React from 'react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import type { AspectRatio } from '@ss/shared/constants';

/**
 * AIGC workspace 全部 10 个 mutation + 11 个 callback/dialog opener 聚合 hook
 *
 * 三十六收工 R1 收尾:从 aigc-workspace.tsx 抽出(原 ~218 行 mutation + callback 块),
 * 主文件从 578 → ~360 行,达 R1 design 验收 ≤500 行。
 *
 * 设计原则:
 *   - 各 hook 单职责。useAigcMutations 不依赖 useGenerationUI 全量,只接需要的 setter
 *   - mutation pending 状态 destructure 给 GroupDetail / VideoPreviewSection 子组件 prop
 *   - 8 个 group-scoped callback(autoMatch/autoTag/unbind/savePrompt/generateVideo/rejectTake/openBindDialog/autoSelectConsumed)
 *     已 useCallback,memoization 边界跟原版等价
 */

export interface UseAigcMutationsDeps {
  episodeId: string;
  invalidateGroup: (groupId: string) => void;
  scrollToGroup: (id: string) => void;
  setBindDialogGroupId: (id: string | null) => void;
  setAutoSelect: (s: { groupId: string; attemptId: string } | null) => void;
  setPromptDialog: (cfg: {
    title: string;
    description?: string;
    defaultValue: string;
    placeholder?: string;
    onConfirm: (value: string) => void;
  } | null) => void;
  setConfirmDialog: (cfg: {
    title: string;
    description?: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null) => void;
}

export function useAigcMutations(deps: UseAigcMutationsDeps) {
  const {
    episodeId,
    invalidateGroup,
    scrollToGroup,
    setBindDialogGroupId,
    setAutoSelect,
    setPromptDialog,
    setConfirmDialog,
  } = deps;
  const utils = trpc.useUtils();

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

  const generateVideoMutation = trpc.aigc.generateVideo.useMutation({
    onSuccess: (data, variables) => {
      // W5.5:视频生成异步化(ADR-25),handler 入队后立即返回 attemptId(status=RUNNING)
      // F5b(七二):对决/降级/failover 三态提示
      if (data.duelAttemptId) {
        toast.success('对决已提交:两家 Provider 并行生成,完成后出对比卡', { duration: 6000 });
      } else if (data.duelDegraded) {
        toast.warning(`主路已提交;对决第二家降级(已退款):${data.duelDegraded}`, { duration: 8000 });
      } else {
        toast.success('视频任务已提交,等待生成完成');
      }
      if (data.failoverNotice) {
        toast.info(`⚡ ${data.failoverNotice}`, { duration: 8000 });
      }
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

  // ---------- dialog openers ----------

  const onCreateGroup = React.useCallback((): void => {
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
  }, [setPromptDialog, createGroupMutation, episodeId]);

  const onRenameGroup = React.useCallback(
    (g: { id: string; number: string }): void => {
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
    },
    [setPromptDialog, renameGroupMutation],
  );

  const onArchiveGroup = React.useCallback(
    (g: { id: string; number: string }): void => {
      setConfirmDialog({
        title: `归档生成段 "${g.number}"?`,
        description:
          '资产关联会一起归档;视频抽卡记录保留可查(listVideoTakes 仍能读)。归档后不可直接撤销,需 DB 操作恢复。',
        confirmLabel: '归档',
        danger: true,
        onConfirm: () => archiveGroupMutation.mutate({ groupId: g.id }),
      });
    },
    [setConfirmDialog, archiveGroupMutation],
  );

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
    [setBindDialogGroupId],
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
        // F5b(七二)对决:第二家 provider(与主家不同)
        duelProviderOverride?: string;
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
  }, [setAutoSelect]);

  return {
    // mutation 实例(父级用 isPending + variables?.groupId 算 per-group pending)
    autoMatchMutation,
    autoTagMutation,
    bindAssetMutation,
    unbindMutation,
    updatePromptMutation,
    generateVideoMutation,
    rejectTakeMutation,
    createGroupMutation,
    renameGroupMutation,
    archiveGroupMutation,
    // group-scoped callbacks
    onAutoMatch,
    onAutoTag,
    onOpenBindDialog,
    onUnbind,
    onSavePrompt,
    onGenerateVideo,
    onRejectTake,
    onAutoSelectConsumed,
    // dialog openers
    onCreateGroup,
    onRenameGroup,
    onArchiveGroup,
  };
}
