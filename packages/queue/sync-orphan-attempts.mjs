/**
 * 同步 BullMQ failed 但 DB 仍 RUNNING/QUEUED 的孤儿 attempt
 * 把 attempt 标 FAILED + 写 REFUND 退 PREPAY,让用户能立刻再点生成
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '../db/node_modules/@prisma/client/default.js';

const redis = new IORedis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null,
});

const prisma = new PrismaClient();
const queue = new Queue('video-gen', { connection: redis });

async function main() {
  // 1. 拿 BullMQ 所有 failed job 的 attemptId
  const failedJobs = await queue.getFailed(0, 100);
  const failedAttemptIds = new Set(
    failedJobs.map((j) => j.data?.attemptId).filter(Boolean),
  );
  console.log(`BullMQ failed jobs: ${failedAttemptIds.size}`);

  // 2. 查 DB 中 RUNNING/QUEUED + 属于 failed BullMQ 的 attempt
  const orphans = await prisma.generationAttempt.findMany({
    where: {
      status: { in: ['RUNNING', 'QUEUED'] },
      action: 'VIDEO',
      id: { in: Array.from(failedAttemptIds) },
    },
  });
  console.log(`Orphan attempts (BullMQ failed + DB RUNNING/QUEUED): ${orphans.length}`);

  for (const a of orphans) {
    // 拿对应 BullMQ failedReason 作为 errorMsg
    const job = failedJobs.find((j) => j.data?.attemptId === a.id);
    const reason = job?.failedReason ?? 'BullMQ failed but DB stuck RUNNING';
    console.log(`  ${a.id} → mark FAILED (${reason.slice(0, 100)}...)`);

    await prisma.$transaction(async (tx) => {
      await tx.generationAttempt.update({
        where: { id: a.id },
        data: {
          status: 'FAILED',
          errorMsg: `(synced from BullMQ) ${reason}`,
          finishedAt: new Date(),
          durationMs: a.startedAt ? Date.now() - a.startedAt.getTime() : null,
        },
      });
      // 退 PREPAY
      const existingRefund = await tx.costLedgerEntry.findFirst({
        where: { attemptId: a.id, entryType: 'REFUND' },
        select: { id: true },
      });
      if (!existingRefund) {
        const prepay = await tx.costLedgerEntry.findFirst({
          where: { attemptId: a.id, entryType: 'PREPAY' },
          select: { id: true, costCny: true },
        });
        if (prepay && Number(prepay.costCny) > 0) {
          await tx.costLedgerEntry.create({
            data: {
              userId: a.createdBy,
              projectId: a.projectId,
              episodeId: a.episodeId,
              attemptId: a.id,
              providerId: a.providerId,
              modelId: a.modelId,
              action: 'video.generate',
              inputUnits: 0,
              outputUnits: 0,
              unitPriceCny: '0',
              costCny: `-${prepay.costCny}`,
              success: true,
              entryType: 'REFUND',
              refundReason: 'orphan_sync_from_bullmq',
              parentEntryId: prepay.id,
              billingCycle: new Date().toISOString().slice(0, 7),
            },
          });
          console.log(`    ✓ REFUND ${prepay.costCny}¥ written`);
        }
      }
    });
  }

  await queue.close();
  redis.disconnect();
  await prisma.$disconnect();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
