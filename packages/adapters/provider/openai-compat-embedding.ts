/**
 * OpenAI-Compatible Embedding Provider(H0,docs/07 §4.3)
 *
 * 适配所有 OpenAI /embeddings 兼容站点(中转站 text-embedding-v4 / OpenAI 直连 / one-api 衍生):
 *   request:  POST {apiUrl}/embeddings { model, input: string[] }
 *   response: { data: [{ index, embedding: number[] }], usage: { prompt_tokens } }
 *
 * 用途:Prompt Mini-Harness 八维知识库的语义检索(PromptKnowledge.embedding 懒回填)。
 * ProviderKind 'embedding' 早已预留(types.ts);registry 走 getEmbeddingProvider。
 *
 * 后台配置示例(/admin/providers):
 *   providerId: 'relay-text-embedding-v4'
 *   defaultParams: { protocol: 'openai-compat', defaultModel: 'text-embedding-v4' }
 *   unitPriceCny: <CNY per 1K tokens — embedding 只有输入侧>
 *
 * 记账:action 'embedding.generate'(独立可检索;harness 流水线层若需并入
 * prompt.optimize 日预算池,由调用方 skipLedger + 自记 — docs/07 §4.6 记账收口)。
 */
import { request } from 'undici';

import { ProviderError } from '@ss/shared';

import { BaseProvider } from './base.js';
import { computeTextCostCny } from './pricing.js';
import type {
  CallContext,
  EmbeddingRequest,
  EmbeddingResult,
  ITextEmbeddingProvider,
  ProviderInfo,
} from './types.js';

export interface OpenAICompatEmbeddingConfig {
  /** Base URL,e.g. 'https://<relay-host>/v1' */
  apiUrl: string;
  apiKey: string;
  /** 默认模型 id,e.g. 'text-embedding-v4' / 'text-embedding-3-small' */
  defaultModel: string;
  /** CNY per 1K tokens(embedding 只算输入侧) */
  unitPriceCny: number;
  displayName?: string;
  maxConcurrent?: number;
  /** 单次请求输入条数上限(provider defaultParams.embeddingBatchSize;通义 v4 经 moyu ≤10) */
  maxBatchSize?: number;
  // 2 倍率(modelRate 非空时优先;embedding 无输出 token,outputRate 实际不生效)
  modelRate?: number;
  outputRate?: number;
}

interface OpenAIEmbeddingResponse {
  data?: Array<{ index?: number; embedding?: unknown }>;
  usage?: { prompt_tokens?: number; total_tokens?: number };
  error?: { message?: string };
}

/**
 * 解析 /embeddings 响应(纯函数,单测覆盖):
 *   - data[] 按 index 重排(OpenAI 协议不保证顺序)
 *   - 数量必须与输入一致,缺一即抛(静默缺行会让懒回填把向量写错条目)
 *   - 每条必须是非空 number[]
 */
export function parseEmbeddingsResponse(
  raw: unknown,
  expectedCount: number,
): { embeddings: number[][]; inputTokens: number } {
  const resp = raw as OpenAIEmbeddingResponse;
  if (!resp || !Array.isArray(resp.data)) {
    throw new Error(`embeddings 响应缺 data 数组: ${JSON.stringify(raw).slice(0, 200)}`);
  }
  if (resp.data.length !== expectedCount) {
    throw new Error(`embeddings 数量不符:期望 ${expectedCount} 条,返回 ${resp.data.length} 条`);
  }
  const out: number[][] = new Array(expectedCount);
  for (let i = 0; i < resp.data.length; i++) {
    const row: { index?: number; embedding?: unknown } = resp.data[i]!;
    // index 缺失时按数组位置兜底(部分中转站不回 index)
    const idx = typeof row.index === 'number' && Number.isInteger(row.index) ? row.index : i;
    if (idx < 0 || idx >= expectedCount || out[idx] !== undefined) {
      throw new Error(`embeddings index 非法或重复: ${idx}`);
    }
    const vec = row.embedding;
    if (!Array.isArray(vec) || vec.length === 0 || vec.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      throw new Error(`embeddings[${idx}] 不是合法 number[] 向量`);
    }
    out[idx] = vec as number[];
  }
  return { embeddings: out, inputTokens: resp.usage?.prompt_tokens ?? 0 };
}

