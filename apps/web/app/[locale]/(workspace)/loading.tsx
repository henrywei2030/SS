// #3 perf(2026-06-14):App Router 段级 loading 骨架 —— 进工作区任意模块时,RSC 加载期间
//   立即显示骨架而非白屏,显著降低"点按钮→看到内容"的感知延迟。
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1920px] animate-pulse space-y-4 p-6">
      <div className="h-6 w-40 rounded bg-[hsl(var(--color-muted))]" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg bg-[hsl(var(--color-muted))]" />
        ))}
      </div>
    </div>
  );
}
