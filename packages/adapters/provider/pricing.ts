/**
 * Provider 计费公式 —— 纯函数,集中"成本计算"逻辑单一真相源。
 *
 * 背景(五八-fix + P1):原公式在 OpenAICompatTextProvider 的 `estimateCost` 与 `calcCost`
 *   各写一遍(逐字重复),且无单测 —— 正是这里曾让 claude-sonnet-4-6 的 modelRate
 *   悄悄停在过时的 7.486、与 moyu 实收 12.83 不符却没被发现。抽成纯函数 + 单测后:
 *   ① 估算/记账两处共用同一公式,不会再漂移;② 公式有测试锁死,改价/改倍率立即可验。
 */

/** 文本 token 计费参数(三档优先级见 computeTextCostCny)*/
export interface TextPricing {
  /** 2 倍率优先:¥ per 1M 输入 token 当量(× outputRate 得输出价)*/
  modelRate?: number;
  /** 输出价倍率(相对 modelRate),默认 1 */
  outputRate?: number;
  /** 分离单价:¥ per 1K 输入 token */
  inputUnitPriceCny?: number;
  /** 分离单价:¥ per 1K 输出 token */
  outputUnitPriceCny?: number;
  /** 合并兜底价:¥ per 1K(输入+输出)token */
  unitPriceCny: number;
}

/**
 * 文本成本(¥)。优先级:
 *   ① modelRate 非空 → 2 倍率:in/1M × rate + out/1M × rate × outputRate
 *   ② 分离单价齐全 → in/1K × inP + out/1K × outP
 *   ③ 兜底 → (in+out)/1K × unitPriceCny
 * 对照 moyu 账单实测公式:(in + out×outputRate) × modelRate / 1e6(分组倍率 1)。
 */
export function computeTextCostCny(
  inTokens: number,
  outTokens: number,
  p: TextPricing,
): number {
  if (p.modelRate != null && p.modelRate > 0) {
    const oRate = p.outputRate ?? 1;
    return (inTokens / 1_000_000) * p.modelRate + (outTokens / 1_000_000) * p.modelRate * oRate;
  }
  if (p.inputUnitPriceCny != null && p.outputUnitPriceCny != null) {
    return (inTokens / 1000) * p.inputUnitPriceCny + (outTokens / 1000) * p.outputUnitPriceCny;
  }
  return ((inTokens + outTokens) / 1000) * p.unitPriceCny;
}

/** 图像成本(¥)= 张数 × 每张单价。简化:不按 token/分辨率细算(对照 moyu seedream ¥0.22/张)。*/
export function computeImageCostCny(count: number, unitPriceCny: number): number {
  return Math.max(0, count) * unitPriceCny;
}
