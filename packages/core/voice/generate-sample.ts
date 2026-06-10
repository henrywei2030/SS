/**
 * 按角色设定生成参考声音样本 — TTS-B 闭环(queue kind `voice-sample` 的 handler 本体)。
 *
 * 流程:角色设定取样本文案(独白 > 小传 > 模板句)→ 选声线(18 条内置 / 现有参考音频克隆)
 *   → Nano 本地合成(零 Python)→ M2-3 normalizeAudio 响度归一 → MediaItem(AUDIO)
 *   → **自动写 asset.voiceMediaId(闭环)** → GenerationAttempt(action=AUDIO,cost=0,审计)
 *   → notify 铃铛。
 * 失败:notify job_failed,不留半成品(产物落库前的失败无副作用)。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prisma } from '@ss/db';
import { getStorageAdapter, buildStorageKey } from '@ss/adapters/storage';
import { sanitizeErrorMsg } from '@ss/shared/errors';
import { z } from 'zod';

import { normalizeAudio } from '../media/ffmpeg.js';
import { notify } from '../notify/index.js';
import { decodeAudioToPcm, encodeWavPcm16 } from './audio-io.js';
import { getNanoTtsRuntime } from './nano-runtime.js';
import { defaultTtsModelsDir, ensureNanoModels } from './weights.js';

export const VOICE_SAMPLE_JOB_KIND = 'voice-sample' as const;

export const VoiceSampleJobDataSchema = z.object({
  assetId: z.string().cuid(),
  userId: z.string().cuid(),
  /** 'builtin:<name>'(18 条内置)或 'current'(克隆现有参考音频) */
  seedVoice: z.string().default('builtin:Yuewen'),
  /** 不传则用角色独白/小传自动取材 */
  textOverride: z.string().max(120).optional(),
});
export type VoiceSampleJobData = z.infer<typeof VoiceSampleJobDataSchema>;

/** 样本文案取材(纯函数,单测用):独白 > 小传首句段 > 名字模板;裁到 maxChars */
export function buildSampleText(
  asset: { name: string; monologue?: string | null; bio?: string | null },
  maxChars = 80,
): string {
  const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const monologue = clean(asset.monologue ?? '');
  if (monologue.length >= 8) return monologue.slice(0, maxChars);
  const bio = clean(asset.bio ?? '');
  if (bio.length >= 8) return bio.slice(0, maxChars);
  return `大家好，我是${asset.name}。很高兴认识你，接下来的故事，请多指教。`;
}

