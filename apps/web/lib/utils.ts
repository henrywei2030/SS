import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * 金钱显示助手(W7 audit R10:统一 insights / 各页用法)
 *   0       → "¥0.00"
 *   0<v<0.01 → "<¥0.01"  (防 toFixed(2) 误导成 "¥0.00")
 *   其它     → "¥X.XX"
 */
export function formatCny(amount: number | string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n) || n === 0) return '¥0.00';
  if (n > 0 && n < 0.01) return '<¥0.01';
  return `¥${n.toFixed(2)}`;
}
