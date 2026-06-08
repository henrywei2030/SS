/**
 * BullMQ Worker 实例 — VideoGen 队列消费者
 *
 * ADR-25 M2 + M8 + P0-1(langfuse audit 发现):
 *   - concurrency:r8 性能优化改 1→2 默认(可 env 覆盖)
 *     · 视频生成调远端 Provider API(Seedance/Kling),本地无 GPU 占用
 *     · 实际是 60-180s 异步等待,1 个 worker 利用率太低
 *     · concurrency=2 让单进程 throughput 翻倍 · clamp 1-10 防 Provider rate limit 爆
 *     · env: VIDEO_GEN_WORKER_CONCURRENCY=N(N>2 时要确认 Provider 配额支持)
 *   - autorun:false,显式 .run()
 *   - lockDuration:5min(默认 30s 远小于视频生成 60-180s,会误触 stalled → 重复扣费)
 *   - maxStalledCount:1(stall 1 次直接 failed,不让视频任务无限重跑烧钱)
 *   - failed/completed listener 当前仅 console(ADR-25 M8 jobLog 写入下沉到 processor finally,
 *     按 langfuse 建议避免 listener 内 prisma 调用阻塞主循环)
 */
import { Worker, type WorkerOptions } from 'bullmq';

import { getPrimaryRedis } from '@ss/queue/redis';
import { VIDEO_GEN_QUEUE_NAME, type VideoGenJobData } from '@ss/queue/types';

import { processVideoGenJob } from '@ss/core/video-generation';

// r8 性能优化:worker concurrency 可调(默认 2 · env clamp 1-10)
const WORKER_CONCURRENCY = Math.max(
  1,
  Math.min(10, Number(process.env.VIDEO_GEN_WORKER_CONCURRENCY) || 2),
);

export function createWorker(workerId: string): Worker<VideoGenJobData> {
  const opts: WorkerOptions = {
    connection: getPrimaryRedis(),
    concurrency: WORKER_CONCURRENCY,
    autorun: false,
    // P0-1:防长任务被误判 stalled — 视频生成可跑 2-3 分钟,默认 30s 必触
    lockDuration: 5 * 60_000,
    stalledInterval: 60_000,
    maxStalledCount: 1,
  };

  const worker = new Worker<VideoGenJobData>(
    VIDEO_GEN_QUEUE_NAME,
    async (job) =>
      processVideoGenJob(job.data, {
        workerId,
        jobId: job.id ?? '?',
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? 1,
      }),
    opts,
  );

  worker.on('completed', (job) => {
    console.log(
      `[${workerId}] job ${job.id} completed in ${job.attemptsMade} attempt(s)`,
    );
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[${workerId}] job ${job?.id} failed after ${job?.attemptsMade ?? 0} attempt(s):`,
      err.message,
    );
  });

  worker.on('stalled', (jobId) => {
    // P0-1:lockDuration 内没续 lock(进程卡 / GC / OOM 等),BullMQ 会 stalled 该 job
    // maxStalledCount=1 配合:stalled 后 BullMQ 自动 move-to-failed,不让视频任务无限重跑
    console.warn(`[${workerId}] job ${jobId} stalled (lock expired)`);
  });

  worker.on('error', (err) => {
    console.error(`[${workerId}] worker error:`, err.message);
  });

  return worker;
}
