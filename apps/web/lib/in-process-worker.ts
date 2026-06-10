/**
 * 进程内视频 worker 启动 —— 桌面档(`QUEUE_DRIVER=in-process`),仅 nodejs runtime 由
 * instrumentation 动态 import 调用(故 pg/ioredis/bullmq 只进 nodejs bundle,不进 edge)。
 *
 * 默认档(bullmq)直接 no-op —— worker 是独立进程(apps/workers/video-gen)。
 */
import { COMPOSE_JOB_KIND, processComposeRender } from '@ss/core/compose';
import { processVideoGenJob, recoverStaleVideoAttempts } from '@ss/core/video-generation';
import { VOICE_SAMPLE_JOB_KIND, processVoiceSampleJob } from '@ss/core/voice';
import { CACHE_VIDEO_JOB_KIND, processCacheVideoJob } from '@ss/core/media';
import { registerJobHandler } from '@ss/queue/job-queue';
import { registerInProcessVideoHandler } from '@ss/queue/video-gen';

export async function startInProcessVideoWorker(): Promise<void> {
  if ((process.env.QUEUE_DRIVER ?? 'bullmq').toLowerCase() !== 'in-process') return;

  const workerId = `web-inproc-${process.pid}`;

  // enqueueVideoGenJob('in-process') → 这里注册的 handler(fire-and-forget,失败 processor 内部已标 FAILED)
  registerInProcessVideoHandler(async (payload) => {
    await processVideoGenJob(payload, {
      workerId,
      jobId: `inproc:${payload.attemptId}`,
      attempt: 1,
      maxAttempts: 1,
    });
  });

  // M1/TTS-B:通用 ss-jobs 队列的 in-process handler 注册(enqueueJob → 这里)
  registerJobHandler(COMPOSE_JOB_KIND, (data) => processComposeRender(data));
  registerJobHandler(VOICE_SAMPLE_JOB_KIND, (data) => processVoiceSampleJob(data));
  registerJobHandler(CACHE_VIDEO_JOB_KIND, (data) => processCacheVideoJob(data)); // 六八 视频本地缓存

  // 回收孤儿(上次 app 退出时未完成的视频 job)
  await recoverStaleVideoAttempts(workerId);

  console.log(`[${workerId}] in-process video worker registered + stale recovery done`);
}
