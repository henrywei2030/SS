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
 * Follow-up(留下次):
 *   - `sweepStaleRunningInGroup(tx, groupId)` — 同 group 短窗口 sweep(目前 router 内联)
 *   - `checkInflightAndThrow(tx, groupId)` — 同 group inflight 拒绝(目前 router 内联,跟 lock 紧耦合)
 *   - 单测(R2 Phase D)— 每模块 1-2 unit test,目标 95→115+ tests
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
