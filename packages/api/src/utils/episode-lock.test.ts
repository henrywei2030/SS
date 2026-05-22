/**
 * W3.1.followup 软锁单测
 *
 * 用内存版 prisma mock 模拟 episode 表 + $transaction + $executeRawUnsafe,
 * 验证:
 *   - 抢锁 / 释放锁正常配对
 *   - 并发场景下第二个抢锁抛 CONFLICT
 *   - stale TTL 自愈
 *   - release 在外部 force-unlock 后是 no-op
 *   - isEpisodeLockedNow 各分支
 */
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  acquireEpisodeLock,
  isEpisodeLockedNow,
  releaseEpisodeLock,
  SOFT_LOCK_TTL_MS,
} from './episode-lock.js';
import type { EpisodeStatus, PrismaClient } from '@ss/db';

// ---------------------------------------------------------------------------
// In-memory prisma mock — 只支持 episode-lock 用到的接口
// ---------------------------------------------------------------------------

type EpisodeRow = {
  id: string;
  status: EpisodeStatus;
  generatingStartedAt: Date | null;
};

function makeMockPrisma(seed: EpisodeRow[]): PrismaClient {
  const rows = new Map<string, EpisodeRow>(seed.map((r) => [r.id, { ...r }]));

  const episode = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const r = rows.get(where.id);
      return r ? { ...r } : null;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<EpisodeRow>;
    }) => {
      const r = rows.get(where.id);
      if (!r) throw new Error('not found');
      Object.assign(r, data);
      return { ...r };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; status?: EpisodeStatus };
      data: Partial<EpisodeRow>;
    }) => {
      const r = rows.get(where.id);
      if (!r) return { count: 0 };
      if (where.status !== undefined && r.status !== where.status) {
        return { count: 0 };
      }
      Object.assign(r, data);
      return { count: 1 };
    },
  };

  type Mock = {
    episode: typeof episode;
    $executeRawUnsafe: (...args: unknown[]) => Promise<number>;
    $transaction: <T>(fn: (tx: Mock) => Promise<T>) => Promise<T>;
  };

  const mock: Mock = {
    episode,
    $executeRawUnsafe: async () => 0,
    $transaction: async (fn) => fn(mock),
  };

  return mock as unknown as PrismaClient;
}

// ---------------------------------------------------------------------------
// acquireEpisodeLock
// ---------------------------------------------------------------------------

