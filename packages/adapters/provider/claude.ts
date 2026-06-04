/**
 * Claude (Anthropic) Text Provider — Phase 1 剧本分析 LLM
 *
 * API: https://docs.anthropic.com/en/api/messages
 * 模型 ID: claude-sonnet-4-5-20250929 (默认)
 */
import { Agent, request } from 'undici';

import { ProviderError } from '@ss/shared';

import { BaseProvider } from './base.js';
import { tryParseLlmJson } from './parse-llm-json.js';
import type {
  CallContext,
  ITextProvider,
  ProviderInfo,
  TextRequest,
  TextResult,
} from './types.js';

// 全盘审查 #10:对齐 openai-compat — Anthropic 直连原为裸 request,无 connect timeout(undici 默认 10s)
//   且 headersTimeout 仅 60s,慢模型大输出(剧本分析/分镜)易撞超时。统一 connect 60s + body/headers 300s。
const claudeDispatcher = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 16,
  pipelining: 1,
  connect: { timeout: 60_000 },
  bodyTimeout: 300_000,
  headersTimeout: 300_000,
});

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
    // 全盘审查 #7:不再钳 4096(与 openai-compat 对齐)— 大输出请求事前预算预估不再系统性偏低
    const approxOut = req.maxTokens ?? 4096;
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
        dispatcher: claudeDispatcher, // 全盘审查 #10:connect 60s + body/headers 300s
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
    // 全盘审查 #5:Anthropic stop_reason=max_tokens 即被 maxTokens 截断
    const truncated = resp.stop_reason === 'max_tokens';
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

    // 全盘审查 #12:用共享 tryParseLlmJson(原 claude 仅 2 级 fallback,缺"正则提内嵌 ```json``` block"
    //   那级 → 与 openai-compat 漂移;统一为 4 级 fallback)
    let json: unknown;
    if (req.jsonSchema) {
      json = tryParseLlmJson(text);
      // 全盘审查 #5:解析失败时带上 stop_reason,运维区分模型不听话 vs 输出被截断
      if (!json) {
        console.warn(
          `[claude] modelId=${modelId} jsonSchema set but JSON.parse all-fallback failed` +
            ` (stop_reason=${resp.stop_reason}${truncated ? ', TRUNCATED' : ''}). raw (first 500 chars):`,
          text.slice(0, 500),
        );
      }
    }

    void startedAt;
    return {
      text,
      json,
      truncated,
      inputTokens,
      outputTokens,
      costCny,
      rawResponse: resp,
    };
  }
}
