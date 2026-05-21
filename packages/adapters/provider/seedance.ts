/**
 * Seedance Provider (火山引擎 Doubao Seedance)
 * — Phase 1 唯一接入的视频模型 —
 *
 * 文档参考: https://www.volcengine.com/docs/82379/ (ARK API)
 * 模型 ID: 'doubao-seedance-1-0-pro' / 'doubao-seedance-1-0-pro-fast' (示例)
 * 实际使用时根据 .env 配置的 SEEDANCE_DEFAULT_MODEL / SEEDANCE_FAST_MODEL 切换
 *
 * 调用模式：异步任务（创建 → 轮询）
 */
import { request } from 'undici';

import { ProviderError } from '@ss/shared';

import { BaseProvider } from './base.js';
import type {
  CallContext,
  IVideoProvider,
  ProviderInfo,
  VideoRequest,
  VideoResult,
} from './types.js';

export interface SeedanceConfig {
  apiUrl: string;        // e.g. https://ark.cn-beijing.volces.com/api/v3
  apiKey: string;
  defaultModel: string;  // SEEDANCE_DEFAULT_MODEL
  fastModel?: string;    // SEEDANCE_FAST_MODEL
  /** 默认 max_duration（秒），Storyboard 合并阈值用 */
  maxDuration: number;
  /** 单价 CNY/秒 */
  unitPriceCny: number;
  /** 异步任务轮询间隔 ms */
  pollIntervalMs?: number;
  /** 轮询超时 ms */
  pollTimeoutMs?: number;
}

interface CreateTaskResponse {
  id: string;
  status: string;
}

interface QueryTaskResponse {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  content?: {
    video_url?: string;
    cover_url?: string;
    width?: number;
    height?: number;
    duration?: number;
    fps?: number;
  };
  error?: { code?: string; message?: string };
  usage?: {
    completion_tokens?: number;
  };
}

export class SeedanceProvider extends BaseProvider implements IVideoProvider {
  readonly info: ProviderInfo;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;

  constructor(private readonly cfg: SeedanceConfig) {
    super();
    this.info = {
      id: cfg.defaultModel,
      displayName: 'Seedance（视频）',
      kind: 'video',
      unitName: 'second',
      defaultUnitPriceCny: cfg.unitPriceCny,
      maxDuration: cfg.maxDuration,
      maxConcurrent: 5,
    };
    this.pollIntervalMs = cfg.pollIntervalMs ?? 3000;
    this.pollTimeoutMs = cfg.pollTimeoutMs ?? 5 * 60 * 1000;
  }

  estimateCost(req: VideoRequest): number {
    return req.durationS * this.cfg.unitPriceCny;
  }

