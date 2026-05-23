/**
 * @ss/shared/events — 事件总线 Topic 集中定义
 *
 * 任何在 EventBus 上发布/订阅的事件必须先在此处声明，包括：
 *   - 常量字符串（topic 名）
 *   - Payload TypeScript 类型
 *
 * 这样能保证：
 *   - 跨包订阅时不会出现 typo
 *   - Payload 形状一致，便于 TS 自动推断
 *   - Phase 2/3 新增模块（Compliance/Voice/Distribution）有规范的接入点
 *
 * 命名规范：`{domain}.{action}` 全小写，名词在前
 *   ✓ storyboard.published
 *   ✗ publishStoryboard
 *
 * ⚠️ 启用状态(W1-W5 audit 三轮 E2):
 *   Phase 1(W5.4)阶段,**只有 `GENERATION_COMPLETED`(kind=video)**真的被 publish
 *   (在 packages/api/src/routers/aigc.ts:generateVideo onSuccess)。
 *   其它所有 topic 定义齐全但 **router 端尚未 publish** — 订阅方不会收到。
 *   全量启用排在 W6 剪辑模块 + W5.5 BullMQ worker 一起落地。
 *   接手人:加 publish 时跟着这里的 PayloadMap 类型走,跨包订阅自动得到类型 hint。
 */

// ============================================================================
// § 1. Topic 常量
// ============================================================================

export const EVENTS = {
  /* —— 项目 / 集 —— */
  PROJECT_CREATED: 'project.created',
  PROJECT_ARCHIVED: 'project.archived',
  EPISODE_PUBLISHED: 'episode.published',
  EPISODE_ASSIGNED: 'episode.assigned',

  /* —— 剧本 / 分析 —— */
  SCRIPT_UPLOADED: 'script.uploaded',
  SCRIPT_ANALYSIS_QUEUED: 'script.analysis.queued',
  SCRIPT_ANALYSIS_COMPLETED: 'script.analysis.completed',
  SCRIPT_ANALYSIS_FAILED: 'script.analysis.failed',

  /* —— 分镜 —— */
  STORYBOARD_GENERATED: 'storyboard.generated',
  STORYBOARD_PUBLISHED: 'storyboard.published',
  STORYBOARD_SHOT_MERGED: 'storyboard.shot.merged',
  STORYBOARD_SHOT_REORDERED: 'storyboard.shot.reordered',

  /* —— 数字资产 —— */
  ASSET_BREAKDOWN_STARTED: 'asset.breakdown.started',
  ASSET_BREAKDOWN_COMPLETED: 'asset.breakdown.completed',
  ASSET_GENERATED: 'asset.generated',
  ASSET_CONFIRMED: 'asset.confirmed',
  ASSET_RETIRED: 'asset.retired',
  ASSET_COMPLIANCE_CHECKED: 'asset.compliance.checked',

  /* —— AIGC 抽卡 —— */
  GENERATION_QUEUED: 'generation.queued',
  GENERATION_STARTED: 'generation.started',
  GENERATION_COMPLETED: 'generation.completed',
  GENERATION_FAILED: 'generation.failed',
  GENERATION_ADOPTED: 'generation.adopted',
  GENERATION_REJECTED: 'generation.rejected',
  GENERATION_AUTO_SALVAGED: 'generation.auto_salvaged', // Phase 2

  /* —— 媒体库 —— */
  MEDIA_UPLOADED: 'media.uploaded',
  MEDIA_TAGGED: 'media.tagged',
  MEDIA_DELETED: 'media.deleted',

  /* —— 剪辑 / 成片 —— */
  EDIT_TIMELINE_UPDATED: 'edit.timeline.updated', // Phase 2
  EDIT_REEL_EXPORTED: 'edit.reel.exported', // Phase 2

  /* —— 合规 —— */
  COMPLIANCE_FLAGGED: 'compliance.flagged',
  COMPLIANCE_APPROVED: 'compliance.approved',
  COMPLIANCE_REJECTED: 'compliance.rejected',

  /* —— 配音 / 音频 —— */
  VOICE_GENERATED: 'voice.generated', // Phase 2
  VOICE_CLONED: 'voice.cloned', // Phase 2

  /* —— 发行 —— */
  DISTRIBUTION_PUBLISHED: 'distribution.published', // Phase 3
  DISTRIBUTION_METRICS_INGESTED: 'distribution.metrics.ingested', // Phase 3

  /* —— 成本 / 预算 —— */
  COST_LEDGER_RECORDED: 'cost.ledger.recorded',
  COST_THRESHOLD_50: 'cost.threshold.50',
  COST_THRESHOLD_80: 'cost.threshold.80',
  COST_THRESHOLD_100: 'cost.threshold.100',
  BUDGET_EXCEEDED: 'cost.budget.exceeded',

  /* —— 团队 / 通知 —— */
  USER_INVITED: 'user.invited',
  USER_JOINED_PROJECT: 'user.joined_project',
  COMMENT_CREATED: 'comment.created', // Phase 2
  MENTION_FIRED: 'mention.fired', // Phase 2

  /* —— 系统 —— */
  PROVIDER_HEALTH_DEGRADED: 'provider.health.degraded',
  PROVIDER_API_KEY_UPDATED: 'provider.api_key.updated',
  SYSTEM_SETTING_CHANGED: 'system.setting.changed',
} as const;

