/**
 * VideoGen Worker 进程入口
 *
 * ADR-25 M2 + M10:bootstrap → worker.run + 严格优雅退出。
 *   - workerId 打日志追溯(videogen-{pid}-{epochMs})
 *   - autorun:false + waitUntilReady 确保连接就绪后才拉 job
 *   - SIGTERM/SIGINT 顺序:health 先停 → worker.close → redis → prisma
 *   - 25s 硬 timeout 兜底防 K8s SIGKILL(grace 30s 留 5s 余量)
 *
 * Prisma 7 升级:显式 dotenv 加载 cwd 的 .env.local(setup:env 已建 symlink → root)。
 * 防 prisma 单例创建时 DATABASE_URL 未注入 → 触发 fail-fast 抛错。
 *
 * 三十六收工 fix:ESM imports 都先于 statement-level code 评估,所以这里调用 dotenv
 *   也救不了 `import { prisma } from '@ss/db'` 已经抛错的问题(import 顺序固定)。
 *   解法:用 tsx CLI flag `--env-file=.env.local`(Node 20.6+ 内置),package.json scripts 已改。
 *   仅留这段 import 作 production 启动兜底(若有人手动跑 `tsx src/index.ts` 不带 flag)。
 */
import 'dotenv/config';
import { prisma } from '@ss/db';
import { COMPOSE_JOB_KIND, processComposeRender } from '@ss/core/compose';
import { VOICE_SAMPLE_JOB_KIND, processVoiceSampleJob } from '@ss/core/voice';
import { registerJobHandler } from '@ss/queue/job-queue';
import { getPrimaryRedis } from '@ss/queue/redis';
// 桌面化 Phase 1:启动回收孤儿 attempt 抽到 core(worker boot 与桌面 web instrumentation 共用)
import { recoverStaleVideoAttempts } from '@ss/core/video-generation';

import { startHealthServer, stopHealthServer } from './health.js';
import { createSsJobsWorker } from './ss-jobs-worker.js';
import { createWorker } from './worker.js';

const workerId = `videogen-${process.pid}-${Date.now()}`;
const SHUTDOWN_TIMEOUT_MS = 25_000;

let isShuttingDown = false;

async function bootstrap(): Promise<void> {
  console.log(`[${workerId}] booting...`);

  startHealthServer({ workerId });

  // 启动回收孤儿视频 attempt(上次进程崩溃留下的 QUEUED/RUNNING)→ 标 FAILED + 退 PREPAY(idempotent)。
  // 桌面化:逻辑抽到 @ss/core recoverStaleVideoAttempts,BullMQ worker 与桌面 web instrumentation 共用。
  await recoverStaleVideoAttempts(workerId);

  const worker = createWorker(workerId);
  await worker.waitUntilReady();
  console.log(`[${workerId}] ready, starting to pull jobs`);
  void worker.run();

  // M0 基建:同进程第二个 Worker 消费通用 ss-jobs 队列(compose/qc 等非视频任务,
  // kind 路由见 @ss/queue dispatchJob;handler 由各里程碑在此 bootstrap 注册)
  registerJobHandler(COMPOSE_JOB_KIND, (data) => processComposeRender(data)); // M1 成片
  registerJobHandler(VOICE_SAMPLE_JOB_KIND, (data) => processVoiceSampleJob(data)); // TTS-B 声线样本
  const ssJobsWorker = createSsJobsWorker(workerId);
  await ssJobsWorker.waitUntilReady();
  console.log(`[${workerId}] ss-jobs worker ready`);
  void ssJobsWorker.run();

  const gracefulShutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[${workerId}] received ${signal}, shutting down...`);

    await stopHealthServer();
    console.log(`[${workerId}] health server stopped`);

    await worker.close();
    console.log(`[${workerId}] worker drained`);

    await ssJobsWorker.close();
    console.log(`[${workerId}] ss-jobs worker drained`);

    await getPrimaryRedis().quit();
    console.log(`[${workerId}] redis disconnected`);

    await prisma.$disconnect();
    console.log(`[${workerId}] prisma disconnected`);

    console.log(`[${workerId}] shutdown complete`);
    process.exit(0);
  };

  const shutdownWithTimeout = (signal: string): void => {
    void Promise.race([
      gracefulShutdown(signal),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`shutdown timeout after ${SHUTDOWN_TIMEOUT_MS}ms`)),
          SHUTDOWN_TIMEOUT_MS,
        ),
      ),
    ]).catch((err) => {
      console.error(`[${workerId}] graceful shutdown failed:`, err);
      process.exit(1);
    });
  };

  process.on('SIGTERM', () => shutdownWithTimeout('SIGTERM'));
  process.on('SIGINT', () => shutdownWithTimeout('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    // P1-7(fynt 模式):标记异常退出码但不主动 exit,让事件循环排空 + health 端点变红 →
    // 外部编排(Docker/K8s/PM2)自动重启。比裸 console.error 多一层可观测。
    console.error(`[${workerId}] unhandled rejection:`, reason);
    process.exitCode = 1;
  });
  process.on('uncaughtException', (err) => {
    console.error(`[${workerId}] uncaught exception:`, err);
    shutdownWithTimeout('uncaughtException');
  });
}

bootstrap().catch((err) => {
  console.error(`[${workerId}] bootstrap failed:`, err);
  process.exit(1);
});
