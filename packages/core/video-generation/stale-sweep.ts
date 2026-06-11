/**
 * Group 级 stale inflight 自愈 + 存活探测 — sweepStaleGroupAttempts
 *
 * 12 维深审落地(即 index.ts Follow-up 预留的 `sweepStaleRunningInGroup`):
 * 从 aigc.generateVideo router 内联块(2026-05-27 audit r13 P0 引入)纯搬运下沉,语义不变:
 *   - 同 shotGroup 的 QUEUED/RUNNING attempt 里,超 staleTimeoutMs 的视为 worker 失踪,
 *     标 FAILED + 退 PREPAY(refundPrepayForAttempt 幂等防双退);
 *   - 返回清理后仍存活的 inflight — 拒绝语义留给调用方(core 不抛 TRPCError)。
 *
 * ⚠️ 必须在事务内、且已持 acquireAigcVideoLock(同 group 串行化)后调用。
 */
import type { Prisma, PrismaClient } from '@ss/db';

import { STALE_TIMEOUT_GROUP_MS } from './constants.js';
import { refundPrepayForAttempt } from './refund.js';

export interface SweepStaleGroupArgs {
  shotGroupId: string;
  userId: string;
  projectId: string;
  episodeId: string | null;
  /** 默认 STALE_TIMEOUT_GROUP_MS(10min);测试注小值用 */
  staleTimeoutMs?: number;
  /** 测试注入固定时刻;生产不传(取 Date.now()) */
  now?: number;
}

export interface SweepStaleGroupResult {
  /** 本次清理(FAILED + 退款)的 stale attempt 数 */
  swept: number;
  /** 清理后仍存活的 inflight(真在跑)— null 表示该 group 可新建 */
  aliveInflight: { id: string; providerId: string } | null;
  /** 七二:被清理 attempt 明细 — 调用方在**事务提交后**对批量标签项补批次完成判定
   * (batchLabel = attempt.groupId,batch_* 才有意义;非批量为 null/普通值由调用方过滤) */
  sweptAttempts: Array<{ id: string; batchLabel: string | null; createdBy: string }>;
}

export async function sweepStaleGroupAttempts(
  tx: Prisma.TransactionClient | PrismaClient,
  args: SweepStaleGroupArgs,
): Promise<SweepStaleGroupResult> {
  const staleTimeoutMs = args.staleTimeoutMs ?? STALE_TIMEOUT_GROUP_MS;
  const now = args.now ?? Date.now();

  const inflightCandidates = await tx.generationAttempt.findMany({
    where: {
      shotGroupId: args.shotGroupId,
      action: 'VIDEO',
      status: { in: ['QUEUED', 'RUNNING'] },
    },
    select: {
      id: true,
      providerId: true,
      startedAt: true,
      createdAt: true,
      groupId: true,
      createdBy: true,
    },
  });
  const staleAttempts = inflightCandidates.filter((a) => {
    const ts = (a.startedAt ?? a.createdAt)?.getTime() ?? now;
    return now - ts > staleTimeoutMs;
  });
  for (const stale of staleAttempts) {
    await tx.generationAttempt.update({
      where: { id: stale.id },
      data: {
        status: 'FAILED',
        errorMsg: `stale RUNNING auto-recovered (>${staleTimeoutMs / 60000}min, worker likely crashed)`,
        finishedAt: new Date(),
      },
    });
    await refundPrepayForAttempt(tx, {
      attemptId: stale.id,
      // 七二修(同六九 cancelQueued 口径):REFUND 归属**原提交者** — 此前记到 args.userId
      // (触发 sweep 的当前操作者),他人重抽他人僵尸时 per-user 花费归因错位
      userId: stale.createdBy,
      projectId: args.projectId,
      episodeId: args.episodeId,
      providerId: stale.providerId,
      reason: 'stale_running_auto_recovered',
    });
  }

  const alive = inflightCandidates.find((a) => !staleAttempts.some((s) => s.id === a.id));
  return {
    swept: staleAttempts.length,
    aliveInflight: alive ? { id: alive.id, providerId: alive.providerId } : null,
    sweptAttempts: staleAttempts.map((s) => ({
      id: s.id,
      batchLabel: s.groupId,
      createdBy: s.createdBy,
    })),
  };
}
