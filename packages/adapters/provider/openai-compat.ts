/**
 * OpenAI-Compatible Text Provider
 *
 * 适配所有 OpenAI Chat Completions 兼容的中转 / 原生站点:
 *   - moyu.info (魔芋 AI 中转站) — Claude / GPT / Gemini / DeepSeek / 豆包 全系
 *   - Poe (poe.com/api-docs)
 *   - OpenRouter
 *   - OpenAI 直连
 *   - 任意 new-api / one-api 衍生站
 *
 * 协议:POST {apiUrl}/chat/completions(OpenAI 标准格式)
 *   request:  { model, messages: [{ role, content }], max_tokens, temperature, response_format }
 *   response: { choices: [{ message: { role, content }}], usage: { prompt_tokens, completion_tokens } }
 *
 * vs ClaudeTextProvider(Anthropic 原生 /messages):
 *   - 此 Provider 通过中转 / OpenAI 兼容协议,model 字段后台可选
 *   - Claude Provider 直接打 api.anthropic.com,Anthropic 原生 endpoint
 *
 * 后台配置示例(seed.ts ProviderConfig 或 admin/providers UI):
 *   providerId: 'moyu-claude-sonnet-4-5-20250929'
 *   apiUrl:     'https://www.moyu.info/v1'
 *   apiKeyEnc:  <加密的 sk-xxx>
 *   defaultParams: {
 *     protocol: 'openai-compat',
 *     defaultModel: 'claude-sonnet-4-5-20250929',
 *     // 可选:输入/输出分离单价(更精确,默认两边都按 unitPriceCny)
 *     // inputUnitPriceCny: 0.003,
 *     // outputUnitPriceCny: 0.015,
 *   }
 *   unitPriceCny: <CNY per 1K tokens 合并价>
 */
import { request } from 'undici';

import { ProviderError } from '@ss/shared';

import { BaseProvider } from './base.js';
import type {
  CallContext,
  ITextProvider,
  ProviderInfo,
  TextRequest,
  TextResult,
} from './types.js';

export interface OpenAICompatTextConfig {
  /** Base URL, e.g. 'https://www.moyu.info/v1' or 'https://api.openai.com/v1' */
  apiUrl: string;
  apiKey: string;
  /** 默认模型 id, e.g. 'claude-sonnet-4-5-20250929' / 'gpt-4o' / 'deepseek-chat' */
  defaultModel: string;
  /** CNY per 1K tokens (输入+输出合并价) — 简化计价 */
  unitPriceCny: number;
  /** 输入/输出分离单价(可选,更精确;不填则用 unitPriceCny 兼算) */
  inputUnitPriceCny?: number;
  outputUnitPriceCny?: number;
  /** 显示名,UI 用 */
  displayName?: string;
  /** 最大并发,默认 10 */
  maxConcurrent?: number;
}

