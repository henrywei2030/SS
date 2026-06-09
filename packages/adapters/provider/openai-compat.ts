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

import { computeTextCostCny } from './pricing.js';

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
  // 四九收工 P0:TCP connect 60s — 默认 10s 不够,moyu 中转偶发抖动(跟 seedance.ts r15 修复对齐)
  // 症状:curl 连 moyu 0.2s 就通,但 undici 默认 10s connect 偶发 Connect Timeout Error
  // → 剧本分析/分镜/灵感创作等所有走 moyu 的文本 LLM 间歇性失败
  connect: { timeout: 60_000 },
  // 四九收工:headers/body 提到 300s — 非流式 LLM 大输出(灵感全部展开分块多集 / 慢模型
  // 如 moyu sonnet ~40 tok/s)要全生成完才返 headers,180s 不够(实测 3 集 sonnet 撞 182s)
  bodyTimeout: 300_000,
  headersTimeout: 300_000,
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
import { tryParseLlmJson } from './parse-llm-json.js';
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

// OpenAI 兼容流式(SSE)分片
interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: { role?: string; content?: string };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string };
}

/**
 * 解析整条 OpenAI 兼容 SSE 流 → 累计 delta.content / finish_reason / usage。
 *
 * 改流式的原因(2026-06-09):非流式下中转站要等整段生成完才返响应头,慢模型大输出
 *   (moyu sonnet ~40 tok/s,拆解多集 >12k tokens)生成 >300s 撞 headersTimeout。
 *   stream:true 后响应头秒回(满足 headersTimeout),token 持续到达(满足 bodyTimeout 的
 *   chunk 间 idle 判定)→ 彻底拿掉"生成时长上限"。仅需最终结果,故收齐整流再解析,不向调用方增量透出。
 */
function parseOpenAIStream(sse: string): {
  content: string;
  finishReason?: string;
  usage: { prompt_tokens: number; completion_tokens: number } | null;
  streamError?: string;
} {
  let content = '';
  let finishReason: string | undefined;
  let usage: { prompt_tokens: number; completion_tokens: number } | null = null;
  let streamError: string | undefined;
  for (const rawLine of sse.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue; // 跳过空行 / `: keep-alive` 注释行
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let evt: OpenAIStreamChunk;
    try {
      evt = JSON.parse(data) as OpenAIStreamChunk;
    } catch {
      continue;
    }
    if (evt.error?.message) streamError = evt.error.message;
    const choice = evt.choices?.[0];
    if (choice?.delta?.content) content += choice.delta.content;
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (evt.usage) {
      usage = {
        prompt_tokens: evt.usage.prompt_tokens ?? 0,
        completion_tokens: evt.usage.completion_tokens ?? 0,
      };
    }
  }
  return { content, finishReason, usage, streamError };
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
    // 全盘审查 #7:不再钳 4096 — storyboard 实传 maxTokens=16000,钳死会让事前预算护栏
    //   把大输出请求的成本系统性低估 ~3/4(真实记账走 calcCost 用实际 usage,不受影响)
    const approxOut = req.maxTokens ?? 4096;
    // 五八-P1:计费公式集中到 pricing.computeTextCostCny(估算/记账共用同一份,防漂移 + 有单测锁口径)
    return computeTextCostCny(approxIn, approxOut, this.cfg);
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
    // 流式调用 —— 见 parseOpenAIStream 注释:headers 秒回拿掉非流式生成时长上限。
    //   放在 extra 之后,确保不被覆盖。
    body.stream = true;
    body.stream_options = { include_usage: true };

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
        // 改流式后响应头秒回 → 不再受"非流式整段生成完才返 headers"的时长上限约束。
        // 仍留 300s 富余:headersTimeout 防中转站迟迟不发首字节;bodyTimeout 是 chunk 间 idle
        // 判定,token 持续到达不触发(慢模型大输出也安全)。per-request 覆盖 > sharedDispatcher。
        bodyTimeout: 300_000,
        headersTimeout: 300_000,
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
      // 改流式后 text 是 SSE(data: 行序列),非单个 JSON → 解析还原成 resp 形状,下游零改动。
      const stream = parseOpenAIStream(text);
      if (stream.streamError) {
        // 200 后流中途报错(上游模型错误等)
        throw new ProviderError(this.info.id, stream.streamError);
      }
      if (stream.content || stream.usage || stream.finishReason) {
        // usage 优先用流尾 stream_options 的真实值;中转站若没返则按字符估算兜底(仅影响计费估值)
        const usage = stream.usage ?? {
          prompt_tokens: Math.ceil((req.prompt.length + (req.system?.length ?? 0)) / 4),
          completion_tokens: Math.ceil(stream.content.length / 4),
        };
        resp = {
          choices: [
            {
              message: { role: 'assistant', content: stream.content },
              finish_reason: stream.finishReason,
            },
          ],
          usage,
        };
      } else {
        // 兜底:中转站忽略了 stream(返回普通 JSON completion 而非 SSE)→ 按非流式解析。
        resp = JSON.parse(text) as OpenAIChatResponse;
      }
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
    // 全盘审查 #5:检测 maxTokens 截断(finish_reason=length)— 残缺 JSON 可能被裸花括号
    //   fallback 解析成"少镜头"的合法对象,需透传给业务层让 warning 文案能区分截断
    const truncated = resp.choices?.[0]?.finish_reason === 'length';
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

    // JSON 模式:全盘审查 #12 用共享 tryParseLlmJson(4 级 fallback 抽到 parse-llm-json.ts,
    //   与 claude.ts 共用防实现漂移:直接 parse → 剥首尾 fence → 正则提 ```json``` block → 裸花括号)
    let json: unknown;
    if (req.jsonSchema) {
      json = tryParseLlmJson(content);
      // 三十六收工 fix #3 + 全盘审查 #5:解析失败时打 raw + finish_reason,
      //   让运维区分"模型不听话"(stop)vs"输出被 maxTokens 砍断"(length,调大 maxTokens 即可)
      if (!json) {
        console.warn(
          `[openai-compat] modelId=${modelId} response_format=json_object but JSON.parse all-fallback failed` +
            ` (finish_reason=${resp.choices?.[0]?.finish_reason ?? 'unknown'}${truncated ? ', TRUNCATED' : ''}). raw (first 500 chars):`,
          content.slice(0, 500),
        );
      }
    }

    return {
      text: content,
      json,
      truncated,
      inputTokens,
      outputTokens,
      costCny,
      rawResponse: resp,
    };
  }

  private calcCost(inTokens: number, outTokens: number): number {
    // 五八-P1:与 estimateCost 共用 pricing.computeTextCostCny(单一真相源 + 单测锁 moyu 口径)
    return computeTextCostCny(inTokens, outTokens, this.cfg);
  }

  /** ledger 行的 unitPriceCny 字段(per token,Decimal 处理用) */
  private unitPriceForLedger(): number {
    // 简化:用合并价 / 1000(per token)
    return this.cfg.unitPriceCny / 1000;
  }
}
