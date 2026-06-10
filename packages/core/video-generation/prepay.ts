import type { PrismaClient } from '@ss/db';
import type { Prisma } from '@ss/db';
import { billingCycle } from '@ss/shared';

/**
 * 创建占位 attempt(status=QUEUED)+ PREPAY ledger 同事务写入
 *
 * 三十六收工 R2 完整推进:从 aigc.ts:1226-1245 抽出。
 *
 * 业务规则:
 *   - 必须在 acquireAigcVideoLock(tx, groupId) 之后调用,避免并发竞态
 *   - PREPAY 永远 success=true(预扣动作成功);task 成败用 attempt.status,后续 REFUND 抵消
 *   - inputJson 写 placeholder 标识,后续真 attempt 升 RUNNING 时 update 真 prompt
 *
 * @returns 占位 attempt + PREPAY entry id(router 缓存供 failPlaceholder / enqueue fail 时 refund)
 */
export async function createPlaceholderAttemptWithPrepay(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    userId: string;
    projectId: string;
    episodeId: string;
    shotGroupId: string;
    providerId: string;
    durationS: number;
    prepayEstimateCny: number;
    /** F4 批量:同批次 attempt 共享标签(写 GenerationAttempt.groupId,batch_ 前缀)— 重抽/完成通知按它聚合 */
    attemptGroupId?: string;
  },
): Promise<{ attempt: { id: string }; prepayEntryId: string }> {
  const attempt = await tx.generationAttempt.create({
    data: {
      projectId: args.projectId,
      episodeId: args.episodeId,
      shotGroupId: args.shotGroupId,
      providerId: args.providerId,
      modelId: args.providerId,
      action: 'VIDEO',
      inputJson: { kind: 'aigc.generateVideo.placeholder' },
      groupId: args.attemptGroupId,
      outputMediaIds: [],
      inputUnits: 0,
      outputUnits: 0,
      unitPriceCny: '0',
      costCny: '0',
      status: 'QUEUED',
      createdBy: args.userId,
    },
    select: { id: true },
  });
  // Phase 1.5 P0-1:同事务写 PREPAY entry(预扣占额)— worker 完成时写 REFUND 抵消
  const prepay = await tx.costLedgerEntry.create({
    data: {
      userId: args.userId,
      projectId: args.projectId,
      episodeId: args.episodeId,
      attemptId: attempt.id,
      providerId: args.providerId,
      modelId: args.providerId,
      action: 'video.generate',
      inputUnits: args.durationS,
      outputUnits: 0,
      unitPriceCny: '0',
      costCny: args.prepayEstimateCny.toFixed(4),
      success: true, // PREPAY 永远 success=true;task 成败用 attempt.status,后续 REFUND 抵消
      entryType: 'PREPAY',
      billingCycle: billingCycle(),
    },
    select: { id: true },
  });
  return { attempt: { id: attempt.id }, prepayEntryId: prepay.id };
}
