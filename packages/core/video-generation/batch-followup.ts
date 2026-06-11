/**
 * F4 批量 take 终态跟进 — worker 侧(video process-job 成功/失败路径末尾调用)。
 *
 * 仅对批次标签(GenerationAttempt.groupId = batch_*)的 attempt 生效,单点生成零影响:
 *   1. 失败且 retryable → 自动重抽(≤ batch.retry.max,默认 0=关;同组同批次 attempt
 *      计数推算已用重试数;重抽走 submitVideoGeneration 单一真相源,挂同批次标签)
 *   2. 批次无 inflight → 完成通知(成功 X/Z 组;全败单独 type)— advisory lock +
 *      Notification.payload.batchId 判重,多 worker 并发终态只发一次
 *
 * 失败语义:本函数 throw 不影响主流程 — 调用方 try/catch console.warn(增强项纪律,
 * 同 cache-video / qc 入队)。通知 webhook 不在事务内(先落库占位,后 best-effort 外推)。
 */
import type { PrismaClient } from '@ss/db';

import {
  BATCH_RETRY_MAX_KEY,
  batchDurationS,
  isBatchGroupId,
  parseBatchRetryMax,
} from './batch.js';
import { maybeNotifyBatchDone } from './batch-notify.js';
import { loadVideoGenBindings } from './bindings.js';
import { submitVideoGeneration } from './submit.js';

export interface BatchTerminalArgs {
  attemptId: string;
  shotGroupId: string;
  projectId: string;
  episodeId: string;
  userId: string;
  outcome: 'success' | 'failed';
  /** 失败分类(process-job isUnrecoverableError)— 硬错不重抽 */
  unrecoverable?: boolean;
  requestId?: string;
}

export async function handleBatchTerminal(
  prisma: PrismaClient,
  args: BatchTerminalArgs,
): Promise<void> {
  const reqTag = args.requestId ? `[req=${args.requestId}]` : '';
  const attempt = await prisma.generationAttempt.findUnique({
    where: { id: args.attemptId },
    select: { groupId: true },
  });
  const batchId = attempt?.groupId;
  if (!isBatchGroupId(batchId)) return; // 非批量 attempt,零开销退出

  // ---- 1) 失败 retryable 自动重抽(≤ batch.retry.max) ----
  if (args.outcome === 'failed' && !args.unrecoverable) {
    const retryMax = parseBatchRetryMax(
      (
        await prisma.systemSetting.findUnique({
          where: { key: BATCH_RETRY_MAX_KEY },
          select: { value: true },
        })
      )?.value,
    );
    if (retryMax > 0) {
      // 同批次同组「真跑过」的 attempt 总数 - 1 = 已用重试数(首发也在批次标签下)。
      // 深审修(F-4):startedAt 非空过滤 — precheck 被拒的占位 FAILED(startedAt=null)
      // 不算重试额度,否则瞬时预算抖动/并发 CONFLICT 会白白吃掉自动重抽次数
      const groupAttempts = await prisma.generationAttempt.count({
        where: {
          groupId: batchId,
          shotGroupId: args.shotGroupId,
          action: 'VIDEO',
          startedAt: { not: null },
        },
      });
      const retriesUsed = groupAttempts - 1;
      if (retriesUsed < retryMax) {
        await resubmitBatchGroup(prisma, {
          shotGroupId: args.shotGroupId,
          batchId,
          userId: args.userId,
          requestId: args.requestId,
          attemptNo: groupAttempts + 1,
        });
      } else {
        console.warn(
          `[batch]${reqTag} 组 ${args.shotGroupId} 重试额度用尽(${retriesUsed}/${retryMax}),不再自动重抽`,
        );
      }
    }
  }

  // ---- 2) 批次完成判定 + 通知(一次性) ----
  // 七二抽到 batch-notify.ts(API 侧终结点共用:全 denied / stale-sweep / boot 恢复);
  // 幂等与竞态语义原样保留,见该文件头注释。
  await maybeNotifyBatchDone(prisma, {
    batchId,
    userId: args.userId,
    projectId: args.projectId,
    episodeId: args.episodeId,
    ...(args.requestId ? { requestId: args.requestId } : {}),
  });
}

/** 批量自动重抽 — 与首发同口径(bindings 默认参数 + batchDurationS 时长公式 + 同批次标签) */
async function resubmitBatchGroup(
  prisma: PrismaClient,
  args: {
    shotGroupId: string;
    batchId: string;
    userId: string;
    requestId?: string;
    attemptNo: number;
  },
): Promise<void> {
  const reqTag = args.requestId ? `[req=${args.requestId}]` : '';
  const grp = await prisma.shotGroup.findFirst({
    where: { id: args.shotGroupId, deletedAt: null },
    select: {
      id: true,
      number: true,
      prompt: true,
      durationS: true,
      episodeId: true,
      episode: { select: { projectId: true } },
    },
  });
  if (!grp) {
    console.warn(`[batch]${reqTag} 重抽目标组 ${args.shotGroupId} 已删,跳过`);
    return;
  }
  const bindings = await loadVideoGenBindings(prisma);
  if (!bindings.providerId) {
    console.warn(`[batch]${reqTag} binding.shot.video.providerId 已被清空,跳过重抽`);
    return;
  }
  const result = await submitVideoGeneration(prisma, {
    group: {
      id: grp.id,
      number: grp.number,
      prompt: grp.prompt,
      durationS: grp.durationS,
      episodeId: grp.episodeId,
      projectId: grp.episode.projectId,
    },
    userId: args.userId,
    providerId: bindings.providerId,
    durationS: batchDurationS(grp.durationS, bindings.maxDurationS),
    aspectRatio: bindings.defaultAspectRatio,
    wantAudio: bindings.defaultGenerateAudio,
    dailyBudgetCny: bindings.dailyBudgetCny,
    requestId: args.requestId,
    attemptGroupId: args.batchId,
  });
  if (result.ok) {
    console.log(
      `[batch]${reqTag} 组 ${grp.number} 自动重抽已入队(第 ${args.attemptNo} 次,attempt=${result.attemptId})`,
    );
  } else {
    console.warn(
      `[batch]${reqTag} 组 ${grp.number} 自动重抽被拒(${result.code}):${result.message}`,
    );
  }
}
