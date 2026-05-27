import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redis = new IORedis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null,
});

const queue = new Queue('video-gen', { connection: redis });

async function main() {
  const counts = await queue.getJobCounts();
  console.log('Queue counts:', counts);

  const active = await queue.getActive();
  console.log(`\nActive jobs (${active.length}):`);
  for (const j of active) {
    console.log(
      `  ${j.id} attemptId=${j.data?.attemptId} group=${j.data?.groupNumber} provider=${j.data?.providerId} processedOn=${j.processedOn ? new Date(j.processedOn).toISOString() : '-'}`,
    );
  }

  const waiting = await queue.getWaiting();
  console.log(`\nWaiting jobs (${waiting.length}):`);
  for (const j of waiting) {
    console.log(`  ${j.id} attemptId=${j.data?.attemptId}`);
  }

  const failed = await queue.getFailed(0, 5);
  console.log(`\nLast failed jobs (${failed.length}):`);
  for (const j of failed) {
    console.log(
      `  ${j.id} attemptId=${j.data?.attemptId} reason=${j.failedReason?.slice(0, 200)}`,
    );
  }

  await queue.close();
  redis.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
