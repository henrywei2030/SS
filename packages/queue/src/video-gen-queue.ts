/**
 * VideoGen Queue — web 入队 + worker 消费同一份定义
 *
 * ADR-25 M3:defaultJobOptions 集中,不在 add() 处散写。
 *   - attempts: 5(langfuse 实战 ≥ 5,LLM API 抖动需要余量)
 *   - exponential backoff 5000ms(实际重试间隔 5/10/20/40/80s)
 *   - removeOnComplete: 100(调试足够)
 *   - removeOnFail: 1000(W7 后台审计页拉历史失败 job)
 *
 * ADR-25 M3:jobId = `videogen:attempt:{attemptId}` → BullMQ 内建去重
 *   前端 client 重复提交同 attemptId 不会建第二个 job。
 */
import { Queue, type JobsOptions } from 'bullmq';

import { getPrimaryRedis } from './redis.js';
import {
  VIDEO_GEN_QUEUE_NAME,
  VideoGenJobDataSchema,
  type VideoGenJobData,
} from './types.js';

// fynt 模式:count + age 双维度,长尾任务也能自动清理防 Redis 膨胀
const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 100, age: 24 * 3600 },           // 1 天
  removeOnFail: { count: 1000, age: 7 * 24 * 3600 },          // 7 天(W7 后台审计页拉历史失败)
};

let queue: Queue<VideoGenJobData> | undefined;

/** 获取 VideoGen Queue 单例 */
export function getVideoGenQueue(): Queue<VideoGenJobData> {
  if (!queue) {
    queue = new Queue<VideoGenJobData>(VIDEO_GEN_QUEUE_NAME, {
      connection: getPrimaryRedis(),
      defaultJobOptions,
    });
  }
  return queue;
}

/**
 * 入队 helper — web 端 tRPC handler 用
 *
 * 调用前 handler 已经:占位 attempt 建好(QUEUED→RUNNING)、prompt compile 完、
 * missingMedia/unknownTokens 校验通过。worker 拿到 payload 直接调 provider.generate。
 */
export async function addVideoGenJob(payload: VideoGenJobData): Promise<string> {
  const parsed = VideoGenJobDataSchema.parse(payload);
  const job = await getVideoGenQueue().add(VIDEO_GEN_QUEUE_NAME, parsed, {
    jobId: `videogen:attempt:${parsed.attemptId}`,
  });
  return job.id!;
}
