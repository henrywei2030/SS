/**
 * BullMQ Worker 实例 — ss-jobs 通用任务队列消费者(M0 基建,2026-06-10)
 *
 * 薄壳:processor 直接委托 @ss/queue dispatchJob 按 kind 路由到 handler 注册表。
 * 各 kind 的 handler 由本进程 bootstrap(index.ts)调 registerJobHandler 注册
 * (M1 起注册 compose / M3 注册 qc;M0 阶段注册表为空,收到 job 会标 failed 留审计)。
 *
 * 配置对齐 video-gen worker 的口径,差异点:
 *   - lockDuration 10min:compose 串整集 ffmpeg(转码+烧字幕)可比单镜视频生成更久
 *   - concurrency 默认 2(env SS_JOBS_WORKER_CONCURRENCY,clamp 1-10);
 *     ffmpeg 是本机 CPU 任务,调大前确认核数
 */
import { Worker, type WorkerOptions } from 'bullmq';

import { getPrimaryRedis } from '@ss/queue/redis';
import {
  SS_JOBS_QUEUE_NAME,
  dispatchJob,
  type SsJobEnvelope,
} from '@ss/queue/job-queue';

const WORKER_CONCURRENCY = Math.max(
  1,
  Math.min(10, Number(process.env.SS_JOBS_WORKER_CONCURRENCY) || 2),
);

export function createSsJobsWorker(workerId: string): Worker<SsJobEnvelope> {
  const opts: WorkerOptions = {
    connection: getPrimaryRedis(),
    concurrency: WORKER_CONCURRENCY,
    autorun: false,
    lockDuration: 10 * 60_000,
    stalledInterval: 60_000,
    maxStalledCount: 1,
  };

  const worker = new Worker<SsJobEnvelope>(
    SS_JOBS_QUEUE_NAME,
    async (job) => dispatchJob(job.data, { jobId: job.id ?? '?' }),
    opts,
  );

  worker.on('completed', (job) => {
    console.log(`[${workerId}] ss-job ${job.id} (${job.data.kind}) completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[${workerId}] ss-job ${job?.id} (${job?.data?.kind ?? '?'}) failed:`,
      err.message,
    );
  });

  worker.on('stalled', (jobId) => {
    console.warn(`[${workerId}] ss-job ${jobId} stalled (lock expired)`);
  });

  worker.on('error', (err) => {
    console.error(`[${workerId}] ss-jobs worker error:`, err.message);
  });

  return worker;
}
