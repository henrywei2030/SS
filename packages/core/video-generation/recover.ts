/**
 * 启动时回收孤儿视频 attempt — 进程上次崩溃(SIGKILL)留下的 RUNNING/QUEUED。
 *
 * 策略(一次性任务):不重跑,只标 FAILED + 退 PREPAY(idempotent,复用 refundPrepayForAttempt)。
 * 从 apps/workers boot 抽出(三十六收工逻辑),BullMQ worker 启动 与 桌面 web instrumentation 共用。
 *
 * cutoff = STALE_TIMEOUT_WORKER_BOOT_MS(30min):
 *   - 防多 worker 启动竞态误杀正在跑的真长 job;30min 是「绝对孤儿」阈值。
 *   - 同时扫 QUEUED(占位 attempt 创建即 QUEUED,startedAt=null)防 web 在「QUEUED+PREPAY 后、升 RUNNING 前」
 *     崩溃留下永久挂起的孤儿(只扫 RUNNING 会漏)。startedAt 为 null 时用 createdAt 兜底。
 */
import { prisma } from '@ss/db';

import { isBatchGroupId } from './batch.js';
import { maybeNotifyBatchDone } from './batch-notify.js';
import { STALE_TIMEOUT_WORKER_BOOT_MS } from './constants.js';
import { refundPrepayForAttempt } from './refund.js';

export async function recoverStaleVideoAttempts(
  workerId: string,
): Promise<{ recovered: number; refunded: number }> {
  try {
    const staleCutoff = new Date(Date.now() - STALE_TIMEOUT_WORKER_BOOT_MS);
    const staleAttempts = await prisma.generationAttempt.findMany({
      where: {
        status: { in: ['RUNNING', 'QUEUED'] },
        action: 'VIDEO',
        OR: [
          { startedAt: { lt: staleCutoff } },
          { startedAt: null, createdAt: { lt: staleCutoff } },
        ],
      },
      select: {
        id: true,
        createdBy: true,
        projectId: true,
        episodeId: true,
        providerId: true,
        groupId: true, // 七二:批量标签 — 恢复后补批次完成判定(通知漏发 P2 修)
      },
    });

    let refundedCount = 0;
    for (const stale of staleAttempts) {
      try {
        const refunded = await prisma.$transaction(async (tx) => {
          await tx.generationAttempt.update({
            where: { id: stale.id },
            data: {
              status: 'FAILED',
              errorMsg:
                'worker_restart_recovered: process crashed before attempt completed (QUEUED/RUNNING)',
              finishedAt: new Date(),
            },
          });
          return refundPrepayForAttempt(tx, {
            attemptId: stale.id,
            userId: stale.createdBy,
            projectId: stale.projectId,
            episodeId: stale.episodeId,
            providerId: stale.providerId,
            reason: 'worker_restart_stale_sweep',
          });
        });
        if (refunded) refundedCount++;
        // 七二 P2 修:批量标签 attempt 被 boot 恢复终结 — 若批次因此收尾,worker 终态
        // 路径不会再跑,这里补完成判定(幂等;projectId/episodeId 批量必有,缺则跳过)
        if (isBatchGroupId(stale.groupId) && stale.projectId && stale.episodeId) {
          await maybeNotifyBatchDone(prisma, {
            batchId: stale.groupId,
            userId: stale.createdBy,
            projectId: stale.projectId,
            episodeId: stale.episodeId,
          }).catch((e) =>
            console.warn(
              `[${workerId}] boot 恢复后批次完成判定失败(增强项,忽略)batch=${stale.groupId}:`,
              e instanceof Error ? e.message : e,
            ),
          );
        }
      } catch (perAttemptErr) {
        console.error(
          `[${workerId}] stale sweep: attempt ${stale.id} refund failed (non-fatal):`,
          perAttemptErr,
        );
      }
    }

    if (staleAttempts.length > 0) {
      console.warn(
        `[${workerId}] recovered ${staleAttempts.length} stale QUEUED/RUNNING attempt(s) → marked FAILED, ${refundedCount} PREPAY refunded`,
      );
    }
    return { recovered: staleAttempts.length, refunded: refundedCount };
  } catch (err) {
    console.error(`[${workerId}] stale-attempt sweep failed (non-fatal):`, err);
    return { recovered: 0, refunded: 0 };
  }
}