describe('acquireEpisodeLock', () => {
  let prisma: PrismaClient;

  beforeEach(() => {
    prisma = makeMockPrisma([
      {
        id: 'ep-not-started',
        status: 'NOT_STARTED',
        generatingStartedAt: null,
      },
      {
        id: 'ep-in-progress',
        status: 'IN_PROGRESS',
        generatingStartedAt: null,
      },
      {
        id: 'ep-fresh-lock',
        status: 'GENERATING',
        generatingStartedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 分钟前,fresh
      },
      {
        id: 'ep-stale-lock',
        status: 'GENERATING',
        generatingStartedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 分钟前,stale
      },
      {
        id: 'ep-orphan-lock',
        status: 'GENERATING',
        generatingStartedAt: null, // 边界:status=GENERATING 但 startedAt=null
      },
    ]);
  });

  it('从 NOT_STARTED 抢锁成功,返回 previousStatus=NOT_STARTED', async () => {
    const token = await acquireEpisodeLock(prisma, 'ep-not-started');
    expect(token.previousStatus).toBe('NOT_STARTED');

    const after = await prisma.episode.findUnique({
      where: { id: 'ep-not-started' },
    });
    expect(after?.status).toBe('GENERATING');
    expect(after?.generatingStartedAt).not.toBeNull();
  });

  it('从 IN_PROGRESS 抢锁,previousStatus=IN_PROGRESS(用于 release 还原)', async () => {
    const token = await acquireEpisodeLock(prisma, 'ep-in-progress');
    expect(token.previousStatus).toBe('IN_PROGRESS');
  });

  it('fresh GENERATING 抢锁失败 — 抛 CONFLICT', async () => {
    await expect(
      acquireEpisodeLock(prisma, 'ep-fresh-lock'),
    ).rejects.toThrow(TRPCError);

    try {
      await acquireEpisodeLock(prisma, 'ep-fresh-lock');
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe('CONFLICT');
    }
  });

  it('stale GENERATING(超 TTL)允许抢回 — previousStatus 退回 NOT_STARTED', async () => {
    const token = await acquireEpisodeLock(prisma, 'ep-stale-lock');
    expect(token.previousStatus).toBe('NOT_STARTED');

    const after = await prisma.episode.findUnique({
      where: { id: 'ep-stale-lock' },
    });
    expect(after?.status).toBe('GENERATING');
  });

  it('orphan lock(GENERATING + startedAt=null)视为 stale,可抢回', async () => {
    const token = await acquireEpisodeLock(prisma, 'ep-orphan-lock');
    expect(token.previousStatus).toBe('NOT_STARTED');
  });

  it('集不存在 → 抛 NOT_FOUND', async () => {
    try {
      await acquireEpisodeLock(prisma, 'ep-does-not-exist');
      expect.fail('应当抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe('NOT_FOUND');
    }
  });

  it('连续两次抢锁:第二次必败(模拟并发请求)', async () => {
    await acquireEpisodeLock(prisma, 'ep-not-started');
    await expect(
      acquireEpisodeLock(prisma, 'ep-not-started'),
    ).rejects.toThrow(TRPCError);
  });
});

// ---------------------------------------------------------------------------
// releaseEpisodeLock
// ---------------------------------------------------------------------------

describe('releaseEpisodeLock', () => {
  it('正常 release:status 还原到 previousStatus,清 startedAt', async () => {
    const prisma = makeMockPrisma([
      {
        id: 'ep-1',
        status: 'IN_PROGRESS',
        generatingStartedAt: null,
      },
    ]);

    const token = await acquireEpisodeLock(prisma, 'ep-1');
    expect(token.previousStatus).toBe('IN_PROGRESS');

    await releaseEpisodeLock(prisma, token);

    const after = await prisma.episode.findUnique({ where: { id: 'ep-1' } });
    expect(after?.status).toBe('IN_PROGRESS');
    expect(after?.generatingStartedAt).toBeNull();
  });

  it('外部已 force-unlock(status≠GENERATING)→ release 是 no-op', async () => {
    const prisma = makeMockPrisma([
      {
        id: 'ep-1',
        status: 'IN_PROGRESS',
        generatingStartedAt: null,
      },
    ]);
    const token = await acquireEpisodeLock(prisma, 'ep-1');

    // 模拟外部 admin.forceUnlock 已介入
    await prisma.episode.update({
      where: { id: 'ep-1' },
      data: { status: 'NOT_STARTED', generatingStartedAt: null },
    });

    // release 不应把 status 错误地改回 IN_PROGRESS
    await releaseEpisodeLock(prisma, token);
    const after = await prisma.episode.findUnique({ where: { id: 'ep-1' } });
    expect(after?.status).toBe('NOT_STARTED');
  });
});

// ---------------------------------------------------------------------------
// isEpisodeLockedNow — 纯函数
// ---------------------------------------------------------------------------

describe('isEpisodeLockedNow', () => {
  it('fresh GENERATING → true', () => {
    expect(
      isEpisodeLockedNow({
        status: 'GENERATING',
        generatingStartedAt: new Date(),
      }),
    ).toBe(true);
  });

  it('stale GENERATING(超 TTL)→ false', () => {
    expect(
      isEpisodeLockedNow({
        status: 'GENERATING',
        generatingStartedAt: new Date(Date.now() - SOFT_LOCK_TTL_MS - 1000),
      }),
    ).toBe(false);
  });

  it('GENERATING + null startedAt → false(orphan)', () => {
    expect(
      isEpisodeLockedNow({
        status: 'GENERATING',
        generatingStartedAt: null,
      }),
    ).toBe(false);
  });

  it('NOT_STARTED → false', () => {
    expect(
      isEpisodeLockedNow({
        status: 'NOT_STARTED',
        generatingStartedAt: null,
      }),
    ).toBe(false);
  });

  it('IN_PROGRESS + 残留 startedAt → false(status 才是真相)', () => {
    expect(
      isEpisodeLockedNow({
        status: 'IN_PROGRESS',
        generatingStartedAt: new Date(),
      }),
    ).toBe(false);
  });
});
