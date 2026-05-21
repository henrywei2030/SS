'use client';
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Cursor 风格按钮（双主题自适应）
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))] hover:opacity-90',
        secondary:
          'bg-[hsl(var(--color-secondary))] text-[hsl(var(--color-secondary-foreground))] hover:bg-[hsl(var(--color-muted))] border border-[hsl(var(--color-border))]',
        outline:
          'border border-[hsl(var(--color-border))] bg-transparent text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-secondary))]',
        ghost:
          'bg-transparent text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary))] hover:text-[hsl(var(--color-foreground))]',
        destructive:
          'bg-[hsl(var(--color-destructive)/0.15)] text-[hsl(var(--color-destructive))] border border-[hsl(var(--color-destructive)/0.3)] hover:bg-[hsl(var(--color-destructive)/0.25)]',
        link: 'text-[hsl(var(--color-accent))] underline-offset-2 hover:underline p-0 h-auto',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2.5 text-[12px]',
        lg: 'h-9 px-4',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = 'Button';

export { buttonVariants };
