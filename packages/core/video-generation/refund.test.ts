/**
 * refundPrepayForAttempt — idempotent REFUND ledger 单测
 *
 * 三十六收工 R2 Phase D:验证经济链路核心 helper 在所有边界都正确。
 *
 * 覆盖:
 *   - 正常 case:有 PREPAY → 写 REFUND(负数 costCny + parentEntryId 链接)
 *   - 已退过:再调用 return false 不重写(idempotent 防双写)
 *   - 无 PREPAY:return false 不写(防误退)
 *   - PREPAY 金额 0:return false 不写(节省 ledger 噪音)
 *   - 多次连续调用:只第一次写 REFUND,后续都 false
 */
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@ss/db';

import { refundPrepayForAttempt } from './refund.js';

type LedgerEntry = {
  id: string;
  attemptId: string;
  entryType: 'PREPAY' | 'REFUND';
  costCny: string;
  userId?: string;
  projectId?: string;
  episodeId?: string | null;
  providerId?: string;
  refundReason?: string;
  parentEntryId?: string;
};

function makeMockTx(seed: LedgerEntry[]) {
  const rows: LedgerEntry[] = seed.map((r) => ({ ...r }));

  const costLedgerEntry = {
    findFirst: async ({
      where,
    }: {
      where: { attemptId: string; entryType: 'PREPAY' | 'REFUND' };
      select?: unknown;
    }) => {
      const r = rows.find(
        (x) => x.attemptId === where.attemptId && x.entryType === where.entryType,
      );
      return r ? { ...r } : null;
    },
    create: async ({ data }: { data: Omit<LedgerEntry, 'id'> }) => {
      const id = `ledger-${rows.length + 1}`;
      const entry = { id, ...data };
      rows.push(entry as LedgerEntry);
      return entry;
    },
  };

  return { costLedgerEntry, _rows: rows } as unknown as PrismaClient & {
    _rows: LedgerEntry[];
  };
}

describe('refundPrepayForAttempt', () => {
  const baseArgs = {
    attemptId: 'attempt-1',
    userId: 'user-1',
    projectId: 'proj-1',
    episodeId: 'ep-1',
    providerId: 'seedance-2-fast',
    reason: 'stale_running_auto_recovered',
  };

  it('有 PREPAY 时写 REFUND(负数 + parentEntryId 链接)', async () => {
    const tx = makeMockTx([
      {
        id: 'ledger-1',
        attemptId: 'attempt-1',
        entryType: 'PREPAY',
        costCny: '2.5000',
      },
    ]);
    const refunded = await refundPrepayForAttempt(tx, baseArgs);
    expect(refunded).toBe(true);
    const refundRow = tx._rows.find((r) => r.entryType === 'REFUND');
    expect(refundRow).toBeTruthy();
    expect(refundRow?.costCny).toBe('-2.5000');
    expect(refundRow?.parentEntryId).toBe('ledger-1');
    expect(refundRow?.refundReason).toBe('stale_running_auto_recovered');
  });

  it('已退过 → return false 不重写(idempotent 防双写)', async () => {
    const tx = makeMockTx([
      {
        id: 'ledger-1',
        attemptId: 'attempt-1',
        entryType: 'PREPAY',
        costCny: '2.5000',
      },
      {
        id: 'ledger-2',
        attemptId: 'attempt-1',
        entryType: 'REFUND',
        costCny: '-2.5000',
      },
    ]);
    const refunded = await refundPrepayForAttempt(tx, baseArgs);
    expect(refunded).toBe(false);
    // ledger 不增长
    expect(tx._rows.length).toBe(2);
  });

  it('无 PREPAY → return false 不写(防误退)', async () => {
    const tx = makeMockTx([]);
    const refunded = await refundPrepayForAttempt(tx, baseArgs);
    expect(refunded).toBe(false);
    expect(tx._rows.length).toBe(0);
  });

  it('PREPAY 金额 0 → return false 不写(节省 ledger 噪音)', async () => {
    const tx = makeMockTx([
      {
        id: 'ledger-1',
        attemptId: 'attempt-1',
        entryType: 'PREPAY',
        costCny: '0',
      },
    ]);
    const refunded = await refundPrepayForAttempt(tx, baseArgs);
    expect(refunded).toBe(false);
    expect(tx._rows.find((r) => r.entryType === 'REFUND')).toBeUndefined();
  });

  it('连续两次调用:第一次写 REFUND, 第二次 false', async () => {
    const tx = makeMockTx([
      {
        id: 'ledger-1',
        attemptId: 'attempt-1',
        entryType: 'PREPAY',
        costCny: '1.2345',
      },
    ]);
    const first = await refundPrepayForAttempt(tx, baseArgs);
    expect(first).toBe(true);
    const second = await refundPrepayForAttempt(tx, baseArgs);
    expect(second).toBe(false);
    // 只有 1 个 REFUND
    expect(tx._rows.filter((r) => r.entryType === 'REFUND').length).toBe(1);
  });
});
