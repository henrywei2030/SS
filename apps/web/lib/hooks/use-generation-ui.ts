/**
 * useGenerationUI — AigcWorkspace 主组件的 dialog / confirm 态聚合 hook
 *
 * 三十三收工 R1 Phase A1:
 * 把 aigc-workspace.tsx 主组件内 4 个 dialog state 集中到 hook,
 * destructure 后原代码 setter 调用名不变,纯重构零行为变化。
 *
 * State:
 *   - bindDialogGroupId  哪个 group 触发了"绑定资产"对话框(null = 关)
 *   - promptDialog       通用输入框 dialog(rename / new prompt 等)
 *   - confirmDialog      通用确认 dialog(危险动作 + 普通确认)
 *   - autoSelect         视频生成成功后自动选中目标 attempt
 */
import * as React from 'react';

export interface PromptDialogConfig {
  title: string;
  description?: string;
  defaultValue: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
}

export interface ConfirmDialogConfig {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

export interface AutoSelectTarget {
  groupId: string;
  attemptId: string;
}

export interface GenerationUI {
  bindDialogGroupId: string | null;
  setBindDialogGroupId: React.Dispatch<React.SetStateAction<string | null>>;
  promptDialog: PromptDialogConfig | null;
  setPromptDialog: React.Dispatch<React.SetStateAction<PromptDialogConfig | null>>;
  confirmDialog: ConfirmDialogConfig | null;
  setConfirmDialog: React.Dispatch<React.SetStateAction<ConfirmDialogConfig | null>>;
  autoSelect: AutoSelectTarget | null;
  setAutoSelect: React.Dispatch<React.SetStateAction<AutoSelectTarget | null>>;
}

export function useGenerationUI(): GenerationUI {
  const [bindDialogGroupId, setBindDialogGroupId] = React.useState<string | null>(null);
  const [promptDialog, setPromptDialog] = React.useState<PromptDialogConfig | null>(null);
  const [confirmDialog, setConfirmDialog] = React.useState<ConfirmDialogConfig | null>(null);
  const [autoSelect, setAutoSelect] = React.useState<AutoSelectTarget | null>(null);

  return {
    bindDialogGroupId,
    setBindDialogGroupId,
    promptDialog,
    setPromptDialog,
    confirmDialog,
    setConfirmDialog,
    autoSelect,
    setAutoSelect,
  };
}
