/**
 * Episode 软锁 — W3.1.followup
 *
 * 目标:防 generateForEpisode 重入扣费 / 双写 shot。
 *
 * 机制:
 *   - 入口在事务内用 advisory_xact_lock 串行化对同一 episode 的"抢锁"读写;
 *   - 若 status === GENERATING 且 generatingStartedAt 仍新鲜(< TTL),抛 CONFLICT;
 *   - 否则记录 previousStatus,切 status=GENERATING + 戳 generatingStartedAt = now;
 *   - 业务逻辑跑完后(无论 try 成功还是 catch),finally 内 releaseEpisodeLock 把
 *     status 回滚到 previousStatus 并清 generatingStartedAt。
 *
 * Stale 自愈:超过 SOFT_LOCK_TTL_MS 的 GENERATING 视为死锁,允许抢回(防进程崩溃后永远卡住)。
 *
 * Force unlock:admin.forceUnlockEpisode 端点提供管理员侧逃生口(见 routers/admin.ts)。
 */
import { TRPCError } from '@trpc/server';
import type { EpisodeStatus, PrismaClient } from '@ss/db';

export const SOFT_LOCK_TTL_MS = 15 * 60 * 1000; // 15 分钟

export type EpisodeLockToken = {
  episodeId: string;
  previousStatus: EpisodeStatus;
};

/**
 * 抢 episode 软锁。抢不到抛 TRPCError(code=CONFLICT)。
 * 必须配对调用 releaseEpisodeLock(在 finally 内)。
 */
export async function acquireEpisodeLock(
  prisma: PrismaClient,
  episodeId: string,
): Promise<EpisodeLockToken> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - SOFT_LOCK_TTL_MS);

  return await prisma.$transaction(async (tx) => {
    // advisory lock 让同一 episode 的并发抢锁串行 —— 防 read-then-update 之间的竞态
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext('episode_lock:' || $1)::bigint)`,
      episodeId,
    );

    const ep = await tx.episode.findUnique({
      where: { id: episodeId },
      select: { id: true, status: true, generatingStartedAt: true },
    });
    if (!ep) {
      throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
    }

    const isLocked =
      ep.status === 'GENERATING' &&
      ep.generatingStartedAt !== null &&
      ep.generatingStartedAt > staleBefore;

    if (isLocked) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: '本集正在生成分镜,请稍候(超过 15 分钟未完成请联系管理员强制解锁)',
      });
    }

    // stale 接管:此前 GENERATING 但已过期 → previousStatus 退回 NOT_STARTED
    // (真实历史 status 已被旧 acquire 覆盖,无从恢复;NOT_STARTED 是最保守的回退)
    const previousStatus: EpisodeStatus =
      ep.status === 'GENERATING' ? 'NOT_STARTED' : ep.status;

    await tx.episode.update({
      where: { id: episodeId },
      data: {
        status: 'GENERATING',
        generatingStartedAt: now,
      },
    });

    return { episodeId, previousStatus };
  });
}

/**
 * 释放 episode 软锁,把 status 还原到 previousStatus。
 *
 * 注:只在当前仍持有锁(status==GENERATING)时才回滚,防外部 force-unlock 后
 * 业务逻辑跑完误把 status 改成 stale 值。
 */
export async function releaseEpisodeLock(
  prisma: PrismaClient,
  token: EpisodeLockToken,
): Promise<void> {
  await prisma.episode.updateMany({
    where: { id: token.episodeId, status: 'GENERATING' },
    data: {
      status: token.previousStatus,
      generatingStartedAt: null,
    },
  });
}

/**
 * 入口校验 helper:判断当前 episode 是否处于 fresh GENERATING(用于 publishEpisode 等
 * 不需要抢锁、但需拒绝并发的端点)。
 */
export function isEpisodeLockedNow(episode: {
  status: EpisodeStatus;
  generatingStartedAt: Date | null;
}): boolean {
  if (episode.status !== 'GENERATING') return false;
  if (!episode.generatingStartedAt) return false;
  const staleBefore = new Date(Date.now() - SOFT_LOCK_TTL_MS);
  return episode.generatingStartedAt > staleBefore;
}

/**
 * W1-W5 audit P1 followup(P1-3):长任务 stale TTL 动态续约
 *
 * 用途:generateForEpisode 跑长剧本(>15 min)时,每处理完一段就调一次,把 generatingStartedAt 续到 now。
 * 这样 stale 自愈窗口仍保持 15min(防进程崩溃),但任务本身不会被自己挤死(误判 stale 被抢锁)。
 *
 * 失败不抛错 — 只 log。续约失败本身不影响业务,顶多让 TTL 提前到期被其他请求接管(那时业务也快完了)。
 */
export async function refreshEpisodeLock(
  prisma: PrismaClient,
  episodeId: string,
): Promise<void> {
  try {
    await prisma.episode.updateMany({
      where: { id: episodeId, status: 'GENERATING' },
      data: { generatingStartedAt: new Date() },
    });
  } catch (err) {
    console.error('[refreshEpisodeLock] failed', {
      episodeId,
      err: err instanceof Error ? err.message : err,
    });
  }
}
