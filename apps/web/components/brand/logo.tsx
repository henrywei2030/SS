/**
 * StarsAlign Studio · 星垣工坊 — Logo 系统
 *
 * 两种变体:
 *   1. <LogoMark />     — 仅图标(星系环 + 两颗星),用于 nav / favicon / 头像位
 *   2. <LogoLockup />   — 图标 + 文字组合,用于登录页 hero 等大场景
 *
 * 设计还原(基于用户提供的 logo 图):
 *   - 倾斜 -22° 的多层椭圆环(星系盘)
 *   - 右上大星 + 左下小星(four-point star,带十字光芒)
 *   - 冷蓝白配色 (#7BC4F6 主调 / #E0EDF7 高光)
 *   - 字体使用 metallic silver 渐变(CSS background-clip)
 *
 * 如有 PNG 原图请放 /apps/web/public/logo.png,会自动作为 OpenGraph 图。
 */
import { cn } from '@/lib/utils';

// ============================================================================
// LogoMark — 仅图标（SVG 矢量，任意尺寸无损）
// ============================================================================

export interface LogoMarkProps {
  className?: string;
  /** 单色模式：在 nav / sidebar 等小尺寸用，避免视觉过载 */
  mono?: boolean;
  /** 是否启用动画（默认 false，Cursor 风格克制） */
  animated?: boolean;
}

export function LogoMark({
  className,
  mono = false,
  animated = false,
}: LogoMarkProps): React.ReactElement {
  const ringStroke = mono ? 'currentColor' : 'url(#sa-ring-gradient)';
  const ringOpacity = mono ? 0.5 : 1;
  const starFill = mono ? 'currentColor' : 'url(#sa-star-gradient)';

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-label="StarsAlign Studio"
    >
      <defs>
        {/* 星系环渐变（CSS 变量驱动，自动适配明亮 / 深夜） */}
        <linearGradient id="sa-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--logo-blue-1))', stopOpacity: 0.4 }} />
          <stop offset="35%" style={{ stopColor: 'hsl(var(--logo-blue-2))', stopOpacity: 0.9 }} />
          <stop offset="65%" style={{ stopColor: 'hsl(var(--logo-blue-3))', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--logo-blue-1))', stopOpacity: 0.4 }} />
        </linearGradient>

        {/* 星体高光 */}
        <radialGradient id="sa-star-gradient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--logo-star))', stopOpacity: 1 }} />
          <stop offset="40%" style={{ stopColor: 'hsl(var(--logo-blue-3))', stopOpacity: 0.95 }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--logo-blue-2))', stopOpacity: 0.3 }} />
        </radialGradient>

        {/* 星光辐射 */}
        <filter id="sa-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 星系环：4 圈 -22° 椭圆，由外到内 */}
      <g
        transform="rotate(-22 32 32)"
        stroke={ringStroke}
        opacity={ringOpacity}
        fill="none"
        strokeLinecap="round"
      >
        <ellipse cx="32" cy="32" rx="26" ry="7.5" strokeWidth="0.7" />
        <ellipse cx="32" cy="32" rx="23" ry="6.5" strokeWidth="0.8" />
        <ellipse cx="32" cy="32" rx="20" ry="5.5" strokeWidth="0.9" opacity="0.85" />
        <ellipse cx="32" cy="32" rx="17" ry="4.5" strokeWidth="0.7" opacity="0.6" />
      </g>

      {/* 大星（右上） — four-point star */}
      <g
        transform="translate(46 18)"
        filter="url(#sa-glow)"
        className={animated ? 'origin-center animate-pulse' : ''}
      >
        <path d="M 0 -7 L 1.4 -1.4 L 7 0 L 1.4 1.4 L 0 7 L -1.4 1.4 L -7 0 L -1.4 -1.4 Z" fill={starFill} />
        <circle cx="0" cy="0" r="1.5" fill="hsl(var(--logo-star))" />
      </g>

      {/* 小星（左下） */}
      <g transform="translate(20 44)" filter="url(#sa-glow)">
        <path d="M 0 -4 L 0.8 -0.8 L 4 0 L 0.8 0.8 L 0 4 L -0.8 0.8 L -4 0 L -0.8 -0.8 Z" fill={starFill} />
        <circle cx="0" cy="0" r="0.7" fill="hsl(var(--logo-star))" />
      </g>
    </svg>
  );
}

// ============================================================================
// LogoLockup — 图标 + 文字组合(登录页 hero 等)
// ============================================================================

export interface LogoLockupProps {
  className?: string;
  /** 显示模式 */
  layout?: 'vertical' | 'horizontal';
  /** 副标语 */
  tagline?: string;
  /** 尺寸 */
  size?: 'sm' | 'md' | 'lg';
}

export function LogoLockup({
  className,
  layout = 'vertical',
  tagline = 'ALIGNING IDEAS · CRAFTING WORLDS',
  size = 'md',
}: LogoLockupProps): React.ReactElement {
  const markSize = size === 'lg' ? 'size-16' : size === 'md' ? 'size-12' : 'size-9';
  const wordSize = size === 'lg' ? 'text-[22px]' : size === 'md' ? 'text-[18px]' : 'text-[14px]';
  const taglineSize = size === 'lg' ? 'text-[10px]' : 'text-[9px]';

  if (layout === 'horizontal') {
    return (
      <div className={cn('flex items-center gap-2.5', className)}>
        <LogoMark className={markSize} animated />
        <div className="flex flex-col">
          <span className={cn('wordmark-metallic font-semibold tracking-wide', wordSize)}>
            StarsAlign Studio
          </span>
          {tagline && (
            <span className={cn('mt-0.5 tracking-[0.18em] text-[hsl(var(--color-muted-foreground))]', taglineSize)}>
              {tagline}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <LogoMark className={markSize} animated />
      <div className="flex flex-col items-center">
        <span className={cn('wordmark-metallic font-semibold tracking-wide', wordSize)}>
          StarsAlign Studio
        </span>
        {tagline && (
          <span
            className={cn(
              'mt-1.5 tracking-[0.22em] text-[hsl(var(--color-muted-foreground))]',
              taglineSize,
            )}
          >
            {tagline}
          </span>
        )}
        <span className="mt-1 text-[12px] tracking-wider text-[hsl(0_0%_70%)]">星垣工坊</span>
      </div>
    </div>
  );
}
