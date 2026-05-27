/**
 * MockVideoProvider — W5.4 临时实现 / 开发兜底
 *
 * 真实视频 Provider(Seedance / Kling / HappyHorse / 本地模型)接入需要:
 *   1. 真实账号 + API Key(/admin/providers 加密录入)
 *   2. 各家 SDK / REST 协议适配
 *   3. 异步任务模式:create → poll(create 返 jobId,poll 直到 succeeded 返 videoUrl)
 *   4. CDN 上传链路(MinIO bucket / 直接外链)
 *
 * Phase 1 用静态测试视频 URL 占位,让 UI / 数据流完整跑通:
 *   - 接收 prompt + durationS + aspectRatio + refImageUrls
 *   - 短暂"思考" → 返公开测试视频 mp4 链接
 *   - 走 Cost Ledger 记账(成本 = unitPriceCny * durationS,但 unitPriceCny 默认 0)
 *
 * 真接入时把"如何加一个新视频 Provider"流程在 packages/adapters/provider/index.ts
 * 的 constructVideoProvider 处有详细注释,**aigcRouter / generateVideo 接口不变**。
 */
import { ProviderError } from '@ss/shared';

import type {
  CallContext,
  IVideoProvider,
  ProviderInfo,
  VideoRequest,
  VideoResult,
} from './types.js';

export type MockVideoFailureMode =
  | 'timeout'
  | 'censored'
  | 'quality'
  | 'rate_limit'
  | 'server_error'
  | 'compliance_required';

export interface MockVideoProviderOpts {
  providerId: string;
  /** 单位:CNY/秒 — mock 默认 0 */
  unitPriceCny: number;
  /** Mock"思考"耗时 ms(默认 800),让 UI loading 可见 */
  fakeLatencyMs?: number;
  /**
   * 改进意见 P0-7:失败注入(默认 0 始终成功)
   * 配合 W5.5 BullMQ worker 验证重试 / dead-letter / SSE 错误推送
   */
  failureRate?: number;
  /** 默认 ['timeout', 'rate_limit', 'server_error'] */
  failureModes?: MockVideoFailureMode[];
}

const VIDEO_FAILURE_MESSAGES: Record<MockVideoFailureMode, string> = {
  timeout: 'Mock failure: video provider task timeout after 5min',
  censored: 'Mock failure: prompt rejected by safety filter',
  quality: 'Mock failure: output quality below threshold (real provider returns blurry/glitched video)',
  rate_limit: 'Mock failure: provider rate limit exceeded, retry after 60s',
  server_error: 'Mock failure: provider server 5xx error',
  compliance_required: 'Mock failure: character lacks compliance approval (real Seedance face check fails)',
};

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * 几条公开 mp4 短视频,按 aspectRatio 选(短剧 9:16 用 BigBuckBunny 9:16 切片;
 * 找不到对应 ratio 则 fallback 到通用 mp4)。
 * 这些是 archive.org / w3.org 公开样片,可直接 hotlink。
 */
const SAMPLE_VIDEOS: Record<string, string> = {
  '9:16': 'https://www.w3.org/2010/05/sintel/trailer.mp4',
  '16:9': 'https://www.w3.org/2010/05/sintel/trailer.mp4',
  '1:1': 'https://www.w3.org/2010/05/sintel/trailer.mp4',
};
const FALLBACK_VIDEO = 'https://www.w3.org/2010/05/sintel/trailer.mp4';

export class MockVideoProvider implements IVideoProvider {
  readonly info: ProviderInfo;

  constructor(private opts: MockVideoProviderOpts) {
    this.info = {
      id: opts.providerId,
      kind: 'video',
      displayName: `${opts.providerId} (Mock W5.4)`,
      defaultUnitPriceCny: opts.unitPriceCny,
      unitName: 'second',
      // 2026-05-27:业务上限 15s(用户反馈)
      maxDuration: 15,
      maxConcurrent: 3,
    };
  }

  estimateCost(req: VideoRequest): number {
    return this.opts.unitPriceCny * req.durationS;
  }

  async generate(req: VideoRequest, _ctx: CallContext): Promise<VideoResult> {
    // W5.5.1:透传扩展参数确认链路通(Mock 阶段仅日志,真接 Provider 时消费)
    if (req.extra && Object.keys(req.extra).length > 0) {
      console.log(`[mock-video:${this.info.id}] extra params received:`, req.extra);
    }

    // 模拟异步延迟,让 UI loading 可见
    const latency = this.opts.fakeLatencyMs ?? 800;
    await new Promise((r) => setTimeout(r, latency));

    // 改进意见 P0-7:失败注入
    const failureRate = this.opts.failureRate ?? 0;
    if (failureRate > 0 && Math.random() < failureRate) {
      const modes = this.opts.failureModes ?? (['timeout', 'rate_limit', 'server_error'] as MockVideoFailureMode[]);
      const mode = pickRandom(modes);
      throw new ProviderError(this.info.id, `[mock:${mode}] ${VIDEO_FAILURE_MESSAGES[mode]}`);
    }

    const videoUrl = SAMPLE_VIDEOS[req.aspectRatio] ?? FALLBACK_VIDEO;
    const { width, height } = sizeFromAspect(req.aspectRatio);
    const durationS = Math.max(3, Math.min(req.durationS, 15));

    return {
      videoUrl,
      thumbnailUrl: undefined,
      durationS,
      width,
      height,
      fps: 24,
      providerJobId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      costCny: this.opts.unitPriceCny * durationS,
      rawResponse: {
        mock: true,
        note: 'MockVideoProvider — W3.org 公开样片,W5.4 接入真实 video provider 时替换',
        prompt: req.prompt,
        aspectRatio: req.aspectRatio,
        refImageUrls: req.refImageUrls,
        durationS: req.durationS,
      },
    };
  }

  /** Mock 不需要轮询(generate 同步返),但实现接口以匹配 IVideoProvider */
  async poll(providerJobId: string): Promise<VideoResult | { status: 'pending' }> {
    void providerJobId;
    // Mock 模式 generate 已同步完成,这里只在外部测试 poll 路径时调用
    return {
      videoUrl: FALLBACK_VIDEO,
      durationS: 5,
      providerJobId,
      costCny: 0,
    };
  }
}

function sizeFromAspect(ratio: string): { width: number; height: number } {
  switch (ratio) {
    case '9:16':
      return { width: 576, height: 1024 };
    case '16:9':
      return { width: 1024, height: 576 };
    case '1:1':
      return { width: 1024, height: 1024 };
    default:
      return { width: 576, height: 1024 };
  }
}
