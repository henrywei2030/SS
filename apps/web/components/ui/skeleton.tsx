import { cn } from '@/lib/utils';

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-[hsl(var(--color-secondary))]',
        className,
      )}
      {...props}
    >
      <div
        className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
        style={{ animation: 'shimmer-skel 1.6s linear infinite' }}
      />
      <style>{`
        @keyframes shimmer-skel {
          to { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
