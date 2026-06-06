/**
 * OpenAI-Compatible Image Provider
 *
 * 适配 OpenAI /v1/images/generations 兼容的中转 / 原生站:
 *   - OpenAI 兼容中转站(moyu / OpenRouter 等)的 doubao-seedream-3.0/4.0/4.5/5.0 / FLUX.2-dev
 *   - OpenAI DALL-E
 *   - 任意 OpenAI 兼容的图像生成 endpoint
 *
 * 协议:POST {apiUrl}/images/generations
 *   request:  { model, prompt, n, size, ... }
 *   response: { created, data: [{ url, b64_json?, size? }], model, usage }
 *
 * 不支持的(留 Phase 2):
 *   - img2img / 参考图(NanoBanana 等 Provider 特殊扩展)
 *   - 三视图 / 全景特殊 mode(W4-MM 模式映射在 router 层做,Provider 只接 prompt 改写)
 */
import { request } from 'undici';

import { ProviderError } from '@ss/shared';

import { BaseProvider } from './base.js';
import type {
  CallContext,
  IImageProvider,
  ImageRequest,
  ImageResult,
  ProviderInfo,
} from './types.js';

export interface OpenAICompatImageConfig {
  apiUrl: string;
  apiKey: string;
  defaultModel: string;
  /** CNY per image(简化:不按 token 算) */
  unitPriceCny: number;
  displayName?: string;
  maxConcurrent?: number;
  /** 默认 size,不填默认 1024x1024 */
  defaultSize?: string;
}

interface OpenAIImageResponse {
  created: number;
  model?: string;
  data: Array<{
    url?: string;
    b64_json?: string;
    size?: string;
    revised_prompt?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAIErrorResponse {
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
}

/** 把 aspectRatio (如 '16:9') 映射到 size 字符串 (像素) */
function aspectRatioToSize(aspect: string | undefined, fallback: string): string {
  if (!aspect) return fallback;
  // 常见映射(seedream / DALL-E 都支持这些 sizes)
  const map: Record<string, string> = {
    '1:1': '1024x1024',
    '16:9': '1920x1080',
    '9:16': '1080x1920',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '2:3': '768x1152',
    '3:2': '1152x768',
  };
  return map[aspect] ?? fallback;
}

export class OpenAICompatImageProvider extends BaseProvider implements IImageProvider {
  readonly info: ProviderInfo;

  constructor(private readonly cfg: OpenAICompatImageConfig) {
    super();
    this.info = {
      id: cfg.defaultModel,
      displayName: cfg.displayName ?? `OpenAI-Compat Image (${cfg.defaultModel})`,
      kind: 'image',
      unitName: 'image',
      defaultUnitPriceCny: cfg.unitPriceCny,
      maxConcurrent: cfg.maxConcurrent ?? 5,
    };
  }

  estimateCost(req: ImageRequest): number {
    const n = req.count ?? 1;
    return n * this.cfg.unitPriceCny;
  }

  async generate(req: ImageRequest, ctx: CallContext): Promise<ImageResult> {
    const modelId = req.model ?? this.cfg.defaultModel;
    const n = req.count ?? 1;
    const size = aspectRatioToSize(req.aspectRatio, this.cfg.defaultSize ?? '1024x1024');

    await this.checkBudget(ctx.projectId, this.estimateCost(req));

    const body: Record<string, unknown> = {
      model: modelId,
      prompt: req.prompt,
      n,
      size,
    };
    if (req.extra) Object.assign(body, req.extra);

    let resp: OpenAIImageResponse;
    try {
      const { statusCode, body: respBody } = await request(`${this.cfg.apiUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        bodyTimeout: 180_000,
        // 五六-2 链路优化:图像非流式生成(多 GPU kernel)常需 1-3min,headers 只在生成完才返,
        //   原 60s 必撞 Headers Timeout → 提到 180s 与 bodyTimeout 对齐(对照文本 LLM 的 300s 调优)
        headersTimeout: 180_000,
      });
      const text = await respBody.text();
      if (statusCode >= 400) {
        let parsed: OpenAIErrorResponse | null = null;
        try {
          parsed = JSON.parse(text) as OpenAIErrorResponse;
        } catch {
          /* not json */
        }
        const errMsg = parsed?.error?.message ?? `HTTP ${statusCode}: ${text.slice(0, 200)}`;
        throw new ProviderError(this.info.id, errMsg);
      }
      resp = JSON.parse(text) as OpenAIImageResponse;
    } catch (e) {
      await this.recordLedger({
        ctx,
        providerId: modelId,
        modelId,
        action: 'image.generate',
        inputUnits: n,
        outputUnits: 0,
        unitPriceCny: this.cfg.unitPriceCny,
        success: false,
      });
      this.wrapCallError(e);
    }

    const imageUrls = (resp.data ?? [])
      .map((d) => d.url)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);

    if (imageUrls.length === 0) {
      throw new ProviderError(this.info.id, 'No image URLs in response (data 数组为空)');
    }

    const actualN = imageUrls.length;
    const costCny = actualN * this.cfg.unitPriceCny;

    await this.recordLedger({
      ctx,
      providerId: modelId,
      modelId,
      action: 'image.generate',
      inputUnits: n,
      outputUnits: actualN,
      unitPriceCny: this.cfg.unitPriceCny,
      success: true,
    });

    // 解析 size → width/height
    const [widthStr, heightStr] = (resp.data?.[0]?.size ?? size).split('x');
    const width = Number(widthStr) || undefined;
    const height = Number(heightStr) || undefined;

    return {
      imageUrls,
      width,
      height,
      costCny,
      rawResponse: resp,
    };
  }
}
