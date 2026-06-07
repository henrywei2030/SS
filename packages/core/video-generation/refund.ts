import type { PrismaClient } from '@ss/db';
import type { Prisma } from '@ss/db';
import { billingCycle } from '@ss/shared';

/**
 * Idempotent refund:查 attempt 的 PREPAY entry,若未退过则写 REFUND 抵消。
 *
 * 三十五收工 R2 Phase A:从 aigc.ts:1183-1214 + worker/index.ts:72-104 抽共享 helper。
 * 三十六收工 R2 完整推进:enqueueVideoJobOrRefund / failPlaceholder 也接入同 helper。
 *
 * 调用方负责:
 *   - 在 `$transaction` 内调用(保证 attempt 状态变化 + ledger 写入原子)
 *   - 在调用前已经 update attempt.status = 'FAILED'(本函数不动 attempt,只写 ledger)
 *
 * Idempotent 保证:同 attempt 调用多次只写一次 REFUND ledger entry。
 *
 * **PREPAY=0 跳过 REFUND='0' entry 的设计**(三十六收工 audit 复审):
 *   - 跟原 inline `failPlaceholder` 微差异:原代码 `prepayEstimateCny > 0 ? -X : '0'` 总写 entry
 *   - helper 在 PREPAY 金额 ≤ 0 时 return false 不写 — 节省 ledger 噪音
 *   - 净额都是 0(PREPAY=0 + REFUND=0 = 0 / PREPAY=0 only = 0),经济链路等价
 *   - 真 prod providers(seedance / volcengine)unitPriceCny > 0,不触发此分支
 *   - 仅 Mock provider 单测路径可能触发,审计影响可忽略
 *
 * @returns 是否真写了 REFUND(false = 已退过 / 无 PREPAY / PREPAY 金额 ≤ 0)
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
      billingCycle: billingCycle(),
    },
  });
  return true;
}
