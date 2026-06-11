import type { PrismaClient } from '@ss/db';
import type { Prisma } from '@ss/db';
import { Prisma as PrismaNamespace } from '@ss/db';

/**
 * 每日视频预算守卫 — Decimal 精确累加防 IEEE-754 漂移
 *
 * 三十六收工 R2 完整推进:从 aigc.ts:1318-1340 抽出。
 *
 * 业务规则:
 *   - 同一 project 同一日(本地 0 点)video.generate 已 spent + 本次 prepay > dailyBudgetCny → 拒
 *   - 排除当前 attempt 自己的 PREPAY(防 self-counting 误判)
 *
 * @returns null 表示通过,非 null 表示拒绝的人类可读理由(router 直接传给 failPlaceholder)
 */
export async function checkDailyVideoBudget(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    projectId: string;
    dailyBudgetCny: number;
    prepayEstimateCny: number;
    excludeAttemptId: string;
    /** F5b(七二)并抽:对决两占位都已写 PREPAY,须双双排除防自重复计;
     * 传了即覆盖 excludeAttemptId(单占位调用方不传,行为不变)。 */
    excludeAttemptIds?: string[];
  },
): Promise<string | null> {
  if (args.dailyBudgetCny <= 0) return null; // 0 / 负 = 不限

  // 三十九收工 audit:用 UTC 算"今天"边界,跟 insights.ts 一致,跨 server timezone 稳定
  //   (DB createdAt 存 UTC;原 setHours 用 server local 时区会让"今天"边界偏移几小时)
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const excludeIds =
    args.excludeAttemptIds && args.excludeAttemptIds.length > 0
      ? args.excludeAttemptIds
      : [args.excludeAttemptId];
  const todaySpent = await tx.costLedgerEntry.aggregate({
    where: {
      projectId: args.projectId,
      action: 'video.generate',
      success: true,
      createdAt: { gte: todayStart },
      attemptId: { notIn: excludeIds }, // 排除当前(对决时为两个)attempt 已写入的 PREPAY
    },
    _sum: { costCny: true },
  });
  const spentDec = new PrismaNamespace.Decimal(todaySpent._sum.costCny ?? 0);
  const estimateDec = new PrismaNamespace.Decimal(args.prepayEstimateCny);
  const limitDec = new PrismaNamespace.Decimal(args.dailyBudgetCny);
  if (spentDec.plus(estimateDec).gt(limitDec)) {
    return `今日视频预算已用 ${spentDec.toFixed(2)}¥ / 上限 ${args.dailyBudgetCny}¥,本次预估 ${estimateDec.toFixed(2)}¥ 会超限`;
  }
  return null;
}