export async function processVoiceSampleJob(data: unknown): Promise<void> {
  const job = VoiceSampleJobDataSchema.parse(data);
  const asset = await prisma.asset.findFirst({
    where: { id: job.assetId, deletedAt: null },
    select: {
      id: true,
      name: true,
      projectId: true,
      monologue: true,
      bio: true,
      voiceMediaId: true,
    },
  });
  if (!asset) {
    console.warn(`[voice-sample] asset ${job.assetId} 不存在,跳过`);
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), 'ss-voice-sample-'));
  try {
    // 1. 权重就绪(首次自动下载,进度进日志)+ 运行时单例
    const modelsDir = await ensureNanoModels({ dir: defaultTtsModelsDir() });
    const runtime = await getNanoTtsRuntime(modelsDir);

    // 2. 声线来源
    let promptAudioCodes: number[][] | undefined;
    let voiceLabel = job.seedVoice;
    if (job.seedVoice === 'current') {
      if (!asset.voiceMediaId) throw new Error('选择了「克隆现有参考音频」但该角色还没有参考音频');
      const media = await prisma.mediaItem.findFirst({
        where: { id: asset.voiceMediaId, deletedAt: null },
        select: { storageKey: true },
      });
      if (!media) throw new Error('现有参考音频媒体不存在');
      const refPath = join(tmp, 'ref-input');
      if (media.storageKey.startsWith('external://')) {
        const res = await fetch(media.storageKey.slice('external://'.length), {
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error('现有参考音频外链拉取失败(可能过期)');
        await writeFile(refPath, Buffer.from(await res.arrayBuffer()));
      } else {
        const stream = await getStorageAdapter().getObject(media.storageKey);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        await writeFile(refPath, Buffer.concat(chunks));
      }
      const pcm = await decodeAudioToPcm(refPath, {
        sampleRate: runtime.sampleRate,
        channels: runtime.codecChannels,
      });
      promptAudioCodes = await runtime.encodeReferencePcm(pcm.channels);
      voiceLabel = '克隆自现有参考音频';
    }

    // 3. 合成
    const text = (job.textOverride?.trim() || buildSampleText(asset)).slice(0, 120);
    const startedAt = new Date();
    const result = await runtime.synthesize({
      text,
      ...(promptAudioCodes
        ? { promptAudioCodes }
        : { voice: job.seedVoice.replace(/^builtin:/, '') }),
    });

    // 4. WAV → M2-3 规范化(掐静音 + 响度归一 -16 LUFS)→ m4a
    const rawWav = join(tmp, 'raw.wav');
    await writeFile(rawWav, encodeWavPcm16(result.channels, result.sampleRate));
    const outM4a = join(tmp, 'sample.m4a');
    await normalizeAudio({ input: rawWav, output: outM4a });
    const outBuf = await readFile(outM4a);

    // 5. 落库 + 闭环绑定
    const key = buildStorageKey({
      scope: 'project',
      projectId: asset.projectId,
      kind: 'audio',
      ext: 'm4a',
    });
    await getStorageAdapter().putObject(key, outBuf, { contentType: 'audio/mp4' });
    const media = await prisma.mediaItem.create({
      data: {
        projectId: asset.projectId,
        scope: 'PROJECT',
        kind: 'AUDIO',
        filename: `${asset.name}-声线样本.m4a`,
        mimeType: 'audio/mp4',
        sizeBytes: outBuf.length,
        storageKey: key,
        meta: {
          durationS: Math.round(result.durationS * 10) / 10,
          tts: 'moss-tts-nano',
          seedVoice: voiceLabel,
          sampleText: text,
        },
        source: 'AIGC',
        sourceRef: `voice-sample:${asset.id}`,
      },
      select: { id: true },
    });
    await prisma.asset.update({
      where: { id: asset.id },
      data: { voiceMediaId: media.id, voiceModelId: `moss-tts-nano:${voiceLabel}` },
    });

    await prisma.generationAttempt.create({
      data: {
        projectId: asset.projectId,
        assetId: asset.id,
        createdBy: job.userId,
        providerId: 'local-moss-tts-nano',
        modelId: 'MOSS-TTS-Nano-100M-ONNX',
        action: 'AUDIO',
        inputJson: { text, seedVoice: voiceLabel },
        outputMediaId: media.id,
        unitPriceCny: '0',
        costCny: '0',
        status: 'SUCCESS',
        startedAt,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      },
    });

    await notify(prisma, {
      userId: job.userId,
      type: 'job_done',
      title: `「${asset.name}」声线样本已生成`,
      body: `${voiceLabel} · ${Math.round(result.durationS)}s · 已自动设为该角色参考音频(本地生成,免费)`,
      payload: { assetId: asset.id, mediaId: media.id },
    });
  } catch (err) {
    const msg = sanitizeErrorMsg(err, 400);
    console.error(`[voice-sample] asset ${job.assetId} failed:`, msg);
    await notify(prisma, {
      userId: job.userId,
      type: 'job_failed',
      title: `「${asset.name}」声线样本生成失败`,
      body: msg,
      payload: { assetId: asset.id },
    }).catch((e) => console.error(`[voice-sample] 失败通知发送失败:`, e));
    // 抛脱敏后的消息(原始 err 可能含内网路径/密钥;队列侧只需知道失败)
    throw new Error(msg);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
