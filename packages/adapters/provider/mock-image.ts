/**
 * MockImageProvider — W4-MM.6 临时实现
 *
 * 真实 ImageProvider(NanoBanana / GPT Image / 豆包图像)接入需要:
 *   1. 真实账号 + API Key
 *   2. 各家 SDK / REST 协议适配
 *   3. 异步任务轮询 / Webhook
 *   4. CDN 上传链路(MinIO bucket)
 *
 * Phase 1 用 picsum.photos 占位图,让 UI / 数据流完整跑通。
 *
 * 改进意见 P0-7(2026-05-24):加可配置失败注入
 * 让 W5.5 BullMQ worker 重试逻辑能在 mock 阶段就验证(真接 Seedance 时
 * timeout/censored/quality/rate_limit 各种失败必发生,不能等真接入再 debug)。
 */
import { ProviderError } from '@ss/shared';

import type { IImageProvider, ImageRequest, ImageResult, ProviderInfo, CallContext } from './types.js';

export type MockFailureMode = 'timeout' | 'censored' | 'quality' | 'rate_limit' | 'server_error';

export interface MockImageProviderOpts {
  providerId: string;
  unitPriceCny: number; // 即使是 mock 也走 ledger,但通常 priceCny=0
  /**
   * 失败注入率 0-1,默认 0(始终成功)。dev / 测试时可设 0.2 模拟 20% 失败率。
   * 配合 W5.5 BullMQ worker 验证重试逻辑。
   */
  failureRate?: number;
  /**
   * 可选失败模式集合,默认 ['timeout', 'rate_limit']。
   * 触发失败时按等概率随机选一个。
   */
  failureModes?: MockFailureMode[];
  /** 模拟延迟 ms 下限,默认 0 */
  latencyMinMs?: number;
  /** 模拟延迟 ms 上限,默认 0 */
  latencyMaxMs?: number;
}

const FAILURE_MESSAGES: Record<MockFailureMode, string> = {
  timeout: 'Mock failure: provider timeout after 60s (real Seedance/NanoBanana can timeout)',
  censored: 'Mock failure: content censored by safety filter (real provider rejects certain prompts)',
  quality: 'Mock failure: output quality below threshold (real provider returns low-quality result)',
  rate_limit: 'Mock failure: rate limit exceeded, retry after backoff',
  server_error: 'Mock failure: provider server returned 5xx',
};

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export class MockImageProvider implements IImageProvider {
  readonly info: ProviderInfo;

  constructor(private opts: MockImageProviderOpts) {
    this.info = {
      id: opts.providerId,
      kind: 'image',
      displayName: `${opts.providerId} (Mock W4-MM.6)`,
      defaultUnitPriceCny: opts.unitPriceCny,
      unitName: 'image',
    };
  }

  async generate(req: ImageRequest, ctx: CallContext): Promise<ImageResult> {
    // 改进意见 P0-7:模拟延迟,让 worker 测得到真实异步行为
    const { latencyMinMs = 0, latencyMaxMs = 0 } = this.opts;
    if (latencyMaxMs > 0) {
      const delay = latencyMinMs + Math.random() * (latencyMaxMs - latencyMinMs);
      await new Promise((r) => setTimeout(r, delay));
    }

    // 改进意见 P0-7:失败注入
    const failureRate = this.opts.failureRate ?? 0;
    if (failureRate > 0 && Math.random() < failureRate) {
      const modes = this.opts.failureModes ?? (['timeout', 'rate_limit'] as MockFailureMode[]);
      const mode = pickRandom(modes);
      throw new ProviderError(this.info.id, `[mock:${mode}] ${FAILURE_MESSAGES[mode]}`);
    }

    const { width, height } = sizeFromAspect(req.aspectRatio ?? '1:1');
    const count = Math.max(1, Math.min(req.count ?? 1, 4));

    // 用 picsum.photos 占位 — seed 用项目+随机数让每次不一样
    const seedBase = `${ctx.projectId ?? 'p'}-${Date.now()}`;
    const imageUrls = Array.from({ length: count }, (_, i) => {
      const seed = encodeURIComponent(`${seedBase}-${i}-${Math.random().toString(36).slice(2, 6)}`);
      return `https://picsum.photos/seed/${seed}/${width}/${height}`;
    });

    return {
      imageUrls,
      width,
      height,
      costCny: this.opts.unitPriceCny * count,
      rawResponse: {
        mock: true,
        note: 'MockImageProvider — picsum.photos 占位,W4-MM.6 接入真实 ImageProvider 时替换',
        prompt: req.prompt,
        aspectRatio: req.aspectRatio,
        mode: req.mode,
      },
    };
  }

  estimateCost(req: ImageRequest): number {
    return this.opts.unitPriceCny * (req.count ?? 1);
  }
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function sizeFromAspect(ratio: string): { width: number; height: number } {
  // 默认基础尺寸 1024
  const map: Record<string, { width: number; height: number }> = {
    '1:1': { width: 1024, height: 1024 },
    '9:16': { width: 576, height: 1024 },
    '16:9': { width: 1024, height: 576 },
    '3:4': { width: 768, height: 1024 },
    '4:3': { width: 1024, height: 768 },
    '2:1': { width: 1024, height: 512 },
    '1:2': { width: 512, height: 1024 },
  };
  return map[ratio] ?? map['1:1']!;
}
