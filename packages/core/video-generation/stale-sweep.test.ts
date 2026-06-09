/**
 * sweepStaleGroupAttempts 单测(12 维深审落地)
 *
 * 覆盖:无 inflight / 全 stale(标 FAILED + 退 PREPAY)/ 存活拒绝探测 / stale 无 PREPAY 不误退。
 * mock tx 模式沿用 refund.test.ts(纯对象,不连 DB)。
 */
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@ss/db';

import { sweepStaleGroupAttempts } from './stale-sweep.js';

type AttemptRow = {
  id: string;
  shotGroupId: string;
  providerId: string;
  status: string;
  startedAt: Date | null;
  createdAt: Date;
  errorMsg?: string;
};
type LedgerRow = {
  id: string;
  attemptId: string;
  entryType: 'PREPAY' | 'REFUND';
  costCny: string;
};

function makeMockTx(attempts: AttemptRow[], ledger: LedgerRow[]) {
  const attemptRows = attempts.map((r) => ({ ...r }));
  const ledgerRows: LedgerRow[] = ledger.map((r) => ({ ...r }));

  return {
    generationAttempt: {
      findMany: async ({ where }: { where: { shotGroupId: string; status: { in: string[] } } }) =>
        attemptRows
          .filter((a) => a.shotGroupId === where.shotGroupId && where.status.in.includes(a.status))
          .map((a) => ({
            id: a.id,
            providerId: a.providerId,
            startedAt: a.startedAt,
            createdAt: a.createdAt,
          })),
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status: string; errorMsg: string };
      }) => {
        const row = attemptRows.find((a) => a.id === where.id);
        if (!row) throw new Error('attempt not found');
        row.status = data.status;
        row.errorMsg = data.errorMsg;
        return { ...row };
      },
    },
    costLedgerEntry: {
      findFirst: async ({
        where,
      }: {
        where: { attemptId: string; entryType: 'PREPAY' | 'REFUND' };
      }) => {
        const r = ledgerRows.find(
          (x) => x.attemptId === where.attemptId && x.entryType === where.entryType,
        );
        return r ? { ...r } : null;
      },
      create: async ({ data }: { data: Omit<LedgerRow, 'id'> & Record<string, unknown> }) => {
        const entry = { id: `ledger-${ledgerRows.length + 1}`, ...data } as LedgerRow;
        ledgerRows.push(entry);
        return entry;
      },
    },
    _attempts: attemptRows,
    _ledger: ledgerRows,
  } as unknown as PrismaClient & { _attempts: AttemptRow[]; _ledger: LedgerRow[] };
}

const NOW = 1_750_000_000_000;
const TIMEOUT = 10 * 60 * 1000;
const baseArgs = {
  shotGroupId: 'grp-1',
  userId: 'u-1',
  projectId: 'p-1',
  episodeId: 'ep-1',
  staleTimeoutMs: TIMEOUT,
  now: NOW,
};
const ago = (ms: number) => new Date(NOW - ms);

describe('sweepStaleGroupAttempts', () => {
  it('无 inflight → swept=0,aliveInflight=null', async () => {
    const tx = makeMockTx([], []);
    const r = await sweepStaleGroupAttempts(tx, baseArgs);
    expect(r).toEqual({ swept: 0, aliveInflight: null });
  });

  it('stale RUNNING → 标 FAILED + 退 PREPAY,alive=null', async () => {
    const tx = makeMockTx(
      [
        {
          id: 'a-1',
          shotGroupId: 'grp-1',
          providerId: 'seedance-2.0',
          status: 'RUNNING',
          startedAt: ago(TIMEOUT + 60_000),
          createdAt: ago(TIMEOUT + 120_000),
        },
      ],
      [{ id: 'l-1', attemptId: 'a-1', entryType: 'PREPAY', costCny: '2.0000' }],
    );
    const r = await sweepStaleGroupAttempts(tx, baseArgs);
    expect(r.swept).toBe(1);
    expect(r.aliveInflight).toBeNull();
    expect(tx._attempts[0]!.status).toBe('FAILED');
    expect(tx._attempts[0]!.errorMsg).toContain('stale RUNNING auto-recovered');
    const refund = tx._ledger.find((l) => l.entryType === 'REFUND');
    expect(refund?.attemptId).toBe('a-1');
  });

  it('存活 inflight(窗口内)→ 不清理,原样返回供调用方拒绝', async () => {
    const tx = makeMockTx(
      [
        {
          id: 'a-2',
          shotGroupId: 'grp-1',
          providerId: 'seedance-2.0',
          status: 'RUNNING',
          startedAt: ago(60_000), // 1min 前,新鲜
          createdAt: ago(120_000),
        },
      ],
      [],
    );
    const r = await sweepStaleGroupAttempts(tx, baseArgs);
    expect(r.swept).toBe(0);
    expect(r.aliveInflight).toEqual({ id: 'a-2', providerId: 'seedance-2.0' });
    expect(tx._attempts[0]!.status).toBe('RUNNING'); // 没被动
  });

  it('stale 但无 PREPAY(如 mock 0 费)→ 仍标 FAILED,不写 REFUND(防误退)', async () => {
    const tx = makeMockTx(
      [
        {
          id: 'a-3',
          shotGroupId: 'grp-1',
          providerId: 'local-mock',
          status: 'QUEUED',
          startedAt: null,
          createdAt: ago(TIMEOUT + 60_000), // startedAt null → 用 createdAt 判 stale
        },
      ],
      [],
    );
    const r = await sweepStaleGroupAttempts(tx, baseArgs);
    expect(r.swept).toBe(1);
    expect(tx._attempts[0]!.status).toBe('FAILED');
    expect(tx._ledger.filter((l) => l.entryType === 'REFUND')).toHaveLength(0);
  });

  it('stale + 存活混合 → 只清 stale,alive 返回存活那条', async () => {
    const tx = makeMockTx(
      [
        {
          id: 'old',
          shotGroupId: 'grp-1',
          providerId: 'seedance-2.0',
          status: 'RUNNING',
          startedAt: ago(TIMEOUT + 1),
          createdAt: ago(TIMEOUT + 2),
        },
        {
          id: 'fresh',
          shotGroupId: 'grp-1',
          providerId: 'seedance-fast',
          status: 'QUEUED',
          startedAt: ago(1000),
          createdAt: ago(2000),
        },
      ],
      [{ id: 'l-1', attemptId: 'old', entryType: 'PREPAY', costCny: '1.5000' }],
    );
    const r = await sweepStaleGroupAttempts(tx, baseArgs);
    expect(r.swept).toBe(1);
    expect(r.aliveInflight?.id).toBe('fresh');
    expect(tx._attempts.find((a) => a.id === 'old')!.status).toBe('FAILED');
    expect(tx._attempts.find((a) => a.id === 'fresh')!.status).toBe('QUEUED');
  });
});
