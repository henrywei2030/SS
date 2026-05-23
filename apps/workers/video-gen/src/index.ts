/**
 * VideoGen Worker 进程入口
 *
 * ADR-25 M2 + M10:bootstrap → worker.run + 严格优雅退出。
 *   - workerId 打日志追溯(videogen-{pid}-{epochMs})
 *   - autorun:false + waitUntilReady 确保连接就绪后才拉 job
 *   - SIGTERM/SIGINT 顺序:health 先停 → worker.close → redis → prisma
 *   - 25s 硬 timeout 兜底防 K8s SIGKILL(grace 30s 留 5s 余量)
 */
import { prisma } from '@ss/db';
import { getPrimaryRedis } from '@ss/queue/redis';

import { startHealthServer, stopHealthServer } from './health.js';
import { createWorker } from './worker.js';

const workerId = `videogen-${process.pid}-${Date.now()}`;
const SHUTDOWN_TIMEOUT_MS = 25_000;

let isShuttingDown = false;

async function bootstrap(): Promise<void> {
  console.log(`[${workerId}] booting...`);

  startHealthServer({ workerId });

  // P0-2(langfuse audit)+ audit 修 P1-1:worker 启动时扫 stale RUNNING attempt
  //   场景:上次 worker 进程被 SIGKILL,attempt 永远卡在 RUNNING 状态(DB 视角)。
  //   策略:startedAt 10min 前还是 RUNNING 的,认定是孤儿,标 FAILED + reason。
  //
  //   cutoff = 10min(原 5min):因 worker.ts lockDuration 也是 5min,边界相同时
  //   慢路径(seedance 真接入可能 6-8min)会被 bootstrap 误杀。10min 给 5min lockDuration
  //   + 5min grace = 安全余量,但仍能恢复真正崩溃的 job(K8s SIGKILL 后 worker 重启 < 1min)。
  try {
    const staleCutoff = new Date(Date.now() - 10 * 60_000);
    const result = await prisma.generationAttempt.updateMany({
      where: {
        status: 'RUNNING',
        action: 'VIDEO',
        startedAt: { lt: staleCutoff },
      },
      data: {
        status: 'FAILED',
        errorMsg: 'worker_restart_recovered: process crashed while attempt was RUNNING',
        finishedAt: new Date(),
      },
    });
    if (result.count > 0) {
      console.warn(
        `[${workerId}] recovered ${result.count} stale RUNNING attempt(s) → marked FAILED`,
      );
    }
  } catch (err) {
    console.error(`[${workerId}] stale-attempt sweep failed (non-fatal):`, err);
  }

  const worker = createWorker(workerId);
  await worker.waitUntilReady();
  console.log(`[${workerId}] ready, starting to pull jobs`);
  void worker.run();

  const gracefulShutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[${workerId}] received ${signal}, shutting down...`);

    await stopHealthServer();
    console.log(`[${workerId}] health server stopped`);

    await worker.close();
    console.log(`[${workerId}] worker drained`);

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
