/**
 * Queue 类型与常量 — web 入队 + worker 消费共享同一份
 *
 * ADR-25 M1:防止 web/worker 两边 schema 漂移。
 * web 端 tRPC handler 用 addVideoGenJob(payload),
 * worker 端 processor 收到的 Job<VideoGenJobData> 类型完全一致。
 */
import { z } from 'zod';

import { ASPECT_RATIOS } from '@ss/shared/constants';

/** 队列名常量 — ADR-25 M6 channel 派生也用这个 */
export const VIDEO_GEN_QUEUE_NAME = 'video-gen' as const;

/**
 * VideoGen Job Payload Schema
 *
 * 入队时 tRPC handler 已完成的工作:
 *   - 占位 attempt 已建(status=RUNNING)
 *   - prompt 已 compile + 校验(missingMedia / unknownTokens 等已挡)
 *   - bindings / refImageUrls 已解析
 *
 * Worker 只需要这些信息就能调 provider.generate 并落库。
 * 不传 mutable 业务状态(如 group.prompt),传值 vs 引用边界清晰。
 */
export const VideoGenJobDataSchema = z.object({
  attemptId: z.string().cuid(),
  projectId: z.string().cuid(),
  episodeId: z.string().cuid(),
  shotGroupId: z.string().cuid(),
  userId: z.string().cuid(),

  providerId: z.string(),
  modelId: z.string(),

  prompt: z.string().min(1).max(20000),
  // 2026-05-27 audit r12:int 强制,跟 generateVideo input 一致
  durationS: z.number().int().min(1).max(15),
  aspectRatio: z.enum(ASPECT_RATIOS),
  refImageUrls: z.array(z.string().min(1)).optional(),
  // 2026-05-27 audit r13:binding 含 AUDIO 类资产(角色配音等)时 server 收集 voiceMediaId 入队
  // Seedance 2.0 metadata.content audio_url role:reference_audio 消费
  refAudioUrls: z.array(z.string().min(1)).optional(),

  // ============================================================================
  // W5.5.1 扩展参数(2026-05-24)— 对照即梦 / 可灵等同行 UI
  //
  // 设计原则:
  //   - 字段都是 optional,Phase 1 不强制,Provider 不消费也不报错
  //   - Mock provider 阶段仅打日志确认透传链路通
  //   - 真接 Seedance / Volcengine 时,Provider Adapter 内消费这些字段
  //   - 不动 VideoRequest 接口(packages/adapters/provider/types.ts),透传 extra
  // ============================================================================

  /** 视频分辨率(480p / 720p / 1080p)— Phase 1 透传,真消费在 Provider Adapter */
  resolution: z.enum(['480p', '720p', '1080p']).optional(),

  /** 是否生成同步音频(Seedance / Veo 2 支持)— Phase 1 透传 */
  generateAudio: z.boolean().optional(),

  /** 是否添加水印 — Phase 1 透传,Phase 2 可改 ffmpeg 后处理 worker */
  addWatermark: z.boolean().optional(),

  /** 联网搜索增强 prompt — Phase 2 真实施(需要 web search Provider) */
  webSearchEnabled: z.boolean().optional(),

  /** 参考视频 URL(运动迁移)— Phase 2 Provider 支持时启用 */
  refVideoUrl: z.string().min(1).optional(),

  /** 参考音频 URL(配乐 / 节奏)— Phase 2 启用 */
  refAudioUrl: z.string().min(1).optional(),

  /** 仅用于日志追溯,不参与业务决策 */
  groupNumber: z.string(),

  /**
   * 第 19 轮 audit P1:requestId 贯通 tRPC ctx → 入队 Job → worker console.log
   * 用户报 bug 给 requestId,运维 `grep "req=xxx"` 即可看全链路日志(从 web 到 worker)
   */
  requestId: z.string().optional(),
});
export type VideoGenJobData = z.infer<typeof VideoGenJobDataSchema>;

/**
 * SSE Progress Event — Redis pub/sub 推到前端的事件类型
 *
 * ADR-25 M6:worker → Redis publish → SSE endpoint → EventSource → 前端 hook
 *
 * r10 audit:加 Zod schema 给 SSE route runtime validate
 *   防 worker 协议升级 / DB 异常 publish 错位 payload 时 SSE 转发畸形数据给前端
 *   Zod parse 失败时 SSE 走 catch 路径 log + 跳过该消息,不冒泡崩接
 */
export const VideoGenProgressEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('queued'),
    attemptId: z.string(),
    position: z.number().optional(),
  }),
  z.object({
    type: z.literal('running'),
    attemptId: z.string(),
    providerJobId: z.string().optional(),
  }),
  z.object({
    type: z.literal('progress'),
    attemptId: z.string(),
    percent: z.number().optional(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('success'),
    attemptId: z.string(),
    mediaId: z.string(),
    videoUrl: z.string(),
    thumbnailUrl: z.string().optional(),
    costCny: z.number(),
  }),
  z.object({
    type: z.literal('failed'),
    attemptId: z.string(),
    errorMsg: z.string(),
    retryable: z.boolean(),
  }),
]);

export type VideoGenProgressEvent = z.infer<typeof VideoGenProgressEventSchema>;

/**
 * Redis pub/sub channel 名构造器 — ADR-25 M6 domain:resource 风格
 * 使用举例:redis.publish(videoGenChannel(attemptId), JSON.stringify(event))
 */
export function videoGenChannel(attemptId: string): string {
  return `videogen:attempt:${attemptId}`;
}
