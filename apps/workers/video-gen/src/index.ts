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
 */
import 'dotenv/config';
import { prisma } from '@ss/db';
import { getPrimaryRedis } from '@ss/queue/redis';
// 三十五收工 R2 Phase A:共享 refund + stale timeout helper(去 worker / router 重复实现)
import {
  refundPrepayForAttempt,
  STALE_TIMEOUT_WORKER_BOOT_MS,
} from '@ss/core/video-generation';

import { startHealthServer, stopHealthServer } from './health.js';
import { createWorker } from './worker.js';

const workerId = `videogen-${process.pid}-${Date.now()}`;
const SHUTDOWN_TIMEOUT_MS = 25_000;

let isShuttingDown = false;

async function bootstrap(): Promise<void> {
  console.log(`[${workerId}] booting...`);

  startHealthServer({ workerId });

  // P0-2(langfuse) + 第 2 轮 audit P0-1:worker 启动时扫 stale RUNNING attempt
  //   场景:上次 worker 进程被 SIGKILL,attempt 永远卡在 RUNNING 状态(DB 视角)。
  //
  //   cutoff = 30min(从 10min 进一步放宽,第 2 轮 audit 发现):
  //     - 防 多 worker 启动时竞态误杀正在跑的真长 job(Seedance 6 次重试 × 60s = 6+ 分钟,
  //       含 BullMQ exponential backoff 5/10/20/40/80s 还会更长)
  //     - 30min 是"绝对孤儿"阈值 — 任何视频生成 job 超过 30min 都该认定为崩溃
  //     - BullMQ 自身 lockDuration 5min 内会续锁,正常 job 不会被 stale 标 FAILED
  //
  // 二十九收工 P1 修(原本只标 FAILED 没退 PREPAY → 资金漏):
  //   - 改 updateMany → findMany + 逐个事务标 FAILED + 写 REFUND ledger
  //   - 复用 aigc.ts:1175-1209 的同款 idempotent 退款逻辑(查 REFUND 是否已存在防双写)
  try {
    const staleCutoff = new Date(Date.now() - STALE_TIMEOUT_WORKER_BOOT_MS);
    const staleAttempts = await prisma.generationAttempt.findMany({
      where: {
        status: 'RUNNING',
        action: 'VIDEO',
        startedAt: { lt: staleCutoff },
      },
      select: {
        id: true,
        createdBy: true,
        projectId: true,
        episodeId: true,
        providerId: true,
      },
    });

    let refundedCount = 0;
    for (const stale of staleAttempts) {
      try {
        const refunded = await prisma.$transaction(async (tx) => {
          await tx.generationAttempt.update({
            where: { id: stale.id },
            data: {
              status: 'FAILED',
              errorMsg: 'worker_restart_recovered: process crashed while attempt was RUNNING',
              finishedAt: new Date(),
            },
          });
          return refundPrepayForAttempt(tx, {
            attemptId: stale.id,
            userId: stale.createdBy,
            projectId: stale.projectId,
            episodeId: stale.episodeId,
            providerId: stale.providerId,
            reason: 'worker_restart_stale_sweep',
          });
        });
        if (refunded) refundedCount++;
      } catch (perAttemptErr) {
        console.error(
          `[${workerId}] stale sweep: attempt ${stale.id} refund failed (non-fatal):`,
          perAttemptErr,
        );
      }
    }

    if (staleAttempts.length > 0) {
      console.warn(
        `[${workerId}] recovered ${staleAttempts.length} stale RUNNING attempt(s) → marked FAILED, ${refundedCount} PREPAY refunded`,
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
