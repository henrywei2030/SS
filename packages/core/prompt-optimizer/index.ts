/** M6 动态 Prompt 优化(蓝图 docs/06 §5)— 优化器层 + ContextContributor 架构 */
export {
  optimizeGroupPrompt,
  buildOptimizerUserPrompt,
  OPTIMIZER_BINDING_KEY,
  OPTIMIZER_CONTRIBUTORS_KEY,
  type OptimizeGroupArgs,
} from './optimize.js';
export { loadOptimizeContext } from './context.js';
export {
  applyOptimizedPrompt,
  checkTextBudgetForOptimize,
  type ApplyOptimizedArgs,
  type ApplyOptimizedResult,
} from './apply.js';
export {
  processOptimizeEpisodeJob,
  OPTIMIZE_EPISODE_JOB_KIND,
  OptimizeEpisodeJobDataSchema,
  type OptimizeEpisodeJobData,
} from './process-episode.js';
export {
  PROMPT_OPTIMIZER_SLUG,
  PROMPT_OPTIMIZER_FALLBACK,
  buildFamilyDirective,
  detectProviderFamily,
} from './fallback-template.js';
export {
  extractAtTokens,
  findLostTokens,
  parseEnabledContributors,
  stripLlmWrapping,
  DEFAULT_CONTRIBUTORS,
} from './guards.js';
export { ALL_CONTRIBUTORS } from './contributors/index.js';
// H2(docs/07):硬门 / 判官 / 深度编排
export {
  runHardGates,
  parseAbstractBlacklist,
  DEFAULT_ABSTRACT_BLACKLIST,
  type HardGateViolation,
} from './checkers.js';
export {
  runJudge,
  sanitizeJudgeVerdict,
  buildJudgeUserPrompt,
  JUDGE_BINDING_KEY,
  JUDGE_REPAIR_THRESHOLD,
  PROMPT_JUDGE_SLUG,
  PROMPT_JUDGE_FALLBACK,
  type JudgeVerdict,
} from './judge.js';
export {
  deepOptimizeGroupPrompt,
  MAX_REPAIR_ITERATIONS,
  type DeepOptimizeOutcome,
  type DeepOptimizeOk,
  type DeepOptimizeDeny,
  type OptimizeStage,
} from './deep-optimize.js';
export { recordOptimizeRun, type RecordOptimizeRunArgs } from './run-record.js';
export { runSyncHardGates } from './optimize.js';
export type {
  OptimizeContext,
  OptimizeOutcome,
  OptimizeResult,
  OptimizeDeny,
  PromptContextContributor,
  ProviderFamily,
} from './types.js';
