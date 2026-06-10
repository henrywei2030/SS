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
import { NOTIFY_WEBHOOK_URL_KEY, sendWebhook } from '../notify/index.js';

import {
  BATCH_RETRY_MAX_KEY,
  batchDurationS,
  isBatchGroupId,
  parseBatchRetryMax,
} from './batch.js';
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
  // 已知边界(深审 F-3 记账):跨 worker 竞态下,"A 组失败事务已提交但 A 的重抽占位还没
  // 建" 的 ms 级窗口内,B 组的完成判定可能提前发通知(统计少算 A 的重抽结果)。无资金
  // 影响,仅通知时点/计数偏差;同 worker 内重抽先行于完成判定已消大头。
  // 快速路径:有 inflight(含上面刚重抽出的新占位)直接返回,锁留给真正的收尾竞争者
  const inflight = await prisma.generationAttempt.count({
    where: { groupId: batchId, action: 'VIDEO', status: { in: ['QUEUED', 'RUNNING'] } },
  });
  if (inflight > 0) return;

  let done: { ok: number; failed: number; total: number; allFailed: boolean } | null = null;
  await prisma.$transaction(async (tx) => {
    // 并发终态(多 worker 同时收尾)串行化;锁内重查防 TOCTOU
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext('batch_done:' || $1)::bigint)`,
      batchId,
    );
    const already = await tx.notification.findFirst({
      where: {
        type: { in: ['batch_done', 'batch_failed'] },
        payload: { path: ['batchId'], equals: batchId },
      },
      select: { id: true },
    });
    if (already) return;
    const rows = await tx.generationAttempt.findMany({
      where: { groupId: batchId, action: 'VIDEO' },
      select: { shotGroupId: true, status: true },
    });
    if (rows.some((r) => r.status === 'QUEUED' || r.status === 'RUNNING')) return; // 锁内复查:有重抽进来,还没完
    const allGroups = new Set(rows.map((r) => r.shotGroupId).filter(Boolean));
    const okGroups = new Set(
      rows.filter((r) => r.status === 'SUCCESS').map((r) => r.shotGroupId).filter(Boolean),
    );
    const total = allGroups.size;
    const ok = okGroups.size;
    const allFailed = ok === 0;
    // 通知先落库(webhook 在事务外 best-effort,防网络调用占着事务)
    await tx.notification.create({
      data: {
        userId: args.userId,
        type: allFailed ? 'batch_failed' : 'batch_done',
        title: allFailed
          ? `批量生成全部失败(${total} 组)`
          : `批量生成完成:成功 ${ok}/${total} 组`,
        body: allFailed
          ? '本批次没有任何成功 take — 检查 Provider 配置 / 余额 / 失败原因后重试'
          : `失败 ${total - ok} 组${total - ok > 0 ? ',可去工作台单独重抽' : ''}`,
        payload: { batchId, episodeId: args.episodeId, projectId: args.projectId, success: ok, failed: total - ok, total },
      },
      select: { id: true },
    });
    done = { ok, failed: total - ok, total, allFailed };
  });

  if (done !== null) {
    const d: { ok: number; failed: number; total: number; allFailed: boolean } = done;
    console.log(
      `[batch]${reqTag} 批次 ${batchId} 完成:成功 ${d.ok}/${d.total} 组(通知已落库)`,
    );
    // webhook 外推(口径同 notify():落库优先,外推 best-effort 不抛)
    const url = (
      await prisma.systemSetting.findUnique({
        where: { key: NOTIFY_WEBHOOK_URL_KEY },
        select: { value: true },
      })
    )?.value?.trim();
    if (url) {
      await sendWebhook(url, {
        type: d.allFailed ? 'batch_failed' : 'batch_done',
        title: d.allFailed
          ? `批量生成全部失败(${d.total} 组)`
          : `批量生成完成:成功 ${d.ok}/${d.total} 组`,
        body: undefined,
        payload: { batchId, episodeId: args.episodeId, success: d.ok, failed: d.failed, total: d.total },
      });
    }
  }
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
    requireComplianceForVideo: bindings.requireComplianceForVideo,
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
