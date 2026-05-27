/**
 * 2026-05-27 audit r15 用户反馈:Connect Timeout 导致 task_id 丢失
 * worker POST moyu → 10s connect timeout → mark FAILED + REFUND
 * 但 moyu 端真的收到了请求 + 异步生成完了视频 → task_id 用户在 moyu 后台能看到
 *
 * 此 script 让用户用 (attemptId + task_id + moyu apiKey) 找回 lost 视频:
 *   1. GET https://www.moyu.info/v1/video/generations/{task_id} 拿 video_url
 *   2. 写 MediaItem(VIDEO)
 *   3. 改 attempt FAILED → SUCCESS + outputMediaId
 *   4. 不动 REFUND(用户白拿一个视频,赔偿 connect timeout bug)
 *
 * 跑法:
 *   node packages/queue/recover-lost-video.mjs <attemptId> <task_id>
 * 例:
 *   node packages/queue/recover-lost-video.mjs cmpnltcrw0011ukecns2kv63x cgt-20260527130855-r5kjq
 */
import { createDecipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '../db/node_modules/@prisma/client/default.js';

const prisma = new PrismaClient();

// 从 .env 加载 APP_MASTER_KEY(不依赖 dotenv)
const envText = readFileSync('C:/Project/starsalign-studio/.env', 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// inline decryptSecret(同 packages/adapters/src/crypto.ts)
function decryptSecret(b64) {
  if (!b64) return '';
  const raw = process.env.APP_MASTER_KEY;
  if (!raw) throw new Error('APP_MASTER_KEY missing');
  const key =
    raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)
      ? Buffer.from(raw, 'hex')
      : createHash('sha256').update(raw, 'utf8').digest();
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

async function main() {
  const [attemptId, taskId] = process.argv.slice(2);
  if (!attemptId || !taskId) {
    console.error('用法: node recover-lost-video.mjs <attemptId> <task_id>');
    process.exit(1);
  }

  const attempt = await prisma.generationAttempt.findUnique({
    where: { id: attemptId },
    include: {
      shotGroup: { select: { number: true, episode: { select: { projectId: true } } } },
    },
  });
  if (!attempt) {
    console.error(`attempt ${attemptId} 不存在`);
    process.exit(1);
  }
  if (attempt.status === 'SUCCESS') {
    console.log(`attempt 已 SUCCESS,outputMediaId=${attempt.outputMediaId}`);
    process.exit(0);
  }

  // 拿 RelayProvider apiKey + apiUrl(decrypt)
  const cfg = await prisma.providerConfig.findUnique({
    where: { providerId: attempt.providerId },
    include: { relayProvider: true },
  });
  if (!cfg?.relayProvider?.apiKeyEnc) {
    console.error('Provider 或 RelayProvider apiKey 不存在');
    process.exit(1);
  }
  const apiUrl = cfg.relayProvider.apiUrl;
  console.log(`Provider apiUrl: ${apiUrl}`);

  const apiKey = decryptSecret(cfg.relayProvider.apiKeyEnc);

  // GET task status(Node 原生 fetch + 60s timeout)
  console.log(`Query task ${taskId} ...`);
  const resp = await fetch(`${apiUrl}/video/generations/${taskId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await resp.text();
  console.log(`HTTP ${resp.status}, response:\n${text.slice(0, 800)}\n`);
  if (!resp.ok) {
    console.error('Query failed');
    process.exit(1);
  }
  const json = JSON.parse(text);

  // 解析 Seedance 2.0 nested response
  const lvl1 = json?.data;
  const innerStatus = (lvl1?.status ?? '').toUpperCase();
  const inner = lvl1?.data ?? {};
  const content = inner?.content ?? {};
  const videoUrl = content.video_url;

  if (innerStatus !== 'SUCCESS' || !videoUrl) {
    console.error(`Task not SUCCESS or no video_url. status=${innerStatus}`);
    process.exit(1);
  }
  console.log(`✓ video_url: ${videoUrl.slice(0, 100)}...`);

  // 写 MediaItem + 升 attempt SUCCESS
  const safeName = (attempt.shotGroup?.number ?? 'recovered').replace(
    /[^a-zA-Z0-9_-]+/g,
    '_',
  );
  const projectId = attempt.shotGroup?.episode?.projectId;
  if (!projectId) {
    console.error('attempt 关联 group/episode 不全');
    process.exit(1);
  }
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const media = await tx.mediaItem.create({
      data: {
        projectId,
        scope: 'PROJECT',
        kind: 'VIDEO',
        filename: `${safeName}-recovered-${now.getTime()}.mp4`,
        mimeType: 'video/mp4',
        sizeBytes: 0,
        storageKey: videoUrl.startsWith('http')
          ? `external://${videoUrl}`
          : videoUrl,
        cdnUrl: videoUrl,
        aspectRatio: inner.ratio ?? null,
        meta: {
          width: inner.width,
          height: inner.height,
          durationS: inner.duration,
          fps: inner.framespersecond,
          providerId: attempt.providerId,
          providerJobId: taskId,
          recoveredAt: now.toISOString(),
          recoveryReason: 'connect_timeout_lost_task_id',
        },
        source: 'AIGC',
        sourceRef: attempt.id,
      },
    });
    await tx.generationAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'SUCCESS',
        providerJobId: taskId,
        outputMediaId: media.id,
        outputMediaIds: [media.id],
        errorMsg: null,
        finishedAt: now,
      },
    });
    return media;
  });
  console.log(`✓ MediaItem created: ${result.id}`);
  console.log(`✓ attempt ${attemptId} → SUCCESS`);
  console.log('\nDone. 刷新 AIGC 页面应该能看到这个视频了。');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
