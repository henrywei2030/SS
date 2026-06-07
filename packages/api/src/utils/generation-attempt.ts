/**
 * GenerationAttempt 状态机封装(P3 · ADR-31)。
 *
 * 收敛各 router 反复手写的「create RUNNING → 跑 → catch FAILED+脱敏+throw → SUCCESS」样板。
 * 先有此 helper + 单测锁行为,再逐处套用(防去重时悄改状态机/审计内容)。
 *
 * 适用:纯文本生成 attempt(无 CostLedger 双写、无 MediaItem 事务)—— inspiration 系列。
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
  /** 失败时抛给前端的消息前缀(如「生成大纲失败」)—— 仅在 runFn 抛非 TRPCError 时包裹 */
  failPrefix: string;
}

export interface TextAttemptResult<T> {
  inputTokens: number;
  outputTokens: number;
  costCny: number;
  value: T;
}

/**
 * 跑一次文本生成 attempt,统一状态机 + 审计:
 *   1. 建 RUNNING attempt
 *   2. await runFn(attemptId)(内部:调 provider + 解析 + 落业务库,返回 tokens/cost/业务值)
 *   3. runFn 抛错 → attempt 置 FAILED(errorMsg = 脱敏)→ 重抛
 *      - runFn 抛的已是 TRPCError(如解析失败的自定义消息)→ 原样重抛(不二次包裹)
 *      - 否则(provider 原始错误)→ 包成 `${failPrefix}:${脱敏}`
 *   4. runFn 成功 → attempt 置 SUCCESS(写真实 tokens/cost)→ 返回业务值
 *
 * 行为与原手写一致;唯一统一点:FAILED 的 errorMsg 一律 = sanitizeErrorMsg(抛出物)
 *   (原解析失败处写的是更短的自定义串,现与抛给前端的消息一致 —— 审计可读性更好的小归一)。
 */
export async function runTextGenerationAttempt<T>(
  ctx: Context,
  opts: TextAttemptOpts,
  runFn: (attemptId: string) => Promise<TextAttemptResult<T>>,
): Promise<T> {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });

  const attempt = await ctx.prisma.generationAttempt.create({
    data: {
      projectId: opts.projectId,
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
      startedAt: new Date(),
      createdBy: ctx.user.id,
    },
  });

  let out: TextAttemptResult<T>;
  try {
    out = await runFn(attempt.id);
  } catch (e) {
    await ctx.prisma.generationAttempt.update({
      where: { id: attempt.id },
      data: { status: 'FAILED', errorMsg: sanitizeErrorMsg(e), finishedAt: new Date() },
    });
    if (e instanceof TRPCError) throw e;
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `${opts.failPrefix}:${sanitizeErrorMsg(e)}`,
    });
  }

  await ctx.prisma.generationAttempt.update({
    where: { id: attempt.id },
    data: {
      status: 'SUCCESS',
      costCny: out.costCny.toFixed(4),
      inputUnits: out.inputTokens,
      outputUnits: out.outputTokens,
      finishedAt: new Date(),
    },
  });

  return out.value;
}
