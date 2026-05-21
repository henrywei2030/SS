/**
 * ProviderAdapter — AI 模型调用抽象
 *
 * 设计要点：
 *   - 所有 Provider 实现共同的 BaseProvider，自带 Cost Ledger 记账中间件
 *   - 业务层只调 generate(req)，不感知 provider 细节
 *   - Phase 2 通过 LiteLLM 接入更多模型，无需改业务代码
 */
export type ProviderKind = 'video' | 'image' | 'text' | 'audio' | 'compliance' | 'embedding';
export interface ProviderInfo {
    id: string;
    displayName: string;
    kind: ProviderKind;
    unitName: 'second' | 'image' | 'ktoken' | 'request' | 'frame';
    defaultUnitPriceCny: number;
    maxDuration?: number;
    maxConcurrent?: number;
}
export interface CallContext {
    userId: string;
    projectId?: string;
    episodeId?: string;
    shotId?: string;
    assetId?: string;
    attemptId?: string;
    /** 是否跳过 Cost Ledger 记账（仅用于内部测试） */
    skipLedger?: boolean;
}
export interface VideoRequest {
    prompt: string;
    /** 视频时长（秒） */
    durationS: number;
    aspectRatio: '9:16' | '16:9' | '1:1';
    seed?: number;
    refImageUrls?: string[];
    refImageBuffers?: Buffer[];
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
    videoUrl: string;
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
    poll?(providerJobId: string): Promise<VideoResult | {
        status: 'pending';
    }>;
}
export interface ImageRequest {
    prompt: string;
    count?: number;
    aspectRatio?: string;
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
export interface TextRequest {
    system?: string;
    prompt: string;
    /** 结构化 JSON 输出（zod schema） */
    jsonSchema?: unknown;
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
//# sourceMappingURL=types.d.ts.map