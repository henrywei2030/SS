'use client';
import * as React from 'react';

export interface PromptDialogProps {
  title: string;
  description?: string;
  defaultValue: string;
  placeholder?: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
}

export function PromptDialog({
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
            className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--color-info))]"
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
            className="rounded-md bg-[hsl(var(--color-info))] px-3 py-1.5 text-xs font-medium text-white hover:bg-[hsl(var(--color-info)/0.9)] disabled:opacity-50"
          >
            确定
          </button>
        </footer>
      </div>
    </div>
  );
}
