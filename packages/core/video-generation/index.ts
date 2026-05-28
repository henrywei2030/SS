/**
 * Video generation core helpers
 *
 * 三十五收工 R2 Phase A:从 aigc.generateVideo mutation + worker boot 抽共享 helper。
 *
 * 当前覆盖(Phase A):
 *   - `acquireAigcVideoLock` — pg advisory lock per shotGroup(事务内)
 *   - `refundPrepayForAttempt` — idempotent PREPAY → REFUND ledger 写入
 *   - `STALE_TIMEOUT_GROUP_MS` / `STALE_TIMEOUT_WORKER_BOOT_MS` — 两套语义不同的 stale 阈值
 *
 * Follow-up(R2 design 完整方案,Phase B-D 留下次):
 *   - `sweepStaleRunning(tx, groupId)` — 同 group 短窗口扫(router 用)
 *   - `sweepStaleRunningGlobal(prisma)` — 全库长窗口扫(worker boot 用)
 *   - `checkInflightAndThrow(tx, groupId)` — 同 group inflight 拒绝逻辑
 *   - `checkBudget(tx, userId, projectId, unitPriceCny)` — 预算守卫
 *   - `compileVideoPrompt(tx, group, input)` — token 拼接 + binding 读
 *   - `createPrepayAttempt(tx, args)` — placeholder QUEUED attempt + PREPAY ledger
 *   - `enqueueVideoJob(attemptId, compiled)` — BullMQ push + SSE token 签发
 *   - 每模块 1-2 unit test(Phase D 目标:tests 95 → 115+)
 */
export {
  STALE_TIMEOUT_GROUP_MS,
  STALE_TIMEOUT_WORKER_BOOT_MS,
} from './constants.js';
export { acquireAigcVideoLock } from './lock.js';
export { refundPrepayForAttempt } from './refund.js';
