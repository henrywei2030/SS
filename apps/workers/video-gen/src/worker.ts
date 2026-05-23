/**
 * BullMQ Worker 实例 — VideoGen 队列消费者
 *
 * ADR-25 M2 + M8 + P0-1(langfuse audit 发现):
 *   - concurrency:1(视频生成 GPU 重,单条跑;fynt workflow 节点轻量是 5)
 *   - autorun:false,显式 .run()
 *   - lockDuration:5min(默认 30s 远小于视频生成 60-180s,会误触 stalled → 重复扣费)
 *   - maxStalledCount:1(stall 1 次直接 failed,不让视频任务无限重跑烧钱)
 *   - failed/completed listener 当前仅 console(ADR-25 M8 jobLog 写入下沉到 processor finally,
 *     按 langfuse 建议避免 listener 内 prisma 调用阻塞主循环)
 */
import { Worker, type WorkerOptions } from 'bullmq';

import { getPrimaryRedis } from '@ss/queue/redis';
import { VIDEO_GEN_QUEUE_NAME, type VideoGenJobData } from '@ss/queue/types';

import { processVideoGenJob } from './processor.js';

export function createWorker(workerId: string): Worker<VideoGenJobData> {
  const opts: WorkerOptions = {
    connection: getPrimaryRedis(),
    concurrency: 1,
    autorun: false,
    // P0-1:防长任务被误判 stalled — 视频生成可跑 2-3 分钟,默认 30s 必触
    lockDuration: 5 * 60_000,
    stalledInterval: 60_000,
    maxStalledCount: 1,
  };

  const worker = new Worker<VideoGenJobData>(
    VIDEO_GEN_QUEUE_NAME,
    async (job) => processVideoGenJob(job, workerId),
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