export type EventTopic = (typeof EVENTS)[keyof typeof EVENTS];

// ============================================================================
// § 2. Payload 类型映射
// 业务发布时 `bus.publish<EventPayload['xxx']>(EVENTS.XXX, payload)` 自动类型校验
// ============================================================================

export interface EventPayload {
  [EVENTS.PROJECT_CREATED]: {
    projectId: string;
    name: string;
    ownerId: string;
    type: string;
  };
  [EVENTS.PROJECT_ARCHIVED]: { projectId: string; archivedBy: string };
  [EVENTS.EPISODE_PUBLISHED]: {
    episodeId: string;
    projectId: string;
    number: number;
    version: number;
  };
  [EVENTS.EPISODE_ASSIGNED]: {
    episodeId: string;
    userId: string;
    role: 'OWNER' | 'COLLAB' | 'REVIEWER';
  };

  [EVENTS.SCRIPT_UPLOADED]: { scriptId: string; episodeId: string; projectId: string };
  [EVENTS.SCRIPT_ANALYSIS_QUEUED]: { analysisId: string; scriptId: string };
  [EVENTS.SCRIPT_ANALYSIS_COMPLETED]: {
    analysisId: string;
    scriptId: string;
    overallScore: number;
    costCny: number;
  };
  [EVENTS.SCRIPT_ANALYSIS_FAILED]: {
    analysisId: string;
    scriptId: string;
    error: string;
  };

  [EVENTS.STORYBOARD_GENERATED]: { episodeId: string; shotCount: number };
  [EVENTS.STORYBOARD_PUBLISHED]: {
    episodeId: string;
    projectId: string;
    version: number;
    shotIds: string[];
  };
  [EVENTS.STORYBOARD_SHOT_MERGED]: { episodeId: string; mergedShotId: string; sourceIds: string[] };
  [EVENTS.STORYBOARD_SHOT_REORDERED]: { episodeId: string; orderedIds: string[] };

  [EVENTS.ASSET_BREAKDOWN_STARTED]: { projectId: string; episodeId?: string };
  [EVENTS.ASSET_BREAKDOWN_COMPLETED]: { projectId: string; assetIds: string[] };
  [EVENTS.ASSET_GENERATED]: { assetId: string; version: number; mediaItemId: string };
  [EVENTS.ASSET_CONFIRMED]: { assetId: string; confirmedBy: string };
  [EVENTS.ASSET_RETIRED]: { assetId: string; retiredBy: string };
  [EVENTS.ASSET_COMPLIANCE_CHECKED]: {
    assetId: string;
    approved: boolean;
    complianceId?: string;
  };

