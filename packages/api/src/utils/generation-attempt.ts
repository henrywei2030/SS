/**
 * GenerationAttempt 状态机封装(P3 · ADR-31)。
 *
 * 收敛各 router 反复手写的「create RUNNING → 跑 → catch FAILED+脱敏+throw → SUCCESS」样板。
 * 先有此 helper + 单测锁行为,再逐处套用(防去重时悄改状态机/审计内容)。
 *
 * 适用:纯文本生成 attempt(无 CostLedger 双写、无 MediaItem 事务)—— inspiration + asset 文本系列。
 * 带 ledger/$transaction 的图像/视频路径不在此封装内(各自更复杂,见 ADR-31)。
 */
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@ss/db';
import { sanitizeErrorMsg } from '@ss/shared';

import type { Context } from '../context.js';

export interface TextAttemptOpts {
  projectId: string;
  /** providerId === modelId(文本走中转,二者同值)*/
  modelId: string;
  inputJson: Prisma.InputJsonValue;
  /** 失败时抛给前端的消息前缀(如「生成大纲失败」)—— 仅在 runFn 抛非 TRPCError 且未传 wrapError 时包裹 */
  failPrefix: string;
  /** 可选:attempt 额外列(asset 路径要写 assetId / episodeId 关联,inspiration 不传)*/
  assetId?: string;
  episodeId?: string;
  /**
   * 可选:自定义 provider 原始错误(非 TRPCError)的包裹方式 —— 给各 site 保持原有
   * errorMsg 文案 / cause 透传 / 附带 logOperation。
   * 不传 → 默认 `${failPrefix}:${sanitized}`(inspiration 历史行为)。
   * 入参:(rawError, sanitized) —— sanitized = sanitizeErrorMsg(rawError);
   * 返回:要抛出的 TRPCError(可在此函数内顺带做 logOperation 等副作用)。
   */
  wrapError?: (rawError: unknown, sanitized: string) => TRPCError | Promise<TRPCError>;
}

export interface TextAttemptResult<T> {
  inputTokens: number;
  outputTokens: number;
  costCny: number;
  value: T;
  /**
   * 软失败信号:生成确实跑了(花了钱),但产出不可用(如 JSON 解析失败 / 引擎 result.warning)。
   * 有 warning → attempt 置 FAILED(errorMsg = warning),但仍写 tokens/cost/durationMs 且正常 return value(不 throw)。
   * 无 warning → 照旧 SUCCESS。
   */
  warning?: string;
}

/**
 * 跑一次文本生成 attempt,统一状态机 + 审计:
 *   1. 建 RUNNING attempt(记 startedAt)
 *   2. await runFn(attemptId)(内部:调 provider + 解析 + 落业务库,返回 tokens/cost/业务值[/warning])
 *   3. runFn 抛错 → attempt 置 FAILED(errorMsg = 脱敏,写 durationMs)→ 重抛
 *      - runFn 抛的已是 TRPCError(如解析失败的自定义消息)→ 原样重抛(不二次包裹)
 *      - 否则(provider 原始错误)→ 用 wrapError(若传)或默认 `${failPrefix}:${脱敏}`
 *   4. runFn 返回带 warning → attempt 置 FAILED(errorMsg = warning,仍写真实 tokens/cost/durationMs)→ 返回业务值
 *   5. runFn 返回无 warning → attempt 置 SUCCESS(写真实 tokens/cost/durationMs)→ 返回业务值
 *
 * durationMs:SUCCESS / 软失败 / 抛错三条路径均写 Date.now() - startedAt(真实耗时)。
 */
export async function runTextGenerationAttempt<T>(
  ctx: Context,
  opts: TextAttemptOpts,
  runFn: (attemptId: string) => Promise<TextAttemptResult<T>>,
): Promise<T> {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });

  const startedAt = new Date();
  const attempt = await ctx.prisma.generationAttempt.create({
    data: {
      projectId: opts.projectId,
      ...(opts.assetId !== undefined ? { assetId: opts.assetId } : {}),
      ...(opts.episodeId !== undefined ? { episodeId: opts.episodeId } : {}),
      providerId: opts.modelId,
      modelId: opts.modelId,
      action: 'TEXT',
      inputJson: opts.inputJson,
      outputMediaIds: [],
      inputUnits: 0,
      outputUnits: 0,
      unitPriceCny: '0',
      costCny: '0',
      status: 'RUNNING',
      startedAt,
      createdBy: ctx.user.id,
    },
  });

  let out: TextAttemptResult<T>;
  try {
    out = await runFn(attempt.id);
  } catch (e) {
    await ctx.prisma.generationAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'FAILED',
        errorMsg: sanitizeErrorMsg(e),
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      },
    });
    if (e instanceof TRPCError) throw e;
    if (opts.wrapError) throw await opts.wrapError(e, sanitizeErrorMsg(e));
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `${opts.failPrefix}:${sanitizeErrorMsg(e)}`,
    });
  }

  await ctx.prisma.generationAttempt.update({
    where: { id: attempt.id },
    data: {
      status: out.warning ? 'FAILED' : 'SUCCESS',
      errorMsg: out.warning ?? null,
      costCny: out.costCny.toFixed(4),
      inputUnits: out.inputTokens,
      outputUnits: out.outputTokens,
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    },
  });

  return out.value;
}
