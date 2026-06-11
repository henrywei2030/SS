/**
 * QC 质检 job handler(M3c,queue kind `qc` 本体;蓝图 docs/06 §M3 F6)。
 *
 * 链路:视频 take SUCCESS → process-job 末尾按开关入队(take.qc.enabled 默认关)→
 *   本 handler 下载视频 → ffmpeg 抽首/中/尾帧(降采样 ≤768px)→ 连同人物参考图
 *   base64 内联喂 VLM 判官(binding.shot.qc.modelId)→ qcScore/qcJson 落 attempt +
 *   CostLedgerEntry(action=qc.evaluate,NORMAL)。
 *
 * 语义(对齐 cache-video:增强项不抛):
 *   - 幂等:qcScore 已写 / attempt 非 SUCCESS / 已被拒 → 跳过
 *   - 失败:qcJson={error} 落库供 UI 显示,**不抛**(take 可用性不受 QC 影响)
 *   - 判官调用成功但输出不可解析:照实写 ledger(钱已花),qcJson 记错误
 */
import { createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { getTextProvider } from '@ss/adapters/provider';
import { getStorageAdapter } from '@ss/adapters/storage';
import { prisma } from '@ss/db';
import { billingCycle, sanitizeErrorMsg } from '@ss/shared';
import { z } from 'zod';

import { extractFrame, probeMedia, resolveMediaFetchUrl } from '../media/index.js';
import { applyQcFeedbackToKnowledge } from '../prompt-knowledge/index.js';
import { detectProviderFamily } from '../prompt-optimizer/fallback-template.js';

import { buildQcPrompt, parseQcVerdict } from './evaluate.js';

export const QC_JOB_KIND = 'qc' as const;

/** QC 开关(SystemSetting,默认 'false')— 入队侧与 seed.ts 共用此 key */
export const TAKE_QC_ENABLED_KEY = 'take.qc.enabled' as const;
/** 判官模型 binding(SystemSetting,admin /admin/bindings 选视觉模型)*/
export const QC_JUDGE_BINDING_KEY = 'binding.shot.qc.modelId' as const;

/** 抽帧降采样长边上限(px)— 控判官输入体积/token */
const QC_FRAME_MAX_DIM = 768;
/** 人物参考图上限 — 防多人群戏把判官输入撑爆(取绑定顺序前 N 个有形象图的) */
const QC_MAX_PORTRAITS = 2;
/** 深审修(P2):单张人物图体积上限 — 4K 原图 base64 会超中转站/Anthropic 单图硬限,
 * 整个判官请求 400 且该组每个 take 都重复失败;超限跳过该图(faceConsistency 退化为 null) */
const QC_MAX_PORTRAIT_BYTES = 3 * 1024 * 1024;

export const QcJobDataSchema = z.object({
  attemptId: z.string().cuid(),
  projectId: z.string().cuid(),
  episodeId: z.string().cuid(),
  shotGroupId: z.string().cuid(),
  userId: z.string().cuid(),
  /** 生成时编译后的明文 prompt(跟题对照基准)— 与 VideoGenJobData.prompt 同敏感度,只进队列;落库走脱敏 qcJson */
  prompt: z.string().min(1).max(20000),
  requestId: z.string().optional(),
});
export type QcJobData = z.infer<typeof QcJobDataSchema>;

export async function processQcJob(data: unknown): Promise<void> {
  const payload = QcJobDataSchema.parse(data);
  const reqTag = payload.requestId ? `[req=${payload.requestId}]` : '';
  try {
    await runQc(payload, reqTag);
  } catch (e) {
    const msg = sanitizeErrorMsg(e, 300);
    console.warn(`[qc]${reqTag} attempt=${payload.attemptId} 评分失败(take 可用性不受影响):`, msg);
    // qcScore 仍空时才写错误(防与并发成功写互踩);写库失败静默 — QC 是增强项
    await prisma.generationAttempt
      .updateMany({
        where: { id: payload.attemptId, qcScore: null },
        data: { qcJson: { error: msg, at: new Date().toISOString() } },
      })
      .catch(() => {});
  }
}

async function runQc(payload: QcJobData, reqTag: string): Promise<void> {
  const { attemptId, projectId, episodeId, shotGroupId, userId } = payload;

  // 幂等 + 状态门:仅未评分的成功未拒 take 才值得花判官钱
  const attempt = await prisma.generationAttempt.findUnique({
    where: { id: attemptId },
    // providerId:H3 飞轮按模型家族沉淀漂移雷点用
    select: { status: true, outputMediaId: true, qcScore: true, rejected: true, providerId: true },
  });
  if (!attempt || attempt.status !== 'SUCCESS' || !attempt.outputMediaId || attempt.rejected) {
    console.log(`[qc]${reqTag} attempt=${attemptId} 非可评状态,跳过`);
    return;
  }
  if (attempt.qcScore !== null) return; // 已评,幂等跳过

  // 判官 binding(入队侧已查过;这里兜底防入队后被清空)
  const judgeRow = await prisma.systemSetting.findUnique({
    where: { key: QC_JUDGE_BINDING_KEY },
    select: { value: true },
  });
  const judgeModelId = judgeRow?.value?.trim();
  if (!judgeModelId) {
    console.warn(`[qc]${reqTag} ${QC_JUDGE_BINDING_KEY} 未配置,跳过评分`);
    return;
  }

  const videoMedia = await prisma.mediaItem.findFirst({
    where: { id: attempt.outputMediaId, deletedAt: null, kind: 'VIDEO' },
    select: { id: true, cdnUrl: true, storageKey: true },
  });
  if (!videoMedia) throw new Error('take 视频媒体不存在或已删');

  const storage = getStorageAdapter();
  const tmp = mkdtempSync(join(tmpdir(), 'ss-qc-'));
  try {
    // 下载视频(口径同 chainTailFrame:可 fetch URL 优先,本地存储流式兜底)
    const videoPath = join(tmp, 'take-video');
    const fetchUrl = await resolveMediaFetchUrl(videoMedia);
    if (fetchUrl) {
      const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok || !res.body) {
        throw new Error('take 视频拉取失败 — provider 直链可能已过期(等 cache-video 落地后重跑)');
      }
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(videoPath));
    } else {
      await pipeline(await storage.getObject(videoMedia.storageKey), createWriteStream(videoPath));
    }

    // 抽首/中/尾帧(长边 >768 降采样;宽高未知时不缩放,体积仍有 jpg q2 兜着)
    const probe = await probeMedia(videoPath);
    const w = probe.width ?? 0;
    const h = probe.height ?? 0;
    const scale =
      Math.max(w, h) > QC_FRAME_MAX_DIM
        ? w >= h
          ? `${QC_FRAME_MAX_DIM}:-2`
          : `-2:${QC_FRAME_MAX_DIM}`
        : undefined;
    const framePaths = [join(tmp, 'f1.jpg'), join(tmp, 'f2.jpg'), join(tmp, 'f3.jpg')] as const;
    // 深审修(P2):allSettled 等三个 ffmpeg 全部退出后再抛首个失败 — Promise.all 提前
    // reject 会让 finally rmSync 与仍在写盘的子进程竞争(Windows EBUSY 顶替原始错误 + tmp 泄漏)
    const frameResults = await Promise.allSettled([
      extractFrame({ input: videoPath, output: framePaths[0], atS: 0, scale }),
      extractFrame({ input: videoPath, output: framePaths[1], atS: probe.durationS / 2, scale }),
      extractFrame({ input: videoPath, output: framePaths[2], scale }), // 尾帧(-sseof)
    ]);
    const frameErr = frameResults.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (frameErr) throw frameErr.reason;
    const frameUrls = await Promise.all(
      framePaths.map(async (p) => `data:image/jpeg;base64,${(await readFile(p)).toString('base64')}`),
    );

    // 人物参考图:绑定走 compile 同口径(refSlotIdx 非空 + 未删),CHARACTER 去重取形象图
    const { portraitNames, portraitUrls } = await collectPortraitRefs(shotGroupId, reqTag);

    const { system, prompt } = buildQcPrompt({
      prompt: payload.prompt,
      frameCount: frameUrls.length,
      portraitNames,
    });

    // VLM 判官调用(skipLedger:单点写在下方事务,ADR-25 口径)
    const provider = await getTextProvider(judgeModelId);
    let result;
    try {
      result = await provider.generate(
        {
          system,
          prompt,
          imageUrls: [...frameUrls, ...portraitUrls],
          jsonSchema: { type: 'object' }, // 触发 response_format=json_object
          temperature: 0,
          maxTokens: 1000,
        },
        { userId, projectId, episodeId, attemptId, skipLedger: true },
      );
    } catch (e) {
      // 调用失败:记 0 成本失败 entry(口径同 generateKeyframe 失败路径),错误冒给外层落 qcJson
      await prisma.costLedgerEntry
        .create({
          data: {
            userId,
            projectId,
            episodeId,
            attemptId,
            providerId: judgeModelId,
            modelId: judgeModelId,
            action: 'qc.evaluate',
            inputUnits: 0,
            outputUnits: 0,
            unitPriceCny: '0',
            costCny: '0',
            success: false,
            billingCycle: billingCycle(),
          },
        })
        .catch(() => {});
      throw e;
    }

    // 解析判官输出;无论可否解析,钱已花 → ledger 照实写(同事务)
    let verdict: ReturnType<typeof parseQcVerdict> | null = null;
    try {
      verdict = parseQcVerdict(result.json ?? JSON.parse(result.text));
    } catch {
      verdict = null;
    }
    const ktok = (result.inputTokens + result.outputTokens) / 1000;
    const unitPriceCny = ktok > 0 ? (result.costCny / ktok).toFixed(6) : '0';
    const qcJson = verdict
      ? {
          dims: verdict.dims,
          drift: verdict.drift,
          notes: verdict.notes,
          judge: judgeModelId,
          frames: frameUrls.length,
          portraits: portraitNames,
          durationS: probe.durationS,
          costCny: result.costCny,
          at: new Date().toISOString(),
        }
      : {
          error: `判官输出不可解析(${result.truncated ? 'maxTokens 截断' : 'JSON 形状不符'})`,
          judge: judgeModelId,
          costCny: result.costCny,
          at: new Date().toISOString(),
        };

    await prisma.$transaction(async (tx) => {
      // qcScore null 守卫:并发双跑时只允许第一个写入(updateMany 不抛,count=0 即让位)
      const updated = await tx.generationAttempt.updateMany({
        where: { id: attemptId, qcScore: null },
        data: { qcScore: verdict ? verdict.score : null, qcJson },
      });
      if (updated.count === 0) return;
      await tx.costLedgerEntry.create({
        data: {
          userId,
          projectId,
          episodeId,
          attemptId,
          providerId: judgeModelId,
          modelId: judgeModelId,
          action: 'qc.evaluate',
          inputUnits: result.inputTokens,
          outputUnits: result.outputTokens,
          unitPriceCny,
          costCny: result.costCny.toFixed(4),
          success: true,
          billingCycle: billingCycle(),
        },
      });
    });

    console.log(
      `[qc]${reqTag} attempt=${attemptId} 评分完成 score=${verdict?.score ?? 'unparsed'} drift=${verdict?.drift ?? '-'} cost=¥${result.costCny.toFixed(4)}`,
    );

    // H3 飞轮(docs/07 回路②③):QC 分反馈知识片段权重 + 漂移按家族沉淀约束维候选。
    // 增强项:任何失败已在函数内吞掉,不影响 QC 主流程。
    if (verdict && shotGroupId) {
      await applyQcFeedbackToKnowledge(prisma, {
        groupId: shotGroupId,
        qcScore: verdict.score,
        drift: verdict.drift,
        providerFamily: detectProviderFamily(attempt.providerId),
      });
    }
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch (e) {
      // win-laptop:文件句柄竞争可 EBUSY(force 只吞 ENOENT)— 残留 tmp 不致命,别顶替业务错误
      console.warn('[qc] tmp 目录清理失败(不影响评分结果):', sanitizeErrorMsg(e, 120));
    }
  }
}

