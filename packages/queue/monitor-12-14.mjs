/**
 * 监控分镜组 12-14 视频生成全链路 — 用户操作前 baseline + 操作后对比
 *
 * 跑法:node packages/queue/monitor-12-14.mjs [baseline|status]
 *   baseline:记录当前状态(操作前)
 *   status:打印对比(操作后,加 deltas)
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

const TARGET_GROUP_NUMBER = '12-14';

async function main() {
  const now = new Date();
  console.log(`=== Monitor @ ${now.toISOString()} (UTC) | 北京 ${new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ')} ===\n`);

  // 1. 找 12-14 group(可能多个项目都有,取最新)
  const groups = await prisma.shotGroup.findMany({
    where: { number: TARGET_GROUP_NUMBER, deletedAt: null },
    include: { episode: { select: { number: true, projectId: true, project: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log(`找到 ${groups.length} 个 number="12-14" 的 group:`);
  for (const g of groups) {
    console.log(
      `  groupId=${g.id} ep=${g.episode?.number} project=${g.episode?.project?.name} createdAt=${g.createdAt.toISOString()}`,
    );
  }
  const targetGroup = groups[0]; // 最新一条
  if (!targetGroup) {
    console.log('❌ 未找到 12-14 group');
    process.exit(1);
  }
  console.log(`\n目标 group: ${targetGroup.id}\n`);

  // 2. 该 group 所有 video attempt
  const attempts = await prisma.generationAttempt.findMany({
    where: { shotGroupId: targetGroup.id, action: 'VIDEO' },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`Video attempts for group 12-14 (${attempts.length} 条):`);
  for (const a of attempts) {
    console.log(`  📄 ${a.id} status=${a.status} provider=${a.providerId}`);
    console.log(
      `      createdAt=${a.createdAt.toISOString()} startedAt=${a.startedAt?.toISOString() ?? '-'} finishedAt=${a.finishedAt?.toISOString() ?? '-'}`,
    );
    console.log(
      `      jobId=${a.providerJobId ?? '-'} cost=${a.costCny}¥ rejected=${a.rejected}`,
    );
    if (a.outputMediaId) console.log(`      ✓ outputMediaId=${a.outputMediaId}`);
    if (a.errorMsg) console.log(`      ❌ errorMsg=${a.errorMsg.slice(0, 250)}`);
  }

  // 3. CostLedger entries for these attempts
  const attemptIds = attempts.map((a) => a.id);
  if (attemptIds.length > 0) {
    const ledger = await prisma.costLedgerEntry.findMany({
      where: { attemptId: { in: attemptIds } },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`\nCostLedger entries (${ledger.length}):`);
    for (const e of ledger) {
      console.log(
        `  💰 ${e.entryType} attempt=${e.attemptId?.slice(-8)} cost=${e.costCny}¥ ${e.refundReason ?? ''} createdAt=${e.createdAt.toISOString()}`,
      );
    }
  }

  // 4. BullMQ queue 全景
  const counts = await queue.getJobCounts();
  console.log('\nBullMQ counts:', counts);
  const active = await queue.getActive();
  if (active.length > 0) {
    console.log(`\nActive jobs (${active.length}):`);
    for (const j of active) {
      const inGroup =
        j.data?.shotGroupId === targetGroup.id ? ' ★ (本 group)' : '';
      console.log(
        `  ${j.id} attemptId=${j.data?.attemptId} group=${j.data?.groupNumber}${inGroup} processedOn=${j.processedOn ? new Date(j.processedOn).toISOString() : '-'}`,
      );
    }
  }
  const waiting = await queue.getWaiting();
  if (waiting.length > 0) {
    console.log(`\nWaiting jobs (${waiting.length}):`);
    for (const j of waiting) {
      const inGroup =
        j.data?.shotGroupId === targetGroup.id ? ' ★ (本 group)' : '';
      console.log(`  ${j.id} attemptId=${j.data?.attemptId}${inGroup}`);
    }
  }
  const failed = await queue.getFailed(0, 10);
  if (failed.length > 0) {
    console.log(`\nLast failed jobs (${failed.length}):`);
    for (const j of failed) {
      const inGroup =
        j.data?.shotGroupId === targetGroup.id ? ' ★ (本 group)' : '';
      console.log(
        `  ${j.id} attemptId=${j.data?.attemptId}${inGroup} reason=${(j.failedReason ?? '').slice(0, 150)}`,
      );
    }
  }
  const completed = await queue.getCompleted(0, 5);
  if (completed.length > 0) {
    console.log(`\nLast completed jobs (${completed.length}):`);
    for (const j of completed) {
      const inGroup =
        j.data?.shotGroupId === targetGroup.id ? ' ★ (本 group)' : '';
      console.log(
        `  ${j.id} attemptId=${j.data?.attemptId}${inGroup} return=${JSON.stringify(j.returnvalue).slice(0, 120)}`,
      );
    }
  }

  // 5. MediaItem (该 group attempts 的 outputMediaId)
  const mediaIds = attempts
    .map((a) => a.outputMediaId)
    .filter((id) => !!id);
  if (mediaIds.length > 0) {
    const medias = await prisma.mediaItem.findMany({
      where: { id: { in: mediaIds } },
    });
    console.log(`\nMediaItem (${medias.length}):`);
    for (const m of medias) {
      console.log(
        `  🎬 ${m.id} cdnUrl=${m.cdnUrl?.slice(0, 80)}... aspect=${m.aspectRatio} size=${m.sizeBytes}`,
      );
    }
  }

  // 6. Provider + RelayProvider 凭证状态
  const seedanceCfg = await prisma.providerConfig.findUnique({
    where: { providerId: 'moyu-doubao-seedance-2-0-fast' },
    include: { relayProvider: true },
  });
  if (seedanceCfg) {
    console.log(
      `\nProviderConfig: isActive=${seedanceCfg.isActive} relay=${seedanceCfg.relayProvider?.name} apiKeyConfigured=${!!seedanceCfg.relayProvider?.apiKeyEnc}`,
    );
    console.log(`  apiKeyUpdatedAt=${seedanceCfg.relayProvider?.apiKeyUpdatedAt?.toISOString() ?? '-'}`);
  }

  await queue.close();
  redis.disconnect();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
