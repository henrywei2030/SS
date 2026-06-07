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
import { computeImageCostCny } from './pricing.js';
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

/**
 * 把 aspectRatio (如 '16:9') 映射到 size 字符串 (像素)。
 * ⚠️ 五八-fix:Seedream 5.0 要求图像 ≥3,686,400 像素(≈2.5K),原映射(1080x1920=2.07M)太小被拒。
 *   统一提到 ~2.5K 档,各比例总像素均 ≥3.69M。(注:gpt-image/DALL-E 只接受固定 1024 档 —
 *   当前 binding 是 Seedream;真正的 per-model 尺寸映射留 Phase 2,届时按 cfg.defaultModel 分支。)
 */
function aspectRatioToSize(aspect: string | undefined, fallback: string): string {
  if (!aspect) return fallback;
  const map: Record<string, string> = {
    '1:1': '2048x2048', //  4.19M
    '16:9': '2688x1512', // 4.06M
    '9:16': '1512x2688', // 4.06M
    '4:3': '2304x1728', //  3.98M
    '3:4': '1728x2304', //  3.98M
    '2:3': '1664x2496', //  4.15M
    '3:2': '2496x1664', //  4.15M
    '2:1': '2912x1456', //  4.24M(全景)
  };
  return map[aspect] ?? '2048x2048';
}

/** 解析 OpenAI 图像响应 → URL 列表(兼容 url 直链 与 b64_json,后者转 data URL)*/
function extractImageUrls(resp: OpenAIImageResponse): string[] {
  return (resp.data ?? [])
    .map((d) => d.url ?? (d.b64_json ? `data:image/png;base64,${d.b64_json}` : undefined))
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
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
    return computeImageCostCny(n, this.cfg.unitPriceCny);
  }

  async generate(req: ImageRequest, ctx: CallContext): Promise<ImageResult> {
    const modelId = req.model ?? this.cfg.defaultModel;
    const n = req.count ?? 1;
    const size = aspectRatioToSize(req.aspectRatio, this.cfg.defaultSize ?? '1024x1024');

    await this.checkBudget(ctx.projectId, this.estimateCost(req));

    // 五七-3:有参考图 → 走图生图 /images/edits(multipart);否则保持文生图 /images/generations
    if (req.refImageUrls && req.refImageUrls.length > 0) {
      return this.generateViaEdits(req, ctx, modelId, n, size);
    }

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

    const imageUrls = extractImageUrls(resp);

    if (imageUrls.length === 0) {
      throw new ProviderError(this.info.id, 'No image URLs in response (data 数组为空)');
    }

    const actualN = imageUrls.length;
    const costCny = computeImageCostCny(actualN, this.cfg.unitPriceCny);

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

  /**
   * 五七-3:图生图 — POST /images/edits(multipart/form-data)。
   * fetch 每张参考图 bytes 作 image[](OpenAI gpt-image 兼容,上限 16),prompt/model/size/n + req.extra 透传。
   * ⚠️ 各中转站对 Seedream/GPT-Image 的 edits 入参可能不同(字段名 image vs image[]、是否支持 strength)—
   *    错误信息透出便于真打迭代。响应兼容 url 与 b64_json。
   */
  private async generateViaEdits(
    req: ImageRequest,
    ctx: CallContext,
    modelId: string,
    n: number,
    size: string,
  ): Promise<ImageResult> {
    const form = new FormData();
    form.append('model', modelId);
    form.append('prompt', req.prompt);
    form.append('n', String(n));
    form.append('size', size);
    if (req.extra) {
      for (const [k, v] of Object.entries(req.extra)) {
        if (v != null) form.append(k, String(v));
      }
    }
    // 取参考图 bytes(最多 16 张)
    const refs = (req.refImageUrls ?? []).slice(0, 16);
    for (let i = 0; i < refs.length; i++) {
      const u = refs[i]!;
      const imgResp = await fetch(u, { signal: AbortSignal.timeout(30_000) });
      if (!imgResp.ok) {
        throw new ProviderError(
          this.info.id,
          `参考图下载失败(HTTP ${imgResp.status}): ${u.slice(0, 80)}`,
        );
      }
      const blob = await imgResp.blob();
      form.append('image[]', blob, `ref-${i}.png`);
    }

    let resp: OpenAIImageResponse;
    try {
      const r = await fetch(`${this.cfg.apiUrl}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
      const text = await r.text();
      if (!r.ok) {
        let parsed: OpenAIErrorResponse | null = null;
        try {
          parsed = JSON.parse(text) as OpenAIErrorResponse;
        } catch {
          /* not json */
        }
        throw new ProviderError(
          this.info.id,
          parsed?.error?.message ?? `图生图 HTTP ${r.status}: ${text.slice(0, 300)}`,
        );
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

    const imageUrls = extractImageUrls(resp);
    if (imageUrls.length === 0) {
      throw new ProviderError(this.info.id, '图生图返回无图(data 数组为空)');
    }
    const actualN = imageUrls.length;
    const costCny = computeImageCostCny(actualN, this.cfg.unitPriceCny);

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

    const [widthStr, heightStr] = (resp.data?.[0]?.size ?? size).split('x');
    return {
      imageUrls,
      width: Number(widthStr) || undefined,
      height: Number(heightStr) || undefined,
      costCny,
      rawResponse: resp,
    };
  }
}
