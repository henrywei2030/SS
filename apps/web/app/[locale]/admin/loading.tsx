// #3 perf(2026-06-14):管理后台各页段级 loading 骨架。
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1920px] animate-pulse space-y-4 p-6">
      <div className="h-6 w-40 rounded bg-[hsl(var(--color-muted))]" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-[hsl(var(--color-muted))]" />
        ))}
      </div>
    </div>
  );
}
