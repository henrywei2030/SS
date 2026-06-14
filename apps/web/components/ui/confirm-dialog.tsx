'use client';
import * as React from 'react';

/**
 * 公共 ConfirmDialog / PromptDialog(W7+ audit R2/R10:统一 window.confirm/prompt + 各页内嵌 dialog)
 *
 * 之前散落:
 *   - admin/prompts/styles/presets 用 window.confirm(a11y 差,移动端体验差)
 *   - aigc-workspace 自己写了 ConfirmDialog + PromptDialog(两套)
 * 统一到这里。Radix Dialog 暂不抽(各处样式期望略不同),后续 Phase 2 再合并。
 */

interface ConfirmDialogProps {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby={description ? 'confirm-dialog-desc' : undefined}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
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
            <p
              id="confirm-dialog-desc"
              className="mt-1 text-xs text-[hsl(var(--color-muted-foreground))]"
            >
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

/**
 * useConfirm —— 把 native window.confirm 一键换成应用内 ConfirmDialog。
 * 关键:桌面端(Tauri WebView2)会【静默吞掉】native window.confirm/alert/prompt → 点删除没反应。
 * 用法:const { confirm, confirmDialog } = useConfirm();
 *   删除按钮 onClick → confirm({ title:'确定删除 X?', danger:true, confirmLabel:'删除', onConfirm: () => mutate() });
 *   组件里渲染 {confirmDialog}。
 */
export function useConfirm(): {
  confirm: (opts: Omit<ConfirmDialogProps, 'onClose'>) => void;
  confirmDialog: React.ReactElement | null;
} {
  const [opts, setOpts] = React.useState<Omit<ConfirmDialogProps, 'onClose'> | null>(null);
  const confirmDialog = opts ? (
    <ConfirmDialog
      {...opts}
      onClose={() => setOpts(null)}
      onConfirm={() => {
        setOpts(null);
        opts.onConfirm();
      }}
    />
  ) : null;
  return { confirm: (o) => setOpts(o), confirmDialog };
}

interface PromptDialogProps {
  title: string;
  description?: string;
  defaultValue: string;
  placeholder?: string;
  maxLength?: number;
  onClose: () => void;
  onConfirm: (value: string) => void;
}

export function PromptDialog({
  title,
  description,
  defaultValue,
  placeholder,
  maxLength = 100,
  onClose,
  onConfirm,
}: PromptDialogProps): React.ReactElement {
  const [value, setValue] = React.useState(defaultValue);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

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
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                // 空值不触发,跟"确定"按钮 disabled 一致
                if (value.trim()) onConfirm(value);
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
            maxLength={maxLength}
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