/** 绑定人物 → 形象图 base64(取前 N 个有形象图的;单图失败跳过不连坐) */
async function collectPortraitRefs(
  shotGroupId: string,
  reqTag: string,
): Promise<{ portraitNames: string[]; portraitUrls: string[] }> {
  const bindings = await prisma.assetUsageBinding.findMany({
    where: { shotGroupId, deletedAt: null, refSlotIdx: { not: null } },
    orderBy: { refSlotIdx: 'asc' },
    select: {
      asset: { select: { id: true, name: true, type: true, portraitMediaId: true } },
    },
  });
  const seen = new Set<string>();
  const candidates: Array<{ name: string; mediaId: string }> = [];
  for (const b of bindings) {
    if (b.asset.type !== 'CHARACTER' || seen.has(b.asset.id)) continue;
    seen.add(b.asset.id);
    if (b.asset.portraitMediaId) {
      candidates.push({ name: b.asset.name, mediaId: b.asset.portraitMediaId });
    }
  }
  const portraitNames: string[] = [];
  const portraitUrls: string[] = [];
  for (const c of candidates) {
    if (portraitUrls.length >= QC_MAX_PORTRAITS) break;
    const media = await prisma.mediaItem.findFirst({
      where: { id: c.mediaId, deletedAt: null },
      select: { cdnUrl: true, storageKey: true, mimeType: true },
    });
    if (!media) continue;
    try {
      const url = await resolveMediaFetchUrl(media);
      if (!url) continue;
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      // 深审修(P2):超体积跳过(沿用"单图失败跳过不连坐"语义)— 否则该组每个 take 的
      // 判官请求都被这张大图撑爆,QC 恒失败
      if (buf.length > QC_MAX_PORTRAIT_BYTES) {
        console.warn(
          `[qc]${reqTag} 人物 ${c.name} 形象图 ${(buf.length / 1048576).toFixed(1)}MB 超上限,跳过(faceConsistency 将退化)`,
        );
        continue;
      }
      portraitUrls.push(
        `data:${media.mimeType || 'image/png'};base64,${buf.toString('base64')}`,
      );
      portraitNames.push(c.name);
    } catch (e) {
      console.warn(`[qc]${reqTag} 人物参考图拉取失败(跳过 ${c.name}):`, sanitizeErrorMsg(e, 120));
    }
  }
  return { portraitNames, portraitUrls };
}
