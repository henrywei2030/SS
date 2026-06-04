/**
 * VideoGen Job Processor — Step B/C 完整实现
 *
 * 业务流程(对应原 aigc.ts router L1298-L1477 抽出):
 *   1. publish 'running' 到 Redis channel(SSE 推前端状态变化)
 *   2. 调 getVideoProvider(providerId).generate(req, ctx) — skipLedger:true
 *   3. 成功:写 MediaItem(VIDEO)+ 升 attempt SUCCESS + costLedgerEntry(同事务)
 *           + publish EVENTS.GENERATION_COMPLETED(EventBus,下游订阅方用)
 *           + publish 'success' 到 Redis channel(SSE 推前端)
 *   4. 失败:升 attempt FAILED + costLedgerEntry(success:false)
 *           + publish 'failed' 到 Redis channel
 *           + 失败分类(ADR-25 M4 白名单制):
 *             - censored / compliance / quota / unsupported → throw UnrecoverableError(BullMQ 不重试)
 *             - timeout / rate_limit / server_error / network → throw Error(BullMQ retry attempts:5)
 *
 * ctx 去除:worker 没有 tRPC ctx,所有信息从 job.data 取;OperationLog 直接写。
 */
import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';

import { getEventBus } from '@ss/adapters/eventbus';
import { getVideoProvider } from '@ss/adapters/provider';
import { prisma } from '@ss/db';
import { getPrimaryRedis } from '@ss/queue/redis';
import {
  videoGenChannel,
  type VideoGenJobData,
  type VideoGenProgressEvent,
} from '@ss/queue/types';
import { EVENTS } from '@ss/shared/events';
// 第 18 轮 audit P1:errorMsg 入库 + SSE + OperationLog 前脱敏,防真接 Provider 后 URL/token 泄漏
import { sanitizeErrorMsg } from '@ss/shared';

/**
 * P0-3 idempotency check 结果(processor 入口防 stalled re-queue / BullMQ retry 双写)
 *
 * 场景:worker 进程被 SIGKILL,BullMQ 不知道 job 完成与否,会被另一 worker re-queue。
 * 重跑同一 attemptId 时:
 *   - 若 attempt 已 SUCCESS:直接返回缓存结果,跳过 provider.generate + MediaItem create
 *   - 若 attempt 已 FAILED:抛 UnrecoverableError(不再重试)
 *   - 若 RUNNING/QUEUED:正常继续
 */
type IdempotencyDecision =
  | { kind: 'continue' }
  | { kind: 'skip-success'; mediaId: string | null; costCny: number }
  | { kind: 'skip-failed'; errorMsg: string };

async function checkIdempotency(attemptId: string): Promise<IdempotencyDecision> {
  const existing = await prisma.generationAttempt.findUnique({
    where: { id: attemptId },
    select: { status: true, outputMediaId: true, costCny: true, errorMsg: true },
  });
  if (!existing) {
    return { kind: 'skip-failed', errorMsg: `attempt ${attemptId} not found` };
  }
  if (existing.status === 'SUCCESS') {
    return {
      kind: 'skip-success',
      mediaId: existing.outputMediaId,
      costCny: Number(existing.costCny ?? 0),
    };
  }
  if (existing.status === 'FAILED') {
    return { kind: 'skip-failed', errorMsg: existing.errorMsg ?? 'already failed' };
  }
  return { kind: 'continue' };
}

export interface ProcessResult {
  attemptId: string;
  mediaId?: string;
  videoUrl?: string;
  costCny?: number;
}

