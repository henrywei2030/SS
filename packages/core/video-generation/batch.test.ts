/**
 * F4 批量纯函数单测 — 优先级排序(plan 回退/tiebreak)/时长口径/重试上限解析/批次标签。
 */
import { describe, expect, it } from 'vitest';

import {
  batchDurationS,
  isBatchGroupId,
  orderBatchCandidates,
  parseBatchRetryMax,
  parseProductionPlanPriorities,
  type BatchGroupCandidate,
} from './batch.js';

function cand(partial: Partial<BatchGroupCandidate> & { groupId: string }): BatchGroupCandidate {
  return {
    number: partial.groupId,
    durationS: 5,
    firstShotPos: 0,
    bestShotPriority: null,
    scenePlanPriority: null,
    ...partial,
  };
}

describe('orderBatchCandidates', () => {
  it('S>A>B>C;shot 优先级缺失回退 plan;全无压底;同级按首镜顺序', () => {
    const out = orderBatchCandidates([
      cand({ groupId: 'noprio', firstShotPos: 1 }),
      cand({ groupId: 'c', bestShotPriority: 'C', firstShotPos: 2 }),
      cand({ groupId: 'planA', scenePlanPriority: 'A', firstShotPos: 9 }),
      cand({ groupId: 's', bestShotPriority: 'S', firstShotPos: 30 }),
      cand({ groupId: 'a2', bestShotPriority: 'A', firstShotPos: 20 }),
      cand({ groupId: 'a1', bestShotPriority: 'A', firstShotPos: 10 }),
    ]);
    expect(out.map((c) => c.groupId)).toEqual(['s', 'planA', 'a1', 'a2', 'c', 'noprio']);
  });

  it('shot 优先级优先于 plan 回退(组内有 B,plan 给 S 也按 B 排)', () => {
    const out = orderBatchCandidates([
      cand({ groupId: 'shotB-planS', bestShotPriority: 'B', scenePlanPriority: 'S', firstShotPos: 1 }),
      cand({ groupId: 'shotA', bestShotPriority: 'A', firstShotPos: 2 }),
    ]);
    expect(out.map((c) => c.groupId)).toEqual(['shotA', 'shotB-planS']);
  });

  it('入参数组不被原地修改', () => {
    const input = [cand({ groupId: 'b', bestShotPriority: 'B' }), cand({ groupId: 's', bestShotPriority: 'S' })];
    orderBatchCandidates(input);
    expect(input[0]!.groupId).toBe('b');
  });
});

describe('batchDurationS(estimate 与提交同公式)', () => {
  it('Float 组时长取整;clamp [1, maxDurationS]', () => {
    expect(batchDurationS(7.5, 15)).toBe(8);
    expect(batchDurationS(0.2, 15)).toBe(1);
    expect(batchDurationS(20, 15)).toBe(15);
    expect(batchDurationS(null, 15)).toBe(5);
    expect(batchDurationS(undefined, 10)).toBe(5);
  });
});

describe('parseBatchRetryMax', () => {
  it('默认 0;clamp 0-3;非法值归 0', () => {
    expect(parseBatchRetryMax(undefined)).toBe(0);
    expect(parseBatchRetryMax('2')).toBe(2);
    expect(parseBatchRetryMax('99')).toBe(3);
    expect(parseBatchRetryMax('-1')).toBe(0);
    expect(parseBatchRetryMax('abc')).toBe(0);
  });
});

describe('isBatchGroupId / parseProductionPlanPriorities', () => {
  it('batch_ 前缀识别;单点重抽 UUID 不误判', () => {
    expect(isBatchGroupId('batch_550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isBatchGroupId('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    expect(isBatchGroupId(null)).toBe(false);
  });

  it('plan 防御解析:畸形项跳过,重复 sceneIdx 取首个', () => {
    const m = parseProductionPlanPriorities([
      { sceneIdx: 1, priority: 'S', durationS: 15 },
      { sceneIdx: 2, priority: 'X' }, // 非法优先级
      'garbage',
      { sceneIdx: '3', priority: 'B' }, // 字符串数字可容
      { sceneIdx: 1, priority: 'C' }, // 重复,忽略
      null,
    ]);
    expect(m.get(1)).toBe('S');
    expect(m.has(2)).toBe(false);
    expect(m.get(3)).toBe('B');
    expect(parseProductionPlanPriorities(null).size).toBe(0);
    expect(parseProductionPlanPriorities({ not: 'array' }).size).toBe(0);
  });
});
