/**
 * TTS 权重后台安装 job — 七二(用户需求①:新机装包后权重下载不可观测)。
 *
 * 之前权重只在首次生成声线时**藏在 voice-sample job 里同步下载**(845MB,实测新环境
 * ~20 分钟),UI 零反馈 → 用户以为坏了。本 kind 把安装独立成可显式触发的后台任务:
 *   - 进度由 weights.ts 落盘 `<dir>/.progress.json`,UI 经 asset.voiceWeightsStatus 轮询
 *   - 完成/失败发铃铛(失败时 progress 文件带 error,UI 提供「重试安装 / 清理缓存」)
 *   - ensureNanoModels 进程内单例:与 voice-sample 首跑下载天然去重,不会双下
 */
import { prisma } from '@ss/db';
import { sanitizeErrorMsg } from '@ss/shared/errors';
import { z } from 'zod';

import { notify } from '../notify/index.js';
import { ensureNanoModels, getNanoWeightsStatus } from './weights.js';

export const TTS_WEIGHTS_INSTALL_JOB_KIND = 'tts-weights-install' as const;

export const TtsWeightsInstallJobDataSchema = z.object({
  userId: z.string().cuid(),
});
export type TtsWeightsInstallJobData = z.infer<typeof TtsWeightsInstallJobDataSchema>;

export async function processTtsWeightsInstallJob(data: unknown): Promise<void> {
  const payload = TtsWeightsInstallJobDataSchema.parse(data);
  try {
    await ensureNanoModels();
    const st = getNanoWeightsStatus();
    await notify(prisma, {
      userId: payload.userId,
      type: 'job_done',
      title: 'TTS 模型已就绪',
      body: `MOSS-TTS-Nano 权重下载完成(${st.sizeMb}MB)— 声线生成可用了`,
      payload: { kind: TTS_WEIGHTS_INSTALL_JOB_KIND },
    });
  } catch (e) {
    // 失败明细同时留在 .progress.json(state=error),UI 可重试/清缓存
    await notify(prisma, {
      userId: payload.userId,
      type: 'job_failed',
      title: 'TTS 模型安装失败',
      body: `${sanitizeErrorMsg(e)} — 可在声音面板重试,或清理缓存后重新安装`,
      payload: { kind: TTS_WEIGHTS_INSTALL_JOB_KIND },
    }).catch(() => {});
    throw e instanceof Error ? e : new Error(String(e));
  }
}