export class OpenAICompatEmbeddingProvider extends BaseProvider implements ITextEmbeddingProvider {
  readonly info: ProviderInfo;
  readonly maxBatchSize?: number;

  constructor(private readonly cfg: OpenAICompatEmbeddingConfig) {
    super();
    if (cfg.maxBatchSize !== undefined && cfg.maxBatchSize >= 1) {
      this.maxBatchSize = Math.floor(cfg.maxBatchSize);
    }
    this.info = {
      id: cfg.defaultModel,
      displayName: cfg.displayName ?? `OpenAI-Compat Embedding (${cfg.defaultModel})`,
      kind: 'embedding',
      unitName: 'ktoken',
      defaultUnitPriceCny: cfg.unitPriceCny,
      maxConcurrent: cfg.maxConcurrent ?? 10,
    };
  }

  estimateCost(req: EmbeddingRequest): number {
    const approxIn = Math.ceil(req.texts.reduce((s, t) => s + t.length, 0) / 4);
    return computeTextCostCny(approxIn, 0, this.cfg);
  }

  async embed(req: EmbeddingRequest, ctx: CallContext): Promise<EmbeddingResult> {
    const modelId = req.model ?? this.cfg.defaultModel;
    if (req.texts.length === 0) {
      return { embeddings: [], dimensions: 0, inputTokens: 0, costCny: 0 };
    }
    await this.checkBudget(ctx.projectId, this.estimateCost(req));

    const body: Record<string, unknown> = { model: modelId, input: req.texts };
    if (req.extra) Object.assign(body, req.extra);

    let parsed: { embeddings: number[][]; inputTokens: number };
    let rawResponse: unknown;
    try {
      const { statusCode, body: respBody } = await request(`${this.cfg.apiUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        // embedding 输入小响应快,60s 富余足够(无需流式)
        bodyTimeout: 60_000,
        headersTimeout: 60_000,
      });
      const text = await respBody.text();
      if (statusCode >= 400) {
        let errMsg = `HTTP ${statusCode}: ${text.slice(0, 200)}`;
        try {
          const e = JSON.parse(text) as OpenAIEmbeddingResponse;
          if (e.error?.message) errMsg = e.error.message;
        } catch {
          /* not json */
        }
        throw new ProviderError(this.info.id, errMsg);
      }
      rawResponse = JSON.parse(text);
      parsed = parseEmbeddingsResponse(rawResponse, req.texts.length);
      // usage 缺失时按字符估算兜底(仅影响记账估值)
      if (parsed.inputTokens === 0) {
        parsed.inputTokens = Math.ceil(req.texts.reduce((s, t) => s + t.length, 0) / 4);
      }
    } catch (e) {
      await this.recordLedger({
        ctx,
        providerId: modelId,
        modelId,
        action: 'embedding.generate',
        inputUnits: 0,
        outputUnits: 0,
        unitPriceCny: this.cfg.unitPriceCny / 1000,
        success: false,
      });
      this.wrapCallError(e);
    }

    const costCny = computeTextCostCny(parsed.inputTokens, 0, this.cfg);
    await this.recordLedger({
      ctx,
      providerId: modelId,
      modelId,
      action: 'embedding.generate',
      inputUnits: parsed.inputTokens,
      outputUnits: 0,
      unitPriceCny: this.cfg.unitPriceCny / 1000,
      success: true,
      costCnyOverride: costCny,
    });

    return {
      embeddings: parsed.embeddings,
      dimensions: parsed.embeddings[0]?.length ?? 0,
      inputTokens: parsed.inputTokens,
      costCny,
      rawResponse,
    };
  }
}
