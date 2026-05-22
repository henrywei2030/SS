/**
 * MockImageProvider — W4-MM.6 临时实现
 *
 * 真实 ImageProvider(NanoBanana / GPT Image / 豆包图像)接入需要:
 *   1. 真实账号 + API Key
 *   2. 各家 SDK / REST 协议适配
 *   3. 异步任务轮询 / Webhook
 *   4. CDN 上传链路(MinIO bucket)
 *
 * Phase 1 用 picsum.photos 占位图,让 UI / 数据流完整跑通:
 *   - 接收 prompt + aspectRatio + count
 *   - 按比例计算尺寸 → 返回 picsum.photos URL
 *   - 每次随机 seed 让图不同
 *   - 走 Cost Ledger 记账(成本 = 0,占位)
 *
 * 真接入时把这个文件替换为 NanoBananaProvider/GptImageProvider 即可,
 * assetRouter / generateImage 接口不变。
 */
import type { IImageProvider, ImageRequest, ImageResult, ProviderInfo, CallContext } from './types.js';

export interface MockImageProviderOpts {
  providerId: string;
  unitPriceCny: number; // 即使是 mock 也走 ledger,但通常 priceCny=0
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
