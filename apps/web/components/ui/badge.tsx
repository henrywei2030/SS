import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Cursor 风格 Badge — 细边、低饱和、跟随主题
 */
const badgeVariants = cva(
  'inline-flex items-center rounded border px-1.5 text-[11px] font-medium transition-colors h-5',
  {
    variants: {
      variant: {
        default:
          'border-[hsl(var(--color-border))] bg-[hsl(var(--color-secondary))] text-[hsl(var(--color-foreground))]',
        secondary:
          'border-transparent bg-[hsl(var(--color-muted))] text-[hsl(var(--color-muted-foreground))]',
        success:
          'border-[hsl(var(--color-success)/0.3)] bg-[hsl(var(--color-success)/0.10)] text-[hsl(var(--color-success))]',
        warning:
          'border-[hsl(var(--color-warning)/0.3)] bg-[hsl(var(--color-warning)/0.10)] text-[hsl(var(--color-warning))]',
        destructive:
          'border-[hsl(var(--color-destructive)/0.3)] bg-[hsl(var(--color-destructive)/0.10)] text-[hsl(var(--color-destructive))]',
        info:
          'border-[hsl(var(--color-accent)/0.3)] bg-[hsl(var(--color-accent)/0.10)] text-[hsl(var(--color-accent))]',
        outline: 'text-[hsl(var(--color-foreground))] border-[hsl(var(--color-border))]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.ReactElement {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
