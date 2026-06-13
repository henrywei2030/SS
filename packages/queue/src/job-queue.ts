/**
 * 通用任务队列 ss-jobs — M0 基建(2026-06-10,蓝图 docs/06 §3 M0)
 *
 * 单队列 `ss-jobs` + `{kind, data}` envelope + 按 kind 的 handler 注册表。
 * 给后续里程碑的非视频任务用(M1 compose 成片 / M3 qc 质检 / ...):
 * 新任务类型 = registerJobHandler(kind, fn) + enqueueJob(kind, data),不再各建一条队列。
 *
 * ⚠️ 现有 video-gen 队列(video-gen-queue.ts)是资金路径,完全不动;本文件是并行新增。
 *
 * `QUEUE_DRIVER` 双驱动(对齐 enqueueVideoGenJob):
 *   - 'bullmq'(默认):Queue.add 入 Redis,worker 进程(apps/workers/video-gen 同进程
 *     第二个 Worker 实例)消费,经 dispatchJob 按 kind 路由到注册表。
 *   - 'in-process':桌面单进程档,直接查注册表 fire-and-forget(同 video-gen 语义:
 *     入队立即返回,失败由 handler 内部落库/通知,enqueue 端只兜底打日志)。
 *
 * ⚠️ handler 注册表存 globalThis,不能用模块级变量:Next standalone 把 instrumentation
 *   (注册方)与 tRPC route(入队方)编进不同模块实例,模块级 Map 不共享 → in-process 档
 *   入队侧读不到 handler(progress-bus / video-gen handler 同款坑,dev 单模块图不暴露)。
 *
 * handler 自己负责 zod parse 业务 data(队列层只保证 envelope 形状),以及自身的
 * 失败落库 / 通知 — 队列层不感知业务语义。
 */
import { Queue, type JobsOptions } from 'bullmq';
import { z } from 'zod';

import { getPrimaryRedis } from './redis.js';

/** 队列名常量 — BullMQ Worker 与 Queue 共用 */
export const SS_JOBS_QUEUE_NAME = 'ss-jobs' as const;

/** 跨进程边界的 job envelope — data 由各 kind 的 handler 自行 zod parse */
export const SsJobEnvelopeSchema = z.object({
  kind: z.string().min(1),
  data: z.unknown(),
});
export type SsJobEnvelope = z.infer<typeof SsJobEnvelopeSchema>;

export interface SsJobContext {
  jobId: string;
  kind: string;
}

export type SsJobHandler = (data: unknown, ctx: SsJobContext) => Promise<void>;

type GlobalWithJobRegistry = typeof globalThis & {
  __ss_jobHandlers?: Map<string, SsJobHandler>;
};

function getRegistry(): Map<string, SsJobHandler> {
  const g = globalThis as GlobalWithJobRegistry;
  if (!g.__ss_jobHandlers) g.__ss_jobHandlers = new Map();
  return g.__ss_jobHandlers;
}

/**
 * 注册某 kind 的处理器(启动钩子调用:web instrumentation(in-process 档)/
 * worker bootstrap(bullmq 档))。重复注册静默覆盖 — dev 热重载会重跑注册,需幂等。
 */
export function registerJobHandler(kind: string, handler: SsJobHandler): void {
  getRegistry().set(kind, handler);
}

export function getJobHandler(kind: string): SsJobHandler | undefined {
  return getRegistry().get(kind);
}

/** 测试用:清空注册表 */
export function resetJobHandlers(): void {
  (globalThis as GlobalWithJobRegistry).__ss_jobHandlers = new Map();
}

// 一次性任务默认不重试(对齐 video-gen:重试语义由各 kind handler 自己决定,
// 计费类任务自动重试会重复扣费)。失败 job 留 7 天供审计。
const defaultJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: { count: 200, age: 24 * 3600 },
  removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
};

let queue: Queue<SsJobEnvelope> | undefined;

/** 获取 ss-jobs Queue 单例(仅 bullmq 档使用) */
export function getSsJobsQueue(): Queue<SsJobEnvelope> {
  if (!queue) {
    queue = new Queue<SsJobEnvelope>(SS_JOBS_QUEUE_NAME, {
      connection: getPrimaryRedis(),
      defaultJobOptions,
    });
  }
  return queue;
}

export interface EnqueueJobOptions {
  /**
   * 业务幂等键(如 `compose:render:{renderId}`)— bullmq 档用 BullMQ jobId 内建去重;
   * in-process 档无队列状态,不去重(语义对齐 enqueueVideoGenJob,幂等由业务占位行保证)。
   */
  jobId?: string;
}

/**
 * 入队(驱动无关)— 调用方(router / processor)统一走这个,按 QUEUE_DRIVER 分流。
 * 立即返回不阻塞;失败由 handler 内部处理(落库/通知),in-process 档 enqueue 端仅兜底打日志。
 */
export async function enqueueJob(
  kind: string,
  data: unknown,
  opts?: EnqueueJobOptions,
): Promise<string> {
  const driver = (process.env.QUEUE_DRIVER ?? 'bullmq').toLowerCase();
  if (driver === 'in-process') {
    const handler = getJobHandler(kind);
    if (!handler) {
      throw new Error(
        `[job-queue] QUEUE_DRIVER=in-process 但 kind "${kind}" 未注册 handler(需启动钩子先 registerJobHandler)`,
      );
    }
    const jobId = opts?.jobId ?? `inproc:${kind}:${crypto.randomUUID()}`;
    void handler(data, { jobId, kind }).catch((err) => {
      console.error(`[job-queue:in-process] ${kind} job ${jobId} crashed:`, err);
    });
    return jobId;
  }
  const queue = getSsJobsQueue();
  // 幂等键语义修(2026-06-14):BullMQ 对已存在 jobId 的 add 是 no-op —— 但 completed job 默认留
  //   24h(defaultJobOptions removeOnComplete age),导致「同组重跑」(如 ✨✨深度优化重试)在 24h
  //   内被旧 completed job 静默去重 → 无 run / 无通知。add 前先移除同 ID 旧 job:
  //   - completed/waiting/failed/delayed → 移除成功 → add 创建全新 job(允许重跑);
  //   - active(正在跑)→ remove 抛错(job 锁定)→ catch 后 add 仍被 BullMQ 去重 → 保留「并发不双跑」。
  if (opts?.jobId) {
    await queue.remove(opts.jobId).catch(() => {});
  }
  const job = await queue.add(
    kind,
    { kind, data },
    opts?.jobId ? { jobId: opts.jobId } : undefined,
  );
  return job.id!;
}

/**
 * BullMQ worker processor 的统一路由 — envelope 校验 + 按 kind 查注册表分发。
 * 抽到这里让 worker 侧代码保持薄壳,且 kind 路由逻辑可单测。
 * 未注册 kind / envelope 畸形 → throw,BullMQ 标 job failed(留审计)。
 */
export async function dispatchJob(envelope: unknown, ctx: { jobId: string }): Promise<void> {
  const parsed = SsJobEnvelopeSchema.parse(envelope);
  const handler = getJobHandler(parsed.kind);
  if (!handler) {
    throw new Error(`[job-queue] kind "${parsed.kind}" 未注册 handler`);
  }
  await handler(parsed.data, { jobId: ctx.jobId, kind: parsed.kind });
}
