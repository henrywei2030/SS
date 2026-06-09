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

// ---------------------------------------------------------------------------
// 队列驱动开关(桌面化 Phase 1)— `QUEUE_DRIVER`:
//   - 'bullmq'(默认):Redis 队列,worker 独立进程消费(现有云端/dev 档,行为不变)
//   - 'in-process':本进程异步处理(桌面单进程,worker 合进 web 进程)
//
// in-process 的实际处理器(processVideoGenJob)在 @ss/core,由 web 启动钩子(instrumentation)
// 注册进来(DI),避免 queue → core 依赖。Sub-step B 接上 registerInProcessVideoHandler。
// ---------------------------------------------------------------------------
type InProcessVideoHandler = (payload: VideoGenJobData) => Promise<void>;

// ⚠️ 存 globalThis,不能用模块级 let:Next standalone 把 instrumentation(注册方)与 tRPC route
//   (入队方)编进不同 bundle / 模块实例,模块级变量不共享 → 注册的 handler 在入队侧读不到、报
//   "未注册"(dev 单模块图无此问题,故 dev 验证时没暴露)。globalThis 同进程跨实例共享。
type GlobalWithVideoHandler = typeof globalThis & {
  __ss_inProcessVideoHandler?: InProcessVideoHandler | null;
};

/** 桌面档:web 进程启动时注册进程内视频处理器(见 apps/web instrumentation)。 */
export function registerInProcessVideoHandler(fn: InProcessVideoHandler): void {
  (globalThis as GlobalWithVideoHandler).__ss_inProcessVideoHandler = fn;
}

/**
 * 入队(驱动无关)— 调用方(router)统一走这个,按 QUEUE_DRIVER 分流。
 * 立即返回(不阻塞),对齐 BullMQ add 语义;失败由 processor 内部标 FAILED + publish。
 */
export async function enqueueVideoGenJob(payload: VideoGenJobData): Promise<string> {
  const driver = (process.env.QUEUE_DRIVER ?? 'bullmq').toLowerCase();
  if (driver === 'in-process') {
    const parsed = VideoGenJobDataSchema.parse(payload);
    const handler = (globalThis as GlobalWithVideoHandler).__ss_inProcessVideoHandler;
    if (!handler) {
      throw new Error(
        'QUEUE_DRIVER=in-process 但未注册进程内处理器(需 web instrumentation 调 registerInProcessVideoHandler)',
      );
    }
    // fire-and-forget:不阻塞 enqueue;processor 内部已处理失败(标 FAILED + publish 'failed')
    void handler(parsed).catch((err) => {
      console.error(`[queue:in-process] video job ${parsed.attemptId} crashed:`, err);
    });
    return `inproc:${parsed.attemptId}`;
  }
  return addVideoGenJob(payload);
}
