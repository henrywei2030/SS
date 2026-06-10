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
export type {
  OptimizeContext,
  OptimizeOutcome,
  OptimizeResult,
  OptimizeDeny,
  PromptContextContributor,
  ProviderFamily,
} from './types.js';
