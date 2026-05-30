/**
 * Claude (Anthropic) Text Provider — Phase 1 剧本分析 LLM
 *
 * API: https://docs.anthropic.com/en/api/messages
 * 模型 ID: claude-sonnet-4-5-20250929 (默认)
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

export interface ClaudeProviderConfig {
  apiUrl: string;
  apiKey: string;
  defaultModel: string;
  /** CNY per 1K tokens（输入输出合并） */
  unitPriceCny: number;
}

interface AnthropicResponse {
  id: string;
  type: string;
  content: { type: string; text?: string }[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
}

export class ClaudeTextProvider extends BaseProvider implements ITextProvider {
  readonly info: ProviderInfo;

  constructor(private readonly cfg: ClaudeProviderConfig) {
    super();
    this.info = {
      id: cfg.defaultModel,
      displayName: 'Claude（剧本分析 LLM）',
      kind: 'text',
      unitName: 'ktoken',
      defaultUnitPriceCny: cfg.unitPriceCny,
      maxConcurrent: 10,
    };
  }

  estimateCost(req: TextRequest): number {
    const approxTokens = Math.ceil((req.prompt.length + (req.system?.length ?? 0)) / 4);
    const approxOut = Math.min(req.maxTokens ?? 4096, 4096);
    return ((approxTokens + approxOut) / 1000) * this.cfg.unitPriceCny;
  }

  async generate(req: TextRequest, ctx: CallContext): Promise<TextResult> {
    const modelId = req.model ?? this.cfg.defaultModel;

    await this.checkBudget(ctx.projectId, this.estimateCost(req));

    const body = {
      model: modelId,
      max_tokens: req.maxTokens ?? 4096,
      ...(req.temperature !== undefined && { temperature: req.temperature }),
      ...(req.system && { system: req.system }),
      messages: [{ role: 'user', content: req.prompt }],
    };

    let resp: AnthropicResponse;
    const startedAt = Date.now();
    try {
      const { statusCode, body: respBody } = await request(`${this.cfg.apiUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.cfg.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        bodyTimeout: 120_000,
        headersTimeout: 60_000,
      });
      const text = await respBody.text();
      if (statusCode >= 400) {
        throw new ProviderError(this.info.id, `Anthropic API ${statusCode}: ${text.slice(0, 200)}`);
      }
      resp = JSON.parse(text) as AnthropicResponse;
    } catch (e) {
      await this.recordLedger({
        ctx,
        providerId: modelId,
        modelId,
        action: 'text.generate',
        inputUnits: 0,
        outputUnits: 0,
        unitPriceCny: this.cfg.unitPriceCny / 1000,
        success: false,
      });
      this.wrapCallError(e);
    }

    const text = resp.content.find((c) => c.type === 'text')?.text ?? '';
    const inputTokens = resp.usage.input_tokens;
    const outputTokens = resp.usage.output_tokens;
    const totalKt = (inputTokens + outputTokens) / 1000;
    const costCny = totalKt * this.cfg.unitPriceCny;

    await this.recordLedger({
      ctx,
      providerId: modelId,
      modelId,
      action: 'text.generate',
      inputUnits: inputTokens,
      outputUnits: outputTokens,
      unitPriceCny: this.cfg.unitPriceCny / 1000,
      success: true,
    });

    let json: unknown;
    if (req.jsonSchema) {
      try {
        // Claude 倾向于把 JSON 包在 ```json ... ``` 里，先剥离
        const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
        json = JSON.parse(cleaned);
      } catch {
        // 二次容错：尝试找到第一个 { 到最后一个 }
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
          try {
            json = JSON.parse(text.slice(start, end + 1));
          } catch {
            /* 留给业务层处理 */
          }
        }
      }
    }

    void startedAt;
    return {
      text,
      json,
      inputTokens,
      outputTokens,
      costCny,
      rawResponse: resp,
    };
  }
}
