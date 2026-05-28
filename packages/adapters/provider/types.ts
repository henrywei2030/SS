/**
 * ProviderAdapter — AI 模型调用抽象
 *
 * 设计要点：
 *   - 所有 Provider 实现共同的 BaseProvider，自带 Cost Ledger 记账中间件
 *   - 业务层只调 generate(req)，不感知 provider 细节
 *   - Phase 2 通过 LiteLLM 接入更多模型，无需改业务代码
 */

import type { AspectRatio } from '@ss/shared/constants';

export type ProviderKind = 'video' | 'image' | 'text' | 'audio' | 'compliance' | 'embedding';

export interface ProviderInfo {
  id: string;
  displayName: string;
  kind: ProviderKind;
  unitName: 'second' | 'image' | 'ktoken' | 'request' | 'frame';
  defaultUnitPriceCny: number;
  maxDuration?: number; // 视频模型 ↓
  maxConcurrent?: number;
}

export interface CallContext {
  userId: string;
  projectId?: string;
  episodeId?: string;
  shotId?: string;
  assetId?: string;
  attemptId?: string;
  /**
   * 跳过 Provider 内置 Cost Ledger 记账 — 由 router 单点写入。
   *
   * W1-W5 audit P1 followup:`asset.generateImage` / `aigc.generateVideo` /
   * `script.analyze` / `asset.breakdown` / `storyboard.generateForEpisode`
   * 这 5 个 router 都已经手动写 costLedgerEntry(为了跟 attempt 同事务 + 用真实
   * outputUnits/inputUnits)。Provider 继承自 BaseProvider 会再写一遍 → 双写。
   *
   * 解法:router 调 provider.generate 时传 `skipLedger: true`,Provider 跳过
   * `BaseProvider.recordLedger`,router 单点写。真接 Seedance / Claude 时这条防双计费。
   */
  skipLedger?: boolean;
}

// ---------- 视频 ----------
export interface VideoRequest {
  prompt: string;
  /** 视频时长（秒） */
  durationS: number;
  aspectRatio: AspectRatio;
  seed?: number;
  refImageUrls?: string[];
  refImageBuffers?: Buffer[];
  /** 参考音频 URL(2026-05-27:binding 含 AUDIO 类资产时由 server 自动收集传过来) */
  refAudioUrls?: string[];
  /** 火山合规 ID（真人脸场景） */
  complianceIds?: string[];
  /** 首帧/尾帧约束 */
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  model?: string;
  /** 透传 Provider 特有参数 */
  extra?: Record<string, unknown>;
}

export interface VideoResult {
  videoUrl: string;        // 远端可下载 URL（短期签名）
  thumbnailUrl?: string;
  durationS: number;
  width?: number;
  height?: number;
  fps?: number;
  /** Provider 端任务 ID（用于 webhook 关联） */
  providerJobId?: string;
  costCny: number;
  rawResponse?: unknown;
}

export interface IVideoProvider {
  readonly info: ProviderInfo;
  generate(req: VideoRequest, ctx: CallContext): Promise<VideoResult>;
  estimateCost(req: VideoRequest): number;
  /** 异步任务模式时轮询 */
  poll?(providerJobId: string): Promise<VideoResult | { status: 'pending' }>;
}

// ---------- 图片 ----------
export interface ImageRequest {
  prompt: string;
  count?: number; // 默认 1
  aspectRatio?: string; // '1:1' | '16:9' | '9:16' | '3:4' | ...
  refImageUrls?: string[];
  /** 用于 img2img 的强度（0-1） */
  strength?: number;
  /** 三视图 / 360° 等模式标记 */
  mode?: 'standard' | 'three_view' | 'panorama_360' | 'poster';
  model?: string;
  extra?: Record<string, unknown>;
}

export interface ImageResult {
  imageUrls: string[];
  width?: number;
  height?: number;
  costCny: number;
  rawResponse?: unknown;
}

export interface IImageProvider {
  readonly info: ProviderInfo;
  generate(req: ImageRequest, ctx: CallContext): Promise<ImageResult>;
  estimateCost(req: ImageRequest): number;
}

// ---------- 文本 / LLM ----------
export interface TextRequest {
  system?: string;
  prompt: string;
  /** 结构化 JSON 输出（zod schema） */
  jsonSchema?: unknown;
  /**
   * 三十六收工 P0:assistant prefill 内容 — 强制模型从指定 JSON prefix 续写
   * 对 Claude via moyu 必须用结构化 prefix 如 `{"shots":[`,短 prefill 如 `{` 会被当引号续 markdown
   * 默认 `{`,调用方按业务 schema 显式传更长 prefix
   */
  jsonPrefill?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  extra?: Record<string, unknown>;
}

export interface TextResult {
  text: string;
  json?: unknown;
  inputTokens: number;
  outputTokens: number;
  costCny: number;
  rawResponse?: unknown;
}

export interface ITextProvider {
  readonly info: ProviderInfo;
  generate(req: TextRequest, ctx: CallContext): Promise<TextResult>;
  estimateCost(req: TextRequest): number;
}

// ---------- 合规 ----------
export interface ComplianceRequest {
  /** 图片 URL 或 Buffer */
  imageUrl?: string;
  imageBuffer?: Buffer;
  /** 关联实体（人物名） */
  subject?: string;
}

export interface ComplianceResult {
  approved: boolean;
  /** 火山返回的合规 ID — 后续视频生成时复用 */
  complianceId?: string;
  reasons?: string[];
  costCny: number;
  rawResponse?: unknown;
}

export interface IComplianceProvider {
  readonly info: ProviderInfo;
  check(req: ComplianceRequest, ctx: CallContext): Promise<ComplianceResult>;
}
