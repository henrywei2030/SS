/**
 * 计费周期工具
 *
 * P3 收尾(2026-06-06):收敛多处裸写的 `new Date().toISOString().slice(0, 7)`。
 * 之前散在 core/{prepay,refund}、adapters/provider/base、asset-generate、worker processor —
 * 同一计算重复 7 处,易漂(有人写错切片位)。统一成纯函数,零行为变化。
 *
 * 返回当前(或传入时间)的 UTC 计费周期 "YYYY-MM"(月粒度)。
 * 用 UTC(toISOString)与原各处一致,跨时区机器对账口径统一。
 */
export function billingCycle(d: Date = new Date()): string {
  return d.toISOString().slice(0, 7);
}
