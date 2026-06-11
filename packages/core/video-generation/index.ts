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
export {
  compileVideoPromptForGroup,
  collectCharacterVoiceInfo,
  type CharacterVoiceRef,
  type CharacterVoiceMissing,
  type CharacterImageRef,
} from './compile.js';
export { enqueueVideoJobOrRefund } from './enqueue.js';
// M4 先决重构:generateVideo 主体下沉(锁/sweep/占位/预算/编译/合规/入队)— core 返判别,
// TRPCError 留 router;F4 batch 复用此单一真相源逐组提交
export {
  submitVideoGeneration,
  type SubmitVideoArgs,
  type SubmitVideoGroup,
  type SubmitVideoResult,
  type SubmitVideoDenyCode,
} from './submit.js';
// W7 audit R8 P0 脱敏 helper(M4 随 submit 下沉自 api/utils,inputJson 写入与 submit 同层)
export {
  sanitizePromptForLedger,
  sanitizeReferencesForLedger,
  type RawVideoReference,
} from './sanitize-prompt.js';
// F4 批量:binding 解析下沉(worker 重抽与 router 同一真相源)+ 纯函数层 + 终态跟进
export { loadVideoGenBindings, type VideoGenBindings } from './bindings.js';
export {
  BATCH_GROUP_PREFIX,
  BATCH_RETRY_MAX_KEY,
  batchDurationS,
  candidateRank,
  isBatchGroupId,
  orderBatchCandidates,
  parseBatchRetryMax,
  parseProductionPlanPriorities,
  type BatchGroupCandidate,
  type BatchPriority,
} from './batch.js';
export { handleBatchTerminal, type BatchTerminalArgs } from './batch-followup.js';
// 七二 P2 修:批次完成判定独立导出 — API 侧终结点(全 denied / sweep / boot 恢复)补判用
export { maybeNotifyBatchDone, type BatchDoneCheckArgs } from './batch-notify.js';
// 桌面化 Phase 1:processor 搬进 core(解耦 BullMQ),BullMQ worker 与进程内驱动共用
export {
  processVideoGenJob,
  type JobContext,
  type ProcessResult,
} from './process-job.js';
export { recoverStaleVideoAttempts } from './recover.js';
// F5b-b(七二):provider 健康度 + failover 解析
export {
  FALLBACK_PROVIDERS_KEY,
  recordProviderOutcome,
  resolveHealthyVideoProvider,
  type FailoverResolution,
} from './provider-health.js';
export {
  sweepStaleGroupAttempts,
  type SweepStaleGroupArgs,
  type SweepStaleGroupResult,
} from './stale-sweep.js';
