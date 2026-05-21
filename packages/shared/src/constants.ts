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
