/**
 * Aurora Background — 极光动画背景
 *
 * 纯 CSS（无 canvas / 无 JS），性能开销极低
 * 灵感: Aceternity UI Aurora · Vercel OSS dashboards · Linear's signin
 *
 * 用法:
 *   <AuroraBackground>
 *     <你的内容 />
 *   </AuroraBackground>
 */
'use client';

import { cn } from '@/lib/utils';

interface AuroraBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 强度：subtle (登录页) | bold (营销页) */
  intensity?: 'subtle' | 'bold';
  /** 是否显示星点（夜空感） */
  showStars?: boolean;
}

export function AuroraBackground({
  children,
  className,
  intensity = 'subtle',
  showStars = false,
  ...props
}: AuroraBackgroundProps): React.ReactElement {
  return (
    <div
      className={cn(
        'relative isolate flex h-full w-full flex-col overflow-hidden bg-[hsl(220_28%_6%)]',
        className,
      )}
      {...props}
    >
      {/* 极光层 1：金 → 紫 流光 */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 -z-10',
          intensity === 'subtle' ? 'opacity-50' : 'opacity-80',
        )}
        style={{
          backgroundImage: `
            radial-gradient(at 20% 30%, hsl(38 92% 55% / 0.25) 0px, transparent 50%),
            radial-gradient(at 80% 20%, hsl(258 78% 60% / 0.25) 0px, transparent 50%),
            radial-gradient(at 80% 80%, hsl(195 85% 55% / 0.20) 0px, transparent 50%),
            radial-gradient(at 20% 80%, hsl(38 92% 55% / 0.15) 0px, transparent 50%)
          `,
        }}
      />

      {/* 极光层 2：缓慢流动的条纹 */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="aurora-stream-1 absolute -inset-x-[50%] top-[10%] h-[40%] -rotate-12" />
        <div className="aurora-stream-2 absolute -inset-x-[50%] bottom-[10%] h-[40%] rotate-12" />
      </div>

      {/* 星点层（可选） */}
      {showStars && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage:
              'radial-gradient(1px 1px at 20px 30px, white, transparent), radial-gradient(1px 1px at 60px 70px, white, transparent), radial-gradient(1.5px 1.5px at 120px 50px, white, transparent), radial-gradient(1px 1px at 180px 10px, white, transparent), radial-gradient(1px 1px at 230px 90px, white, transparent)',
            backgroundRepeat: 'repeat',
            backgroundSize: '250px 100px',
            opacity: 0.3,
          }}
        />
      )}

      {/* 顶部金色边缘高光 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, hsl(38 92% 55% / 0.5), transparent)',
        }}
      />

      {children}

      <style>{`
        @keyframes aurora-stream-1 {
          0%, 100% { transform: translateX(-10%) rotate(-12deg); opacity: 0.4; }
          50%      { transform: translateX(10%) rotate(-8deg);  opacity: 0.7; }
        }
        @keyframes aurora-stream-2 {
          0%, 100% { transform: translateX(10%) rotate(12deg);  opacity: 0.3; }
          50%      { transform: translateX(-10%) rotate(16deg); opacity: 0.6; }
        }
        .aurora-stream-1 {
          background: linear-gradient(90deg,
            transparent,
            hsl(38 92% 55% / 0.12),
            hsl(258 78% 60% / 0.10),
            hsl(195 85% 55% / 0.08),
            transparent
          );
          filter: blur(40px);
          animation: aurora-stream-1 18s ease-in-out infinite;
        }
        .aurora-stream-2 {
          background: linear-gradient(90deg,
            transparent,
            hsl(195 85% 55% / 0.10),
            hsl(258 78% 60% / 0.08),
            transparent
          );
          filter: blur(50px);
          animation: aurora-stream-2 22s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

/**
 * 局部 Aurora Spotlight — 用于卡片背后的光晕
 */
export function AuroraSpotlight({
  className,
}: {
  className?: string;
}): React.ReactElement {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute -inset-px -z-10', className)}
      style={{
        background:
          'radial-gradient(600px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), hsl(38 92% 55% / 0.08), transparent 40%)',
      }}
    />
  );
}
