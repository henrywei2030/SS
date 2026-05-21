import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCny(amount: number | string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '¥0.00';
  return `¥${n.toFixed(2)}`;
}

export function formatPct(n: number): string {
  return `${Math.round(n)}%`;
}
