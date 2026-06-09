/**
 * Video generation core helpers
 *
 * 三十五收工 R2 Phase A + 三十六收工 R2 完整推进:从 aigc.generateVideo mutation + worker boot 抽共享 helper。
 *
 * 当前覆盖:
 *   - `acquireAigcVideoLock` — pg advisory lock per shotGroup(事务内)
 *   - `refundPrepayForAttempt` — idempotent PREPAY → REFUND ledger 写入(单一真相源)
 *   - `STALE_TIMEOUT_GROUP_MS` / `STALE_TIMEOUT_WORKER_BOOT_MS` — router 10min / worker 30min
 *   - `checkDailyVideoBudget` — 每日 video.generate 预算 Decimal 累加守卫
 *   - `createPlaceholderAttemptWithPrepay` — 占位 attempt(QUEUED)+ PREPAY ledger 同事务写入
 *   - `compileVideoPromptForGroup` — project style + bindings + media + refs + compileShotGroupVideoPrompt
 *   - `enqueueVideoJobOrRefund` — BullMQ push + 失败时 attempt FAILED + REFUND
 *
 *   - `sweepStaleGroupAttempts` — 同 group stale 自愈 + 存活探测(12 维深审落地,原 Follow-up
 *     `sweepStaleRunningInGroup`;inflight 拒绝语义留 router — core 不抛 TRPCError)
 */
export {
  STALE_TIMEOUT_GROUP_MS,
  STALE_TIMEOUT_WORKER_BOOT_MS,
} from './constants.js';
export { acquireAigcVideoLock } from './lock.js';
export { refundPrepayForAttempt } from './refund.js';
export { checkDailyVideoBudget } from './budget-check.js';
export { createPlaceholderAttemptWithPrepay } from './prepay.js';
export { compileVideoPromptForGroup } from './compile.js';
export { enqueueVideoJobOrRefund } from './enqueue.js';
// 桌面化 Phase 1:processor 搬进 core(解耦 BullMQ),BullMQ worker 与进程内驱动共用
export {
  processVideoGenJob,
  type JobContext,
  type ProcessResult,
} from './process-job.js';
export { recoverStaleVideoAttempts } from './recover.js';
export {
  sweepStaleGroupAttempts,
  type SweepStaleGroupArgs,
  type SweepStaleGroupResult,
} from './stale-sweep.js';