interface OpenAIChatResponse {
  id?: string;
  object?: string;
  model?: string;
  choices: Array<{
    index?: number;
    message: { role: string; content: string };
    finish_reason?: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
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

export class OpenAICompatTextProvider extends BaseProvider implements ITextProvider {
  readonly info: ProviderInfo;

  constructor(private readonly cfg: OpenAICompatTextConfig) {
    super();
    this.info = {
      id: cfg.defaultModel,
      displayName: cfg.displayName ?? `OpenAI-Compat (${cfg.defaultModel})`,
      kind: 'text',
      unitName: 'ktoken',
      defaultUnitPriceCny: cfg.unitPriceCny,
      maxConcurrent: cfg.maxConcurrent ?? 10,
    };
  }

  estimateCost(req: TextRequest): number {
    const approxIn = Math.ceil((req.prompt.length + (req.system?.length ?? 0)) / 4);
    const approxOut = Math.min(req.maxTokens ?? 4096, 4096);
    if (this.cfg.inputUnitPriceCny != null && this.cfg.outputUnitPriceCny != null) {
      return (
        (approxIn / 1000) * this.cfg.inputUnitPriceCny +
        (approxOut / 1000) * this.cfg.outputUnitPriceCny
      );
    }
    return ((approxIn + approxOut) / 1000) * this.cfg.unitPriceCny;
  }

  async generate(req: TextRequest, ctx: CallContext): Promise<TextResult> {
    const modelId = req.model ?? this.cfg.defaultModel;
    await this.checkBudget(ctx.projectId, this.estimateCost(req));

    // 构造 messages:system 可选,跟 user content 一起放 messages 数组
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: req.prompt });

    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      max_tokens: req.maxTokens ?? 4096,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    // jsonSchema 触发 response_format(OpenAI / Anthropic 在 moyu 都支持)
    if (req.jsonSchema) {
      body.response_format = { type: 'json_object' };
    }
    if (req.extra) Object.assign(body, req.extra);

    let resp: OpenAIChatResponse;
    try {
      const { statusCode, body: respBody } = await request(`${this.cfg.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
          // 透传上游 trace id(若 ctx 有 requestId,Phase 2 加)
        },
        body: JSON.stringify(body),
        bodyTimeout: 120_000,
        headersTimeout: 60_000,
      });
      const text = await respBody.text();
      if (statusCode >= 400) {
        let parsed: OpenAIErrorResponse | null = null;
        try {
          parsed = JSON.parse(text) as OpenAIErrorResponse;
        } catch {
          /* not json */
        }
        const errMsg =
          parsed?.error?.message ?? `HTTP ${statusCode}: ${text.slice(0, 200)}`;
        throw new ProviderError(this.info.id, errMsg);
      }
      resp = JSON.parse(text) as OpenAIChatResponse;
    } catch (e) {
      // 失败:Provider 内置 ledger 跳过(router 单点写,ADR-25)— skipLedger:true 时不记
      await this.recordLedger({
        ctx,
        providerId: modelId,
        modelId,
        action: 'text.generate',
        inputUnits: 0,
        outputUnits: 0,
        unitPriceCny: this.unitPriceForLedger(),
        success: false,
      });
      this.wrapCallError(e);
    }

    const content = resp.choices?.[0]?.message?.content ?? '';
    const inputTokens = resp.usage?.prompt_tokens ?? 0;
    const outputTokens = resp.usage?.completion_tokens ?? 0;
    const costCny = this.calcCost(inputTokens, outputTokens);

    await this.recordLedger({
      ctx,
      providerId: modelId,
      modelId,
      action: 'text.generate',
      inputUnits: inputTokens,
      outputUnits: outputTokens,
      unitPriceCny: this.unitPriceForLedger(),
      success: true,
    });

    // JSON 模式:request_format=json_object 时优先 JSON.parse;否则也尝试剥 ```json 容错
    let json: unknown;
    if (req.jsonSchema) {
      try {
        json = JSON.parse(content);
      } catch {
        const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
        try {
          json = JSON.parse(cleaned);
        } catch {
          const start = content.indexOf('{');
          const end = content.lastIndexOf('}');
          if (start >= 0 && end > start) {
            try {
              json = JSON.parse(content.slice(start, end + 1));
            } catch {
              /* 留给业务层处理 */
            }
          }
        }
      }
    }

    return {
      text: content,
      json,
      inputTokens,
      outputTokens,
      costCny,
      rawResponse: resp,
    };
  }

  private calcCost(inTokens: number, outTokens: number): number {
    if (this.cfg.inputUnitPriceCny != null && this.cfg.outputUnitPriceCny != null) {
      return (
        (inTokens / 1000) * this.cfg.inputUnitPriceCny +
        (outTokens / 1000) * this.cfg.outputUnitPriceCny
      );
    }
    return ((inTokens + outTokens) / 1000) * this.cfg.unitPriceCny;
  }

  /** ledger 行的 unitPriceCny 字段(per token,Decimal 处理用) */
  private unitPriceForLedger(): number {
    // 简化:用合并价 / 1000(per token)
    return this.cfg.unitPriceCny / 1000;
  }
}
