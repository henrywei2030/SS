/**
 * 批次完成判定 + 一次性通知 — 七二从 batch-followup §2 原样抽出的独立模块。
 *
 * 独立成文件的原因(七二 P2 修):批次成员可能**全部在 API 侧终结**(提交即 deny /
 * stale-sweep / worker boot 恢复),此时 worker 终态路径一次都不会跑,通知漏发(③a 实测)。
 * API 侧站点也要能调本判定;而 batch-followup 引 submit(自动重抽),submit 若反向引
 * followup 即成环 — 本文件零 submit 依赖,双方安全引用。
 *
 * 幂等保证(原 followup 语义不变):advisory lock + Notification.payload.batchId 判重,
 * 任何站点重复调用只发一次;有 inflight 快速返回零开销 — 可机会性调用。
 * 取消路径(cancelQueued)**有意不接**:用户主动取消有即时 UI 反馈,补一条"全败"通知是噪音。
 */
import type { PrismaClient } from '@ss/db';

import { NOTIFY_WEBHOOK_URL_KEY, sendWebhook } from '../notify/index.js';

export interface BatchDoneCheckArgs {
  batchId: string;
  /** 通知接收人 — 批次提交者(attempt.createdBy),非当前操作者 */
  userId: string;
  projectId: string;
  episodeId: string;
  requestId?: string;
}

export async function maybeNotifyBatchDone(
  prisma: PrismaClient,
  args: BatchDoneCheckArgs,
): Promise<void> {
  const reqTag = args.requestId ? `[req=${args.requestId}]` : '';
  const batchId = args.batchId;

  // 已知边界(深审 F-3 记账):跨 worker 竞态下,"A 组失败事务已提交但 A 的重抽占位还没
  // 建" 的 ms 级窗口内,B 组的完成判定可能提前发通知(统计少算 A 的重抽结果)。无资金
  // 影响,仅通知时点/计数偏差;同 worker 内重抽先行于完成判定已消大头。
  // 快速路径:有 inflight(含刚重抽出的新占位)直接返回,锁留给真正的收尾竞争者
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
