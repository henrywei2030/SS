/**
 * checkDailyVideoBudget — 每日预算守卫单测
 *
 * 三十六收工 R2 Phase D:Decimal 累加 + 边界 + 排除当前 attempt PREPAY 防自计。
 *
 * 覆盖:
 *   - 0 / 负预算 → 直接通过(不限额)
 *   - 远未到限 → 通过
 *   - 累加后正好等于限额 → 通过(用 .gt() 不是 .gte())
 *   - 累加后超限 → 返回拒绝消息
 *   - 排除 excludeAttemptId 防 self-counting:有自己的 PREPAY 不算 spent
 *   - 大额 Decimal 累加(IEEE-754 漂移防御)
 */
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@ss/db';

import { checkDailyVideoBudget } from './budget-check.js';

type LedgerEntry = {
  id: string;
  projectId: string;
  attemptId: string;
  action: string;
  success: boolean;
  costCny: string;
  createdAt: Date;
};

function makeMockTx(seed: LedgerEntry[]) {
  const rows = seed.map((r) => ({ ...r }));
  const costLedgerEntry = {
    aggregate: async ({
      where,
    }: {
      where: {
        projectId: string;
        action: string;
        success: boolean;
        createdAt: { gte: Date };
        attemptId: { not: string };
      };
      _sum: unknown;
    }) => {
      const matching = rows.filter(
        (r) =>
          r.projectId === where.projectId &&
          r.action === where.action &&
          r.success === where.success &&
          r.createdAt >= where.createdAt.gte &&
          r.attemptId !== where.attemptId.not,
      );
      const sum = matching.reduce((acc, r) => acc + Number(r.costCny), 0);
      return {
        _sum: { costCny: sum > 0 ? sum.toFixed(4) : null },
      };
    },
  };
  return { costLedgerEntry } as unknown as PrismaClient;
}

const baseArgs = {
  projectId: 'proj-1',
  prepayEstimateCny: 2.0,
  excludeAttemptId: 'attempt-current',
};

describe('checkDailyVideoBudget', () => {
  it('dailyBudgetCny = 0 直接通过(不限额)', async () => {
    const tx = makeMockTx([]);
    const r = await checkDailyVideoBudget(tx, { ...baseArgs, dailyBudgetCny: 0 });
    expect(r).toBeNull();
  });

  it('dailyBudgetCny 负数直接通过(等价不限额)', async () => {
    const tx = makeMockTx([]);
    const r = await checkDailyVideoBudget(tx, { ...baseArgs, dailyBudgetCny: -1 });
    expect(r).toBeNull();
  });

  it('远未到限通过', async () => {
    const tx = makeMockTx([
      {
        id: 'l1',
        projectId: 'proj-1',
        attemptId: 'attempt-old',
        action: 'video.generate',
        success: true,
        costCny: '5.0000',
        createdAt: new Date(),
      },
    ]);
    const r = await checkDailyVideoBudget(tx, {
      ...baseArgs,
      dailyBudgetCny: 100,
    });
    expect(r).toBeNull(); // 5 + 2 < 100
  });

  it('累加正好等于限额 → 通过(用 .gt() 不是 .gte())', async () => {
    const tx = makeMockTx([
      {
        id: 'l1',
        projectId: 'proj-1',
        attemptId: 'attempt-old',
        action: 'video.generate',
        success: true,
        costCny: '8.0000',
        createdAt: new Date(),
      },
    ]);
    const r = await checkDailyVideoBudget(tx, {
      ...baseArgs,
      dailyBudgetCny: 10,
    });
    expect(r).toBeNull(); // 8 + 2 = 10,不超
  });

  it('累加超限 → 返回拒绝消息(含金额数字)', async () => {
    const tx = makeMockTx([
      {
        id: 'l1',
        projectId: 'proj-1',
        attemptId: 'attempt-old',
        action: 'video.generate',
        success: true,
        costCny: '9.0000',
        createdAt: new Date(),
      },
    ]);
    const r = await checkDailyVideoBudget(tx, {
      ...baseArgs,
      dailyBudgetCny: 10,
    });
    expect(r).not.toBeNull();
    expect(r).toMatch(/今日视频预算已用/);
    expect(r).toMatch(/9\.00/);
    expect(r).toMatch(/10/);
    expect(r).toMatch(/2\.00/);
  });

  it('排除 excludeAttemptId 防 self-counting:自己 PREPAY 不算入 spent', async () => {
    const tx = makeMockTx([
      // 自己刚写的 PREPAY 8 元
      {
        id: 'l1',
        projectId: 'proj-1',
        attemptId: 'attempt-current',
        action: 'video.generate',
        success: true,
        costCny: '8.0000',
        createdAt: new Date(),
      },
    ]);
    const r = await checkDailyVideoBudget(tx, {
      ...baseArgs,
      dailyBudgetCny: 10,
      prepayEstimateCny: 2,
    });
    // 排除自己 → spent = 0,2 ≤ 10 通过
    expect(r).toBeNull();
  });

  it('大额 Decimal 累加(防 IEEE-754 漂移)', async () => {
    // 用经典 0.1 + 0.2 != 0.3 漂移案例:1000 笔 0.1 元应该 = 100 元
    const tx = makeMockTx(
      Array.from({ length: 1000 }).map((_, i) => ({
        id: `l${i}`,
        projectId: 'proj-1',
        attemptId: `attempt-${i}`,
        action: 'video.generate',
        success: true,
        costCny: '0.1000',
        createdAt: new Date(),
      })),
    );
    const r = await checkDailyVideoBudget(tx, {
      ...baseArgs,
      dailyBudgetCny: 100,
      prepayEstimateCny: 0,
    });
    // spent = 100.0(精确),预扣 0 → 不超
    expect(r).toBeNull();
  });
});
