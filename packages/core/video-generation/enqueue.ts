import type { PrismaClient } from '@ss/db';

import { refundPrepayForAttempt } from './refund.js';

/**
 * 入队 BullMQ + 失败回滚 attempt 状态 + 退还 PREPAY
 *
 * 三十六收工 R2 完整推进:从 aigc.ts:1579-1648 抽出(70 行 try/catch + refund → 1 函数)。
 *
 * 业务规则:
 *   - addVideoGenJob 失败时 attempt 已 RUNNING,**必须**单独写 REFUND 退 PREPAY
 *     否则 PREPAY 永久悬挂(用户被扣但任务根本没进队)
 *   - 用 refundPrepayForAttempt helper 统一 refund 写入语义(单一真相源,跟 stale sweep / failPlaceholder 一致)
 *   - throw caller 见到的 error(router 用 sanitizeErrorMsg 脱敏后抛 TRPCError)
 *
 * @throws Error(若入队失败,attempt 已 FAILED + REFUND 写好)
 */
export async function enqueueVideoJobOrRefund<TPayload>(
  prisma: PrismaClient,
  args: {
    attemptId: string;
    startedAt: Date;
    userId: string;
    projectId: string;
    episodeId: string;
    providerId: string;
    payload: TPayload;
    enqueue: (payload: TPayload) => Promise<unknown>;
  },
): Promise<void> {
  try {
    await args.enqueue(args.payload);
  } catch (enqueueErr) {
    // Audit P0-A 修(2026-05-24 audit r21):enqueue 失败时 attempt 已 RUNNING,
    // failPlaceholder 的 updateMany(status='QUEUED') 不会命中,必须独立写 REFUND
    // 否则 PREPAY 永久悬挂 — 用户被扣但任务根本没进队
    const errMsg = enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr);
    const finishedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.generationAttempt.update({
        where: { id: args.attemptId },
        data: {
          status: 'FAILED',
          errorMsg: `enqueue failed: ${errMsg}`,
          finishedAt,
          durationMs: finishedAt.getTime() - args.startedAt.getTime(),
        },
      });
      // 退还 PREPAY — 用共享 helper 统一语义
      await refundPrepayForAttempt(tx, {
        attemptId: args.attemptId,
        userId: args.userId,
        projectId: args.projectId,
        episodeId: args.episodeId,
        providerId: args.providerId,
        reason: 'video_task_enqueue_failed',
      });
    });
    throw enqueueErr;
  }
}
