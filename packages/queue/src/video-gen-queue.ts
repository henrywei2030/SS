/**
 * VideoGen Queue — web 入队 + worker 消费同一份定义
 *
 * 2026-05-27 audit r13(用户反馈):视频生成是一次性任务,失败不自动重试。
 *   - attempts: 1(用户偏好 explicit-fail-first;视频抽卡按秒计费,重试 5 次会重复扣费)
 *   - 失败直接 publish 'failed' + sanitizeErrorMsg → 前端显示具体原因引导用户决策
 *   - worker 内的 isUnrecoverableError 分类仍保留,用于日志区分(临时网络 vs 业务硬错)
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

// 2026-05-27:attempts:1 一次性任务,失败立即返用户具体原因
const defaultJobOptions: JobsOptions = {
  attempts: 1,
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
