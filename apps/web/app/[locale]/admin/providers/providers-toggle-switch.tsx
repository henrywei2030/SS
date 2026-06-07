'use client';
import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { formatCny, cn } from '@/lib/utils';

import type { Provider } from './providers-shared';

// ============================================================================
// 工具组件
// ============================================================================

export function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  loading = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || loading}
      onClick={() => !disabled && !loading && onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-green-500' : 'bg-gray-400/40',
        (disabled || loading) && 'cursor-not-allowed opacity-50',
        !disabled && !loading && 'cursor-pointer',
      )}
    >
      <span
        className={cn(
          'inline-block size-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      >
        {loading && <Loader2 className="size-5 animate-spin p-0.5 text-gray-600" />}
      </span>
    </button>
  );
}

export function formatModelPrice(p: Provider): React.ReactNode {
  if (p.modelRate != null && p.modelRate > 0) {
    const outputCost = p.modelRate * (p.outputRate ?? 1);
    return (
      <span>
        ¥{p.modelRate.toFixed(2)}/M 输入 · ¥{outputCost.toFixed(2)}/M 输出
        {p.outputRate != null && p.outputRate !== 1 && (
          <span className="ml-1 text-[hsl(var(--color-muted-foreground))]">
            (输出 {p.outputRate}×)
          </span>
        )}
      </span>
    );
  }
  if (p.unitPriceCny > 0) {
    return (
      <span>
        {formatCny(p.unitPriceCny)}/{p.unitName}
      </span>
    );
  }
  // Audit 修(F-P1-5):中转站模型 + 单价为 0 时不显示误导性 "¥0/ktoken"
  return (
    <span className="italic text-[hsl(var(--color-muted-foreground))]">
      {p.relayProviderId ? '由中转站计费(看运营商页)' : '免费 / 订阅制'}
    </span>
  );
}
