/**
 * 计费公式单测 —— 锁死 moyu 实收口径 + 三档优先级。
 * 防回归:五八-fix 曾因 sonnet modelRate 停在过时 7.486 而与 moyu 实收 12.83 不符。
 */
import { describe, expect, it } from 'vitest';

import { computeImageCostCny, computeTextCostCny } from './pricing.js';

describe('computeTextCostCny — 2 倍率(modelRate)', () => {
  // moyu 账单实测:claude-sonnet-4-6 modelRate=12.83 outputRate=5
  it('命中 moyu 实收:in=17902 out=10283 → ¥0.889337', () => {
    expect(
      computeTextCostCny(17902, 10283, { modelRate: 12.83, outputRate: 5, unitPriceCny: 0 }),
    ).toBeCloseTo(0.889337, 5);
  });

  it('命中 moyu 实收:in=1482 out=3724 → ¥0.257908', () => {
    expect(
      computeTextCostCny(1482, 3724, { modelRate: 12.83, outputRate: 5, unitPriceCny: 0 }),
    ).toBeCloseTo(0.257908, 5);
  });

  it('过时倍率 7.486 会算出明显偏低值(回归哨兵:应 ≈¥0.519,远低于实收 0.889)', () => {
    const stale = computeTextCostCny(17902, 10283, {
      modelRate: 7.486,
      outputRate: 5,
      unitPriceCny: 0,
    });
    expect(stale).toBeCloseTo(0.518907, 5);
    expect(stale).toBeLessThan(0.6); // 与实收 0.889 差距显著 —— 提醒"倍率别再停在旧值"
  });

  it('outputRate 缺省按 1 算', () => {
    // (100/1e6)*10 + (200/1e6)*10*1 = 0.001 + 0.002 = 0.003
    expect(computeTextCostCny(100, 200, { modelRate: 10, unitPriceCny: 0 })).toBeCloseTo(0.003, 9);
  });
});

describe('computeTextCostCny — 分离单价(无 modelRate)', () => {
  it('in/1K×inP + out/1K×outP', () => {
    // 1000/1000*0.01 + 2000/1000*0.05 = 0.01 + 0.10 = 0.11
    expect(
      computeTextCostCny(1000, 2000, {
        inputUnitPriceCny: 0.01,
        outputUnitPriceCny: 0.05,
        unitPriceCny: 0,
      }),
    ).toBeCloseTo(0.11, 9);
  });
});

describe('computeTextCostCny — 合并兜底价', () => {
  it('(in+out)/1K × unitPriceCny', () => {
    // (1000+1000)/1000 * 0.02 = 0.04
    expect(computeTextCostCny(1000, 1000, { unitPriceCny: 0.02 })).toBeCloseTo(0.04, 9);
  });

  it('零 token → 0', () => {
    expect(computeTextCostCny(0, 0, { modelRate: 12.83, outputRate: 5, unitPriceCny: 0 })).toBe(0);
  });
});

describe('computeImageCostCny', () => {
  it('命中 moyu seedream ¥0.22/张', () => {
    expect(computeImageCostCny(1, 0.22)).toBeCloseTo(0.22, 9);
    expect(computeImageCostCny(4, 0.22)).toBeCloseTo(0.88, 9);
  });

  it('count<=0 → 0(不为负)', () => {
    expect(computeImageCostCny(0, 0.22)).toBe(0);
    expect(computeImageCostCny(-1, 0.22)).toBe(0);
  });
});
