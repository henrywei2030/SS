/**
 * OpenAI-Compatible Text Provider
 *
 * 适配所有 OpenAI Chat Completions 兼容的中转 / 原生站点:
 *   - OpenAI 兼容中转站(OpenRouter / Poe / OneAPI 自部署 等)— Claude / GPT / Gemini / DeepSeek / 豆包 全系
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
 *   providerId: 'relay-claude-sonnet-4-5-20250929'
 *   apiUrl:     'https://<your-relay-host>/v1'
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
import { Agent, request, setGlobalDispatcher } from 'undici';

import { ProviderError } from '@ss/shared';

// 性能优化 r8:全局 undici Agent · keep-alive + 连接池
// 默认 undici 每个请求新建 socket,TLS handshake 50-200ms/次浪费严重
// 用 Agent keep-alive 复用 socket,大幅降低 LLM 调用 latency
// keepAliveTimeout 30s:Provider 端 idle 后会主动关连接,我们略短防写已关 socket
// connections: 32:per-origin 上限,够 5-10 并发 worker + 主进程用
const sharedDispatcher = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 32,
  pipelining: 1,
  bodyTimeout: 300_000, // 跟 generate() 内 fetch 一致 · LLM 长响应留余
  headersTimeout: 180_000, // 跟 r23 timeout bump 一致 · moyu 中转 + Anthropic 队列拥堵兜底
});

// 单次设置 process 级 dispatcher · 所有 undici.request 默认走这个 Agent
// 仅在 Node 进程内生效,跨 worker 各自初始化
let globalDispatcherSet = false;
function ensureGlobalDispatcher(): void {
  if (!globalDispatcherSet) {
    setGlobalDispatcher(sharedDispatcher);
    globalDispatcherSet = true;
  }
}

import { BaseProvider } from './base.js';
import type {
  CallContext,
  ITextProvider,
  ProviderInfo,
  TextRequest,
  TextResult,
} from './types.js';

export interface OpenAICompatTextConfig {
  /** Base URL, e.g. 'https://<your-relay-host>/v1' or 'https://api.openai.com/v1' */
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
  // Phase 1.5 P0-2:2 倍率(modelRate 非空时优先,跳过 inputUnitPrice/outputUnitPrice/unitPriceCny)
  // cost = inputUnits/1M × modelRate + outputUnits/1M × modelRate × outputRate
  modelRate?: number;
  outputRate?: number;
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
    // Phase 1.5 P0-2:modelRate 非空时优先 2 倍率公式
    if (this.cfg.modelRate != null && this.cfg.modelRate > 0) {
      const oRate = this.cfg.outputRate ?? 1;
      return (
        (approxIn / 1_000_000) * this.cfg.modelRate +
        (approxOut / 1_000_000) * this.cfg.modelRate * oRate
      );
    }
    if (this.cfg.inputUnitPriceCny != null && this.cfg.outputUnitPriceCny != null) {
      return (
        (approxIn / 1000) * this.cfg.inputUnitPriceCny +
        (approxOut / 1000) * this.cfg.outputUnitPriceCny
      );
    }
    return ((approxIn + approxOut) / 1000) * this.cfg.unitPriceCny;
  }

  async generate(req: TextRequest, ctx: CallContext): Promise<TextResult> {
    // 性能优化:第一次调用时设置全局 undici dispatcher(keep-alive Agent)
    ensureGlobalDispatcher();

    const modelId = req.model ?? this.cfg.defaultModel;
    await this.checkBudget(ctx.projectId, this.estimateCost(req));

    // 构造 messages:system 可选,跟 user content 一起放 messages 数组
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: req.prompt });

    // 三十六收工 P0 复审(真相):
    //   1) Sonnet 4.6 / Gemini 3 Flash / Haiku 4.5 via moyu 都能在 response_format=json_object 下产 JSON
    //   2) 之前观察的 "Sonnet 4.6 无视" 是因为我们多加了 assistant prefill,Sonnet 把 prefill 当对话续接
    //   3) prefill 仅在调用方**显式**传 jsonPrefill 时才启用(不再默认开)
    const usePrefill = !!req.jsonPrefill;
    const prefillContent = req.jsonPrefill ?? '';
    if (usePrefill) {
      messages.push({ role: 'assistant', content: prefillContent });
    }

    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      max_tokens: req.maxTokens ?? 4096,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    // jsonSchema 触发 response_format(OpenAI / Anthropic 在多数中转站都支持)
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
        // Phase 1.5.3:Sonnet 4.5 详细 prompt + 大响应偶尔慢,bump 到 180s
        // 原 60s headersTimeout 在 moyu 中转 + Anthropic 队列拥挤时常超("Headers Timeout Error")
        bodyTimeout: 300_000,
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

    // 三十六收工 P0 修:prefill 模式下 prepend prefill content 还原完整 JSON
    const rawContent = resp.choices?.[0]?.message?.content ?? '';
    const content = usePrefill ? prefillContent + rawContent : rawContent;
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
      // Phase 1.5 P0-2:已用 calcCost 算好真实 cost(走 2 倍率优先),透给 BaseProvider 直接落库
      costCnyOverride: costCny,
    });

    // JSON 模式:request_format=json_object 时优先 JSON.parse;否则也尝试剥 ```json 容错
    // 三十六收工 fix:加 inner ```json``` markdown block 提取(LLM 解释 + JSON 混合常见)
    let json: unknown;
    if (req.jsonSchema) {
      try {
        json = JSON.parse(content);
      } catch {
        const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
        try {
          json = JSON.parse(cleaned);
        } catch {
          // 三十六收工 fix #2:正则提取 markdown 内 ```json ... ``` block(Claude 习惯包 markdown)
          const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (fenced && fenced[1]) {
            try {
              json = JSON.parse(fenced[1]);
            } catch {
              /* 继续 fallback */
            }
          }
          if (!json) {
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
      // 三十六收工 fix #3:解析失败时打 raw content 让运维 grep 排查
      if (!json) {
        console.warn(
          `[openai-compat] modelId=${modelId} response_format=json_object but JSON.parse all-fallback failed. raw content (first 500 chars):`,
          content.slice(0, 500),
        );
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
    // Phase 1.5 P0-2:modelRate 非空时优先 2 倍率公式(主次重审 v2.1)
    if (this.cfg.modelRate != null && this.cfg.modelRate > 0) {
      const oRate = this.cfg.outputRate ?? 1;
      return (
        (inTokens / 1_000_000) * this.cfg.modelRate +
        (outTokens / 1_000_000) * this.cfg.modelRate * oRate
      );
    }
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