  async generate(req: VideoRequest, ctx: CallContext): Promise<VideoResult> {
    const modelId = req.model ?? this.cfg.defaultModel;
    const estimated = this.estimateCost(req);

    // 预算护栏
    await this.checkBudget(ctx.projectId, estimated);

    // 构造 Seedance 任务请求
    // 注：Seedance/Ark API 的实际字段名可能因平台版本而异；这里给出常见形态。
    // 团队在 W1 末整合时应根据实际接口对齐字段。
    const taskBody = {
      model: modelId,
      content: [
        ...(req.refImageUrls?.map((url) => ({ type: 'image_url', image_url: { url } })) ?? []),
        { type: 'text', text: req.prompt },
      ],
      parameters: {
        duration: clamp(req.durationS, 1, this.cfg.maxDuration),
        aspect_ratio: req.aspectRatio,
        ...(req.seed !== undefined && { seed: req.seed }),
        ...(req.firstFrameUrl && { first_frame_image: req.firstFrameUrl }),
        ...(req.lastFrameUrl && { last_frame_image: req.lastFrameUrl }),
        ...(req.complianceIds?.length && { compliance_ids: req.complianceIds }),
        ...req.extra,
      },
    };

    let providerJobId: string;
    try {
      const { statusCode, body } = await request(`${this.cfg.apiUrl}/contents/generations/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify(taskBody),
      });
      const text = await body.text();
      if (statusCode >= 400) {
        throw new ProviderError(this.info.id, `Create task failed (${statusCode}): ${text}`);
      }
      const json = JSON.parse(text) as CreateTaskResponse;
      providerJobId = json.id;
    } catch (e) {
      await this.recordLedger({
        ctx,
        providerId: modelId,
        modelId,
        action: 'video.generate',
        inputUnits: 0,
        outputUnits: 0,
        unitPriceCny: this.cfg.unitPriceCny,
        success: false,
      });
      this.wrapCallError(e);
    }

    // 轮询任务完成
    const deadline = Date.now() + this.pollTimeoutMs;
    let lastQuery: QueryTaskResponse | undefined;
    while (Date.now() < deadline) {
      await sleep(this.pollIntervalMs);
      try {
        lastQuery = await this.queryTask(providerJobId);
      } catch (e) {
        await this.recordLedger({
          ctx,
          providerId: modelId,
          modelId,
          action: 'video.generate',
          inputUnits: 0,
          outputUnits: 0,
          unitPriceCny: this.cfg.unitPriceCny,
          success: false,
        });
        this.wrapCallError(e);
      }

      if (lastQuery.status === 'succeeded') break;
      if (lastQuery.status === 'failed' || lastQuery.status === 'cancelled') {
        await this.recordLedger({
          ctx,
          providerId: modelId,
          modelId,
          action: 'video.generate',
          inputUnits: 0,
          outputUnits: 0,
          unitPriceCny: this.cfg.unitPriceCny,
          success: false,
        });
        throw new ProviderError(
          this.info.id,
          lastQuery.error?.message ?? `Task ${lastQuery.status}`,
        );
      }
    }

    if (!lastQuery || lastQuery.status !== 'succeeded' || !lastQuery.content?.video_url) {
      await this.recordLedger({
        ctx,
        providerId: modelId,
        modelId,
        action: 'video.generate',
        inputUnits: 0,
        outputUnits: 0,
        unitPriceCny: this.cfg.unitPriceCny,
        success: false,
      });
      throw new ProviderError(this.info.id, 'Task timeout');
    }

    const actualDuration = lastQuery.content.duration ?? req.durationS;
    const costCny = actualDuration * this.cfg.unitPriceCny;

    await this.recordLedger({
      ctx,
      providerId: modelId,
      modelId,
      action: 'video.generate',
      inputUnits: req.durationS,
      outputUnits: actualDuration,
      unitPriceCny: this.cfg.unitPriceCny,
      success: true,
    });

    return {
      videoUrl: lastQuery.content.video_url,
      thumbnailUrl: lastQuery.content.cover_url,
      durationS: actualDuration,
      width: lastQuery.content.width,
      height: lastQuery.content.height,
      fps: lastQuery.content.fps,
      providerJobId,
      costCny,
      rawResponse: lastQuery,
    };
  }

  async poll(providerJobId: string): Promise<VideoResult | { status: 'pending' }> {
    const q = await this.queryTask(providerJobId);
    if (q.status === 'queued' || q.status === 'running') return { status: 'pending' };
    if (q.status !== 'succeeded' || !q.content?.video_url) {
      throw new ProviderError(this.info.id, q.error?.message ?? `Task ${q.status}`);
    }
    const dur = q.content.duration ?? 0;
    return {
      videoUrl: q.content.video_url,
      thumbnailUrl: q.content.cover_url,
      durationS: dur,
      width: q.content.width,
      height: q.content.height,
      fps: q.content.fps,
      providerJobId,
      costCny: dur * this.cfg.unitPriceCny,
      rawResponse: q,
    };
  }

  private async queryTask(taskId: string): Promise<QueryTaskResponse> {
    const { statusCode, body } = await request(
      `${this.cfg.apiUrl}/contents/generations/tasks/${taskId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
      },
    );
    const text = await body.text();
    if (statusCode >= 400) {
      throw new ProviderError(this.info.id, `Query task failed (${statusCode}): ${text}`);
    }
    return JSON.parse(text) as QueryTaskResponse;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