  [EVENTS.GENERATION_QUEUED]: {
    attemptId: string;
    /** W3 shot-level 抽卡(图片 candidate)/ null = W5 group-level 视频抽卡 */
    shotId: string | null;
    shotGroupId?: string | null; // W5.4 加
    providerId: string;
  };
  [EVENTS.GENERATION_STARTED]: { attemptId: string };
  /**
   * W1-W5 audit 三轮 E1:payload 改 union 兼容 W3 shot 级(图片)和 W5 group 级(视频)。
   * `kind` 区分:'image' 时 shotId/mediaItemId 必填;'video' 时 shotGroupId/videoUrl 必填。
   */
  [EVENTS.GENERATION_COMPLETED]:
    | {
        kind: 'image';
        attemptId: string;
        shotId: string;
        mediaItemId: string;
        durationS?: number;
        costCny: number;
      }
    | {
        kind: 'video';
        attemptId: string;
        shotGroupId: string;
        episodeId: string | null;
        projectId: string;
        providerId: string;
        mediaId: string;
        videoUrl: string;
        durationS: number;
        costCny: number;
      };
  [EVENTS.GENERATION_FAILED]: {
    attemptId: string;
    shotId?: string | null;
    shotGroupId?: string | null;
    error: string;
  };
  [EVENTS.GENERATION_ADOPTED]: { attemptId: string; adoptedBy: string };
  [EVENTS.GENERATION_REJECTED]: { attemptId: string; rejectedBy: string };
  [EVENTS.GENERATION_AUTO_SALVAGED]: {
    attemptId: string;
    salvagedClipIds: string[];
    secondsRecovered: number;
  };

  [EVENTS.MEDIA_UPLOADED]: {
    mediaId: string;
    projectId?: string;
    kind: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'THREE_D' | 'OTHER';
  };
  [EVENTS.MEDIA_TAGGED]: { mediaId: string; tags: string[] };
  [EVENTS.MEDIA_DELETED]: { mediaId: string };

  [EVENTS.EDIT_TIMELINE_UPDATED]: { episodeId: string; updatedBy: string };
  [EVENTS.EDIT_REEL_EXPORTED]: { episodeId: string; reelId: string; format: string };

  [EVENTS.COMPLIANCE_FLAGGED]: {
    targetType: 'script' | 'shot' | 'asset' | 'reel';
    targetId: string;
    reasons: string[];
  };
  [EVENTS.COMPLIANCE_APPROVED]: { targetType: string; targetId: string };
  [EVENTS.COMPLIANCE_REJECTED]: { targetType: string; targetId: string; reasons: string[] };

  [EVENTS.VOICE_GENERATED]: { mediaId: string; assetId?: string; durationS: number };
  [EVENTS.VOICE_CLONED]: { voiceId: string; sourceMediaId: string };

  [EVENTS.DISTRIBUTION_PUBLISHED]: {
    episodeId: string;
    platform: string;
    externalUrl: string;
  };
  [EVENTS.DISTRIBUTION_METRICS_INGESTED]: {
    episodeId: string;
    platform: string;
    views: number;
    revenue: number;
  };

  [EVENTS.COST_LEDGER_RECORDED]: {
    entryId: string;
    projectId?: string;
    costCny: number;
    action: string;
  };
  [EVENTS.COST_THRESHOLD_50]: { projectId: string; used: number; limit: number };
  [EVENTS.COST_THRESHOLD_80]: { projectId: string; used: number; limit: number };
  [EVENTS.COST_THRESHOLD_100]: { projectId: string; used: number; limit: number };
  [EVENTS.BUDGET_EXCEEDED]: { projectId: string; attempted: number; limit: number };

  [EVENTS.USER_INVITED]: { invitationId: string; email: string; projectId: string };
  [EVENTS.USER_JOINED_PROJECT]: { userId: string; projectId: string; role: string };
  [EVENTS.COMMENT_CREATED]: {
    commentId: string;
    targetType: string;
    targetId: string;
    authorId: string;
  };
  [EVENTS.MENTION_FIRED]: { commentId: string; mentionedUserId: string };

  [EVENTS.PROVIDER_HEALTH_DEGRADED]: {
    providerId: string;
    healthScore: number;
    lastErrorMsg?: string;
  };
  [EVENTS.PROVIDER_API_KEY_UPDATED]: { providerId: string; updatedBy: string };
  [EVENTS.SYSTEM_SETTING_CHANGED]: { key: string; oldValue: unknown; newValue: unknown };
}

/**
 * 类型工具：拿到某 topic 对应的 payload 类型
 *
 * 用法：
 *   import { EVENTS, EventOf } from '@ss/shared/events';
 *   bus.publish<EventOf<typeof EVENTS.GENERATION_COMPLETED>>(...)
 */
export type EventOf<T extends EventTopic> = T extends keyof EventPayload ? EventPayload[T] : never;
