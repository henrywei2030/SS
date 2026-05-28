import type { PrismaClient } from '@ss/db';
import type { Prisma } from '@ss/db';

/**
 * Idempotent refund:查 attempt 的 PREPAY entry,若未退过则写 REFUND 抵消。
 *
 * 三十五收工 R2 Phase A:从 aigc.ts:1183-1214 + worker/index.ts:72-104 抽共享 helper。
 * 两处实现完全一致(idempotent 防双写 + parentEntryId 链接),抽出来减少 drift。
 *
 * 调用方负责:
 *   - 在 `$transaction` 内调用(保证 attempt 状态变化 + ledger 写入原子)
 *   - 在调用前已经 update attempt.status = 'FAILED'(本函数不动 attempt,只写 ledger)
 *
 * Idempotent 保证:同 attempt 调用多次只写一次 REFUND ledger entry。
 *
 * @returns 是否真写了 REFUND(false = 已退过 / 无 PREPAY / PREPAY 金额为 0)
 */
export async function refundPrepayForAttempt(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    attemptId: string;
    userId: string;
    projectId: string;
    episodeId: string | null;
    providerId: string;
    reason: string;
  },
): Promise<boolean> {
  // 防双写:已有 REFUND 直接退出
  const existingRefund = await tx.costLedgerEntry.findFirst({
    where: { attemptId: args.attemptId, entryType: 'REFUND' },
    select: { id: true },
  });
  if (existingRefund) return false;

  // 查 PREPAY 拿原扣额
  const prepay = await tx.costLedgerEntry.findFirst({
    where: { attemptId: args.attemptId, entryType: 'PREPAY' },
    select: { id: true, costCny: true },
  });
  if (!prepay || Number(prepay.costCny) <= 0) return false;

  await tx.costLedgerEntry.create({
    data: {
      userId: args.userId,
      projectId: args.projectId,
      episodeId: args.episodeId,
      attemptId: args.attemptId,
      providerId: args.providerId,
      modelId: args.providerId,
      action: 'video.generate',
      inputUnits: 0,
      outputUnits: 0,
      unitPriceCny: '0',
      costCny: `-${prepay.costCny}`,
      success: true,
      entryType: 'REFUND',
      refundReason: args.reason,
      parentEntryId: prepay.id,
      billingCycle: new Date().toISOString().slice(0, 7),
    },
  });
  return true;
}
