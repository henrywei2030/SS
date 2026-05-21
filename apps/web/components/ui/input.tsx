'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Cursor 风格 Input — 紧凑、细边框、聚焦时全局蓝环（来自 globals.css *:focus-visible）
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex h-8 w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-input))] px-2.5 py-1 text-[13px] transition-colors',
          'placeholder:text-[hsl(var(--color-muted-foreground))]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'file:border-0 file:bg-transparent file:text-[13px]',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
