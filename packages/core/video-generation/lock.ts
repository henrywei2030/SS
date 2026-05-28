import type { PrismaClient } from '@ss/db';
import type { Prisma } from '@ss/db';

/**
 * Acquire postgres advisory lock for AIGC video generation, scoped to a shotGroup.
 *
 * 三十五收工 R2 Phase A:从 aigc.ts:1151-1154 抽出独立 helper。
 *
 * 必须在 `$transaction` 内调用 — `pg_advisory_xact_lock` 在 transaction commit/rollback
 * 时自动释放;若在 implicit transaction(单条 raw)立即释放,串行化失效。
 *
 * 锁 key:`hashtext('aigc_video:' || groupId)::bigint` —
 *   - hashtext 把字符串 hash 成 32 位 int
 *   - 加前缀 'aigc_video:' 隔离不同 lock 域,避免跨业务碰撞
 *   - groupId 是 cuid,唯一性足够强
 */
export async function acquireAigcVideoLock(
  tx: Prisma.TransactionClient | PrismaClient,
  groupId: string,
): Promise<void> {
  await tx.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock(hashtext('aigc_video:' || $1)::bigint)`,
    groupId,
  );
}