export async function processVideoGenJob(
  job: Job<VideoGenJobData>,
  workerId: string,
): Promise<ProcessResult> {
  const {
    attemptId,
    projectId,
    episodeId,
    shotGroupId,
    userId,
    providerId,
    modelId,
    prompt,
    durationS,
    aspectRatio,
    refImageUrls,
    refAudioUrls,
    groupNumber,
    // W5.5.1 扩展参数(透传给 provider.generate 的 extra)
    resolution,
    generateAudio,
    addWatermark,
    webSearchEnabled,
    refVideoUrl,
    refAudioUrl,
    requestId,
  } = job.data;

  // 第 19 轮 audit P1:所有 worker console 日志加 requestId 前缀,跨进程追溯
  const reqTag = requestId ? `[req=${requestId}]` : '';
  const channel = videoGenChannel(attemptId);
  const redis = getPrimaryRedis();
  const publish = async (event: VideoGenProgressEvent): Promise<void> => {
    try {
      await redis.publish(channel, JSON.stringify(event));
    } catch (err) {
      console.error(`[${workerId}] redis publish failed (${event.type}):`, err);
    }
  };

  console.log(
    `[${workerId}]${reqTag} processing attempt=${attemptId} provider=${providerId} group=${groupNumber} (job=${job.id} try=${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`,
  );

  // P0-3 idempotency check(防 stalled re-queue / retry 双写 MediaItem + ledger)
  const decision = await checkIdempotency(attemptId);
  if (decision.kind === 'skip-success') {
    console.log(`[${workerId}] attempt ${attemptId} already SUCCESS, skipping (idempotent)`);
    return {
      attemptId,
      mediaId: decision.mediaId ?? undefined,
      costCny: decision.costCny,
    };
  }
  if (decision.kind === 'skip-failed') {
    console.log(`[${workerId}] attempt ${attemptId} already FAILED, skipping (idempotent)`);
    throw new UnrecoverableError(`attempt ${attemptId} already FAILED: ${decision.errorMsg}`);
  }

  await publish({ type: 'running', attemptId });

  const provider = await getVideoProvider(providerId);
  const startedAt = new Date();

  // W5.5.1 透传扩展参数到 Provider extra(Mock 阶段仅打日志确认链路通)
  const extraParams: Record<string, unknown> = {};
  if (resolution !== undefined) extraParams.resolution = resolution;
  if (generateAudio !== undefined) extraParams.generateAudio = generateAudio;
  if (addWatermark !== undefined) extraParams.addWatermark = addWatermark;
  if (webSearchEnabled !== undefined) extraParams.webSearchEnabled = webSearchEnabled;
  if (refVideoUrl !== undefined) extraParams.refVideoUrl = refVideoUrl;
  if (refAudioUrl !== undefined) extraParams.refAudioUrl = refAudioUrl;

  let result;
  try {
    result = await provider.generate(
      {
        prompt,
        durationS,
        aspectRatio,
        refImageUrls,
        refAudioUrls,
        ...(Object.keys(extraParams).length > 0 ? { extra: extraParams } : {}),
      },
      {
        userId,
        projectId,
        episodeId,
        attemptId,
        // ADR-25:Provider 内部 recordLedger 由 router 单点写代替,防双计费
        skipLedger: true,
      },
    );
  } catch (e) {
    // 第 18 轮 audit P1:errMsg 是 SSE/DB/OperationLog 的对外字符串,必须脱敏。
    // 原始 e 仍在下面 console.error 中保留,供 worker 日志 debug 用。
    const errMsg = sanitizeErrorMsg(e);
    const unrecoverable = isUnrecoverableError(e);
    const finishedAt = new Date();
    console.error(`[${workerId}]${reqTag} provider.generate failed (raw):`, e);

    // self-audit:DB 写入失败也必须 publish 'failed',防前端永远 loading。
    // 把 $transaction 用 try/catch 兜底,即使写库挂了 publish 仍能发出。
    //
    // Phase 1.5 P0-1:失败时不再写 NORMAL failed entry,改写 REFUND 全退 PREPAY
    // (PREPAY 由 router 创建 attempt 时写入,此处需查出来算退还额)
    try {
      await prisma.$transaction(async (tx) => {
        await tx.generationAttempt.update({
          where: { id: attemptId },
          data: {
            status: 'FAILED',
            errorMsg: errMsg,
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
          },
        });
        // Audit P1-3(2026-05-24 r21):advisory_xact_lock 防 BullMQ stalled re-queue race
        // 两个 worker 同时 process 同 attempt 时各自 findFirst → null → create 双 REFUND
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext('attempt_refund:' || $1)::bigint)`,
          attemptId,
        );
        // idempotent:retry 时若已写过 REFUND,跳过
        const existingRefund = await tx.costLedgerEntry.findFirst({
          where: { attemptId, entryType: 'REFUND' },
          select: { id: true },
        });
        if (!existingRefund) {
          const prepayEntry = await tx.costLedgerEntry.findFirst({
            where: { attemptId, entryType: 'PREPAY' },
            select: { id: true, costCny: true },
          });
          const prepaid = prepayEntry?.costCny ?? '0';
          const refundCost = String(prepaid) === '0' ? '0' : `-${prepaid}`;
          await tx.costLedgerEntry.create({
            data: {
              userId,
              projectId,
              episodeId,
              attemptId,
              providerId,
              modelId,
              action: 'video.generate',
              inputUnits: 0,
              outputUnits: 0,
              unitPriceCny: '0',
              costCny: refundCost,
              success: true, // REFUND 永远 success=true(退还动作执行成功)
              entryType: 'REFUND',
              refundReason: 'video_task_failed_full_refund',
              parentEntryId: prepayEntry?.id,
              billingCycle: new Date().toISOString().slice(0, 7),
            },
          });
        }
      });
    } catch (dbErr) {
      console.error(
        `[${workerId}] CRITICAL: failed to mark attempt FAILED in DB (publish 'failed' still sent):`,
        dbErr,
      );
    }

    await writeOperationLog({
      actorId: userId,
      projectId,
      action: 'aigc.generateVideo.failed',
      targetType: 'shotGroup',
      targetId: shotGroupId,
      after: { attemptId, providerId, error: errMsg, unrecoverable },
    });

    await publish({
      type: 'failed',
      attemptId,
      errorMsg: errMsg,
      retryable: !unrecoverable,
    });

    if (unrecoverable) {
      throw new UnrecoverableError(errMsg);
    }
    throw e instanceof Error ? e : new Error(errMsg);
  }

  // ============ 成功路径 ============
  const finishedAt = new Date();
  const unitPrice = provider.info.defaultUnitPriceCny.toFixed(6);

  // Phase 1.5 P0-1:成功时不再写 NORMAL success entry,改写 REFUND 退多扣(prepaid - actual)
  // (PREPAY 已由 router 写入,此处只补充 REFUND;最终 sum = prepaid - (prepaid - actual) = actual)
  const { mediaId, updatedAttemptId } = await prisma.$transaction(async (tx) => {
    // 需求3:友好命名「项目名-第N集-分镜M-第K次」(替原 groupNumber-时间戳)+ 视频生成物自动归"视频"资产类
    const [proj, ep] = await Promise.all([
      tx.project.findUnique({ where: { id: projectId }, select: { name: true } }),
      tx.episode.findUnique({ where: { id: episodeId }, select: { number: true } }),
    ]);
    // 全盘审查 #17:用"成功序号"语义 — 原 count 含 placeholder/FAILED/并发 attempt,
    //   文件名「第N次」会跳号。改数已成功的 + 1(当前这次此刻仍 RUNNING、未计入)。
    const takeSeq =
      (await tx.generationAttempt.count({ where: { shotGroupId, status: 'SUCCESS' } })) + 1;
    // 文件名片段:去文件系统非法字符(中文保留),空兜底
    const sanitizeName = (s: string): string => s.replace(/[/\\:*?"<>|]+/g, '_').trim();
    const projPart = sanitizeName(proj?.name ?? '') || '项目';
    const epPart = ep?.number ? `第${sanitizeName(String(ep.number))}集` : '本集';
    const safeGroup = String(groupNumber ?? '').replace(/[^a-zA-Z0-9_-]+/g, '_') || '组';
    const media = await tx.mediaItem.create({
      data: {
        projectId,
        scope: 'PROJECT',
        kind: 'VIDEO',
        filename: `${projPart}-${epPart}-分镜${safeGroup}-第${takeSeq}次.mp4`,
        assetCategory: 'VIDEO',
        mimeType: 'video/mp4',
        sizeBytes: 0, // Phase 1 不真实下载
        storageKey: result.videoUrl.startsWith('http')
          ? `external://${result.videoUrl}`
          : result.videoUrl,
        cdnUrl: result.videoUrl,
        aspectRatio,
        meta: {
          width: result.width,
          height: result.height,
          durationS: result.durationS,
          fps: result.fps,
          providerId,
          providerJobId: result.providerJobId,
          thumbnailUrl: result.thumbnailUrl,
        },
        source: 'AIGC',
        sourceRef: attemptId,
      },
    });
    const a = await tx.generationAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'SUCCESS',
        providerJobId: result.providerJobId,
        outputMediaId: media.id,
        outputMediaIds: [media.id],
        inputUnits: durationS,
        outputUnits: result.durationS,
        unitPriceCny: unitPrice,
        costCny: result.costCny.toFixed(4),
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
    });
    // Audit P1-3(2026-05-24 r21):advisory_xact_lock 防 BullMQ stalled re-queue race
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext('attempt_refund:' || $1)::bigint)`,
      attemptId,
    );
    // idempotent:retry 时若已写过 REFUND / ADJUSTMENT,跳过
    const existingRefund = await tx.costLedgerEntry.findFirst({
      where: { attemptId, entryType: { in: ['REFUND', 'ADJUSTMENT'] } },
      select: { id: true },
    });
    if (!existingRefund) {
      const prepayEntry = await tx.costLedgerEntry.findFirst({
        where: { attemptId, entryType: 'PREPAY' },
        select: { id: true, costCny: true },
      });
      // 退还 = prepaid - actual(可能正或负 — 通常正,因为按 max_duration 预估上限,实际抽卡可能更短)
      const prepaidNum = Number(prepayEntry?.costCny ?? 0);
      const actualNum = Number(result.costCny);
      const refundNum = prepaidNum - actualNum;
      // refund > 0:退还多扣 / refund < 0:实际超估补扣(罕见)/ refund = 0:跳过
      if (refundNum !== 0) {
        const refundCost = (-refundNum).toFixed(4); // 退还在 ledger 是负数(用户净消费 - 抵消)
        await tx.costLedgerEntry.create({
          data: {
            userId,
            projectId,
            episodeId,
            attemptId,
            providerId,
            modelId,
            action: 'video.generate',
            inputUnits: durationS,
            outputUnits: result.durationS,
            unitPriceCny: unitPrice,
            costCny: refundCost,
            success: true, // REFUND 永远 success=true
            entryType: refundNum > 0 ? 'REFUND' : 'ADJUSTMENT',
            refundReason:
              refundNum > 0
                ? 'video_task_overcharge_refund'
                : 'video_task_underestimate_adjustment',
            parentEntryId: prepayEntry?.id,
            billingCycle: new Date().toISOString().slice(0, 7),
          },
        });
      }
    }
    return { mediaId: media.id, updatedAttemptId: a.id };
  });

  await writeOperationLog({
    actorId: userId,
    projectId,
    action: 'aigc.generateVideo',
    targetType: 'shotGroup',
    targetId: shotGroupId,
    after: {
      attemptId,
      mediaId,
      providerId,
      aspectRatio,
      durationS,
      cost: result.costCny,
    },
  });

  // EventBus(下游订阅方 / Phase 2 Auto-Salvage 订阅)
  await getEventBus()
    .publish(
      EVENTS.GENERATION_COMPLETED,
      {
        kind: 'video' as const,
        attemptId: updatedAttemptId,
        shotGroupId,
        episodeId,
        projectId,
        providerId,
        mediaId,
        videoUrl: result.videoUrl,
        durationS: result.durationS,
        costCny: result.costCny,
      },
      { publisherId: 'worker.video-gen' },
    )
    .catch((err) => {
      console.error(`[${workerId}] event bus publish failed:`, err);
    });

  // SSE 推前端(end state)
  await publish({
    type: 'success',
    attemptId,
    mediaId,
    videoUrl: result.videoUrl,
    thumbnailUrl: result.thumbnailUrl,
    costCny: result.costCny,
  });

  return {
    attemptId,
    mediaId,
    videoUrl: result.videoUrl,
    costCny: result.costCny,
  };
}

/**
 * 失败分类(ADR-25 M4 白名单制 + P0-4 langfuse audit 收窄)
 *
 * 返回 true:业务硬错,不该重试,抛 UnrecoverableError 跳过 BullMQ 剩余 attempts
 * 返回 false:临时错(网络/超时/限流),抛普通 Error 触发 BullMQ retry
 *
 * 严格 snake_case 边界匹配(\b...\b)避免英文散文误触,例如:
 *   - "prompt contains unauthorized character" ← 不应误判为 unrecoverable
 *   - "forbidden region detected, please redact and retry" ← 不应误判为 unrecoverable
 *   - "unsupported aspect ratio temporary fallback" ← 不应误判为 unrecoverable
 *
 * Mock provider message 应使用 snake_case error code(e.g. 'CENSORED' / 'COMPLIANCE_REQUIRED'),
 * 真接 Seedance / Volcengine 时按 ProviderError.code 判断(Phase 2 升级为 instanceof TypedError)。
 */
function isUnrecoverableError(e: unknown): boolean {
  const raw = e instanceof Error ? e.message : String(e);
  // P0-4:严格 snake_case 边界匹配,避免在自然语言文本中误触
  const strictPatterns = [
    /\bCENSORED\b/i,
    /\bCOMPLIANCE_REQUIRED\b/i,
    /\bCONTENT_POLICY_VIOLATION\b/i,
    /\bQUOTA_EXCEEDED\b/i,
    /\bBUDGET_EXCEEDED\b/i,
    /\bINVALID_PROMPT\b/i,
    /\bUNSUPPORTED_MODEL\b/i,
    /\bUNAUTHORIZED_REQUEST\b/i,
  ];
  return strictPatterns.some((p) => p.test(raw));
}

/**
 * Worker 视角的 OperationLog 写入(不依赖 tRPC ctx)
 *
 * 跟 packages/api/src/middleware/audit.ts 的 logOperation shape 对齐:
 *   - actorId 来自 job.data.userId(原触发 mutation 的用户)
 *   - ip/userAgent 留空(后台进程无 HTTP 上下文)
 */
async function writeOperationLog(opts: {
  actorId: string;
  projectId: string;
  action: string;
  targetType: string;
  targetId: string;
  after: unknown;
}): Promise<void> {
  try {
    await prisma.operationLog.create({
      data: {
        actorId: opts.actorId,
        projectId: opts.projectId,
        action: opts.action,
        targetType: opts.targetType,
        targetId: opts.targetId,
        afterJson: opts.after ? JSON.parse(JSON.stringify(opts.after)) : undefined,
      },
    });
  } catch (err) {
    console.error('[worker:audit] failed to write OperationLog:', err);
  }
}
