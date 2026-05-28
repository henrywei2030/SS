'use client';
import * as React from 'react';

export interface ConfirmDialogProps {
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
