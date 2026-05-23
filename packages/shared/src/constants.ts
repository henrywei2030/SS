/**
 * 全局常量
 */
export const APP_NAME = 'StarsAlign Studio';
export const APP_NAME_CN = '星垣工坊';
export const APP_TAGLINE_CN = '群星垒垣，万剧汇聚';
export const APP_TAGLINE_EN = 'Where stars form walls; where dramas converge.';
export const APP_VERSION = '0.1.0';
export const APP_LOCALE_DEFAULT = 'zh-CN';

export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const SHOT_PRIORITIES = ['S', 'A', 'B', 'C'] as const;
export type ShotPriorityCode = (typeof SHOT_PRIORITIES)[number];

export const DEFAULT_SHOT_DURATION_S = 5;
export const DEFAULT_MAX_DURATION_S = 10;

// 工作台模块清单（用于权限分配）
export const WORKBENCH_MODULES = [
  'director', // 导演
  'art', // 美术
  'aigc', // AIGC
  'edit', // 剪辑
  'library', // 素材库
  'analytics', // 数据监控
] as const;
export type WorkbenchModule = (typeof WORKBENCH_MODULES)[number];

// ---------------------------------------------------------------------------
// 长度上限(zod schema 与 UI 校验共用,集中管理)
// W1-W7 audit 十二轮:原 prompt max 在 aigc.ts/asset.ts/admin.ts 分别写 20000/5000/50000
// 散落多处,这里统一为单一真相源
// ---------------------------------------------------------------------------

export const MAX_LENGTHS = {
  /** 资产 / 镜头基础提示词上限(用户手编 + LLM 输出) */
  PROMPT: 20_000,
  /** 资产基础描述上限(prompt 之外的描述字段) */
  ASSET_DESCRIPTION: 2_000,
  /** Asset.name / Shot.framing 等短字段 */
  SHORT_NAME: 100,
  /** alias / tag 等数组单项 */
  ALIAS_ITEM: 50,
  /** PromptTemplate.content 后台编辑大上限(管理员可设大 prompt) */
  PROMPT_TEMPLATE: 50_000,
  /** 修改原因 / diffNote */
  DIFF_NOTE: 500,
  /** Provider 输入 instruction */
  EXTRA_INSTRUCTION: 500,
  /** preset value 单项 */
  PRESET_VALUE: 50,
} as const;

/**
 * AI 输出 → 人改 训练样本采集字段集
 * 跨 router 共用(asset.ts / storyboard.ts / aigc.ts 之前各自维护一份重复)
 *
 * SHOT / SHOT_GROUP / SCENE / ASSET 4 类 targetType 都用同一份字段名清单 —
 * 训练数据集 schema 只关心字段名是否在白名单,不关心 target 类型。
 */
export const TRAINABLE_TEXT_FIELDS = [
  // 分镜结构
  'framing',
  'angle',
  'movement',
  'lighting',
  'content',
  'prompt',
  'number',
  // 资产
  'name',
  'description',
] as const;
export type TrainableTextField = (typeof TRAINABLE_TEXT_FIELDS)[number];

// 事件总线 topics
export const EVENT_TOPICS = {
  STORYBOARD_PUBLISHED: 'storyboard.published',
  ASSET_CONFIRMED: 'asset.confirmed',
  ASSET_RETIRED: 'asset.retired',
  GENERATION_QUEUED: 'generation.queued',
  GENERATION_STARTED: 'generation.started',
  GENERATION_COMPLETED: 'generation.completed',
  GENERATION_FAILED: 'generation.failed',
  COST_THRESHOLD_80: 'cost.threshold.80',
  COST_THRESHOLD_100: 'cost.threshold.100',
  COMPLIANCE_FLAGGED: 'compliance.flagged',
} as const;
