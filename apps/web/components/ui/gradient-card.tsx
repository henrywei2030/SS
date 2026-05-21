'use client';

/**
 * GradientCard — 鼠标跟随的金边描边卡片
 *
 * 灵感: Linear's project cards / Vercel's "before" cards
 * 实现: CSS conic-gradient + radial-gradient + mouse position via CSS variables
 */
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface GradientCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 主色（HSL）默认极光金 */
  glowHsl?: string;
  /** 静态描边强度 */
  borderOpacity?: number;
}

export const GradientCard = React.forwardRef<HTMLDivElement, GradientCardProps>(
  ({ className, children, glowHsl = '38 92% 55%', borderOpacity = 0.15, ...props }, ref) => {
    const innerRef = React.useRef<HTMLDivElement>(null);

    const setRef = (node: HTMLDivElement | null): void => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    };

    const onMouseMove = (e: React.MouseEvent<HTMLDivElement>): void => {
      const el = innerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
      el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
    };

    return (
      <div
        ref={setRef}
        onMouseMove={onMouseMove}
        className={cn(
          'group relative rounded-xl bg-[hsl(var(--color-card))] transition-all duration-300',
          className,
        )}
        style={
          {
            '--glow-hsl': glowHsl,
            '--border-opacity': borderOpacity,
          } as React.CSSProperties
        }
        {...props}
      >
        {/* 描边层：使用 mask 制造仅边框可见 */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: `radial-gradient(400px circle at var(--mouse-x) var(--mouse-y), hsl(var(--glow-hsl) / 0.4), transparent 40%)`,
            mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            maskComposite: 'exclude',
            padding: '1px',
          }}
        />
        {/* 静态淡描边 */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl"
          style={{
            border: `1px solid hsl(var(--glow-hsl) / var(--border-opacity))`,
          }}
        />
        {/* 微微 hover 升起 */}
        <div className="relative">{children}</div>
      </div>
    );
  },
);
GradientCard.displayName = 'GradientCard';
