/**
 * 成片渲染编排器 — M1(蓝图 docs/06 §3 M1),queue kind `compose` 的 handler 本体。
 *
 * 流程:取 EpisodeRender(QUEUED→RUNNING)→ 时间线(权威重算)→ 下载各组 take 到临时目录
 *   → SRT(台词正则 + ffprobe 实测时长累加)→ concat 统一 1080p 档(比例随 Project.aspect)
 *   → 字幕烧录(可选;失败自动回退不烧,SRT 仍单独落库可外挂)→ 可选 BGM ducking
 *   → 产物(MP4 + SRT)上传存储 + 建 MediaItem → 标 SUCCESS + 通知(M0 notify)。
 *
 * 失败处理:任何一步抛错 → 标 FAILED + sanitizeErrorMsg + 通知;临时目录 finally 清理。
 * 幂等:status != QUEUED 直接跳过(BullMQ jobId 去重 + 这里兜底,防 crash 后重复消费)。
 * take 文件来源兜底:storageKey 为 external://(provider 直链,可能 24h 过期)时走 fetch,
 *   过期/失败给出指明组号的清晰错误。
 */
import { createWriteStream, mkdtempSync, rmSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { prisma } from '@ss/db';
import { getStorageAdapter, buildStorageKey } from '@ss/adapters/storage';
import { sanitizeErrorMsg } from '@ss/shared/errors';
import { z } from 'zod';

import { concatVideos, mixBgm, probeMedia, runFfmpeg } from '../media/ffmpeg.js';
import { episodeRenderBasename } from '../media/naming.js';
import { notify } from '../notify/index.js';
import { extractDialogueLines } from '../script/parse.js';
import { buildSrtCues, formatSrt, sliceLinesByDuration, type SrtSegment } from './srt.js';
import { buildEpisodeTimeline, type TimelineEntry } from './timeline.js';

export const COMPOSE_JOB_KIND = 'compose' as const;

export const ComposeJobDataSchema = z.object({
  renderId: z.string().cuid(),
});
export type ComposeJobData = z.infer<typeof ComposeJobDataSchema>;

export interface ComposeRenderParams {
  allowGaps: boolean;
  burnSubtitles: boolean;
  bgmMediaId?: string;
}

/** Project.aspect → 1080p 档目标尺寸(蓝图:concat 统一 1080p 目标比例) */
export function targetDimensions(aspect: string): { width: number; height: number } {
  switch (aspect) {
    case '9:16':
      return { width: 1080, height: 1920 };
    case '1:1':
      return { width: 1080, height: 1080 };
    case '3:4':
      return { width: 1080, height: 1440 };
    case '4:3':
      return { width: 1440, height: 1080 };
    case '21:9':
      return { width: 2520, height: 1080 };
    case '16:9':
    default:
      return { width: 1920, height: 1080 };
  }
}

/**
 * subtitles filter 的路径转义(纯函数,单测用):
 * libass filter 参数里 `\` `:` `'` 是元字符 — Windows 盘符路径(C:\...)不转义必炸。
 * 统一正斜杠 + 转义冒号/单引号,外层用单引号包。
 */
export function escapeSubtitlesPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/**
 * 场头元数据"伪台词"黑名单:场原文里「人物：陆峰、赵万里」这类元数据行
 * 会被对白正则误判(speaker=人物)— 按 speaker 过滤掉。
 */
const METADATA_SPEAKERS = new Set([
  '人物', '场景', '时间', '地点', '道具', '服装', '化妆', '音乐', '音效', '字幕', '备注', '注',
]);

/**
 * 从场原文提取台词文本(纯函数,单测用)。
 * 台词源是 Scene.content(场原文)— 本库 512 镜头实测 0 台词,镜头 prompt/content
 * 都是画面描述(2026-06-10 M1 验收发现,修正蓝图"从 shot.content 提"的假设)。
 */
export function extractSceneDialogueTexts(sceneContent: string): string[] {
  return extractDialogueLines(sceneContent)
    .filter((l) => !l.speaker || !METADATA_SPEAKERS.has(l.speaker))
    .map((l) => l.text);
}

/** 把 MediaItem 内容解析到本地文件(storage 下载 / external:// 直链 fetch) */
async function resolveMediaToFile(
  media: { id: string; storageKey: string; cdnUrl: string | null },
  destPath: string,
  label: string,
): Promise<void> {
  const storage = getStorageAdapter();
  if (media.storageKey.startsWith('external://')) {
    const url = media.storageKey.slice('external://'.length);
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      throw new Error(
        `${label} 的视频是外链(provider 直链)且拉取失败 — 直链可能已过期(火山 24h),需重新生成该段。原因: ${sanitizeErrorMsg(err)}`,
      );
    }
    if (!res.ok || !res.body) {
      throw new Error(
        `${label} 的视频外链返回 ${res.status} — 直链可能已过期(火山 24h),需重新生成该段`,
      );
    }
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(destPath));
    return;
  }
  const stream = await storage.getObject(media.storageKey);
  await pipeline(stream, createWriteStream(destPath));
}

interface ReadyEntryFile {
  entry: TimelineEntry;
  filePath: string;
  durationS: number;
}

/** queue handler 入口 — registerJobHandler(COMPOSE_JOB_KIND, processComposeRender) */
export async function processComposeRender(data: unknown): Promise<void> {
  const { renderId } = ComposeJobDataSchema.parse(data);

  const render = await prisma.episodeRender.findUnique({
    where: { id: renderId },
    include: {
      episode: {
        select: {
          id: true,
          number: true,
          projectId: true,
          project: { select: { id: true, name: true, aspect: true } },
        },
      },
    },
  });
  if (!render) {
    console.warn(`[compose] render ${renderId} 不存在,跳过`);
    return;
  }
  if (render.status !== 'QUEUED') {
    console.warn(`[compose] render ${renderId} status=${render.status} 非 QUEUED,跳过(幂等)`);
    return;
  }

  const params = (render.paramsJson ?? {}) as Partial<ComposeRenderParams>;
  const episode = render.episode;
  const tmp = mkdtempSync(join(tmpdir(), 'ss-compose-'));

  try {
    await prisma.episodeRender.update({
      where: { id: renderId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    // ---- 1. 时间线(处理时权威重算,不信任入队时快照) ----
    const timeline = await buildEpisodeTimeline(prisma, episode.id);
    if (timeline.ready.length === 0) {
      throw new Error('没有任何生成段有可用 take(成功且未拒),无法成片');
    }
    if (timeline.gaps.length > 0 && !params.allowGaps) {
      throw new Error(
        `存在缺口段(无可用 take): ${timeline.gaps.map((g) => g.number).join(' / ')} — 补齐后重试,或勾选「允许缺口」跳过`,
      );
    }

    // ---- 2. 下载各段 take + ffprobe 实测 ----
    const mediaIds = timeline.ready.map((e) => e.take!.mediaId);
    const mediaRows = await prisma.mediaItem.findMany({
      where: { id: { in: mediaIds } },
      select: { id: true, storageKey: true, cdnUrl: true },
    });
    const mediaById = new Map(mediaRows.map((m) => [m.id, m]));

    const files: ReadyEntryFile[] = [];
    for (let i = 0; i < timeline.ready.length; i++) {
      const entry = timeline.ready[i]!;
      const media = mediaById.get(entry.take!.mediaId);
      if (!media) throw new Error(`分镜组 ${entry.number} 的 take 媒体记录缺失`);
      const filePath = join(tmp, `seg-${String(i).padStart(3, '0')}.mp4`);
      await resolveMediaToFile(media, filePath, `分镜组 ${entry.number}`);
      const probe = await probeMedia(filePath);
      if (!probe.hasVideo) throw new Error(`分镜组 ${entry.number} 的 take 文件无视频流`);
      files.push({ entry, filePath, durationS: probe.durationS });
    }

    // ---- 3. SRT(场原文提台词 → 按同场各组实测时长比例切分 → 实测时长累加) ----
    const sceneIds = [...new Set(files.map((f) => f.entry.sceneId).filter((x): x is string => !!x))];
    const scenes = sceneIds.length
      ? await prisma.scene.findMany({
          where: { id: { in: sceneIds } },
          select: { id: true, content: true },
        })
      : [];
    const dialogueByScene = new Map(
      scenes.map((s) => [s.id, extractSceneDialogueTexts(s.content ?? '')]),
    );
    // 同场的(就绪)组按时间线顺序聚簇,场内台词按各组时长比例连续切分
    const linesPerFile: string[][] = files.map(() => []);
    const sceneEntryIdx = new Map<string, number[]>();
    files.forEach((f, idx) => {
      if (!f.entry.sceneId) return;
      const list = sceneEntryIdx.get(f.entry.sceneId);
      if (list) list.push(idx);
      else sceneEntryIdx.set(f.entry.sceneId, [idx]);
    });
    for (const [sceneId, idxs] of sceneEntryIdx) {
      const slices = sliceLinesByDuration(
        dialogueByScene.get(sceneId) ?? [],
        idxs.map((i) => files[i]!.durationS),
      );
      idxs.forEach((fileIdx, k) => {
        linesPerFile[fileIdx] = slices[k] ?? [];
      });
    }
    const segments: SrtSegment[] = files.map((f, i) => ({
      durationS: f.durationS,
      lines: linesPerFile[i]!,
    }));
    const srtContent = formatSrt(buildSrtCues(segments));
    const srtPath = join(tmp, 'subtitle.srt');
    await writeFile(srtPath, srtContent, 'utf8');

    // ---- 4. concat 统一 1080p 档 ----
    const dims = targetDimensions(episode.project.aspect);
    const concatOut = join(tmp, 'concat.mp4');
    await concatVideos(
      files.map((f) => f.filePath),
      concatOut,
      { ...dims, fps: 30, timeoutMs: 20 * 60_000 },
    );

    // ---- 5. 字幕烧录(可选,失败回退不烧) ----
    let current = concatOut;
    let burnFallback = false;
    const wantBurn = params.burnSubtitles !== false && srtContent.trim().length > 0;
    if (wantBurn) {
      const burnedOut = join(tmp, 'burned.mp4');
      try {
        await runFfmpeg(
          [
            '-y',
            '-i', current,
            '-vf', `subtitles='${escapeSubtitlesPath(srtPath)}'`,
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '18',
            '-c:a', 'copy',
            burnedOut,
          ],
          { timeoutMs: 20 * 60_000 },
        );
        current = burnedOut;
      } catch (err) {
        // 静态 ffmpeg 的 libass/字体环境因平台而异 — 烧录失败不阻断成片,SRT 仍单独产出
        burnFallback = true;
        console.warn(`[compose] 字幕烧录失败,回退不烧(SRT 仍单独落库):`, sanitizeErrorMsg(err));
      }
    }

    // ---- 6. 可选 BGM(对白 ducking) ----
    if (params.bgmMediaId) {
      const bgmMedia = await prisma.mediaItem.findUnique({
        where: { id: params.bgmMediaId },
        select: { id: true, storageKey: true, cdnUrl: true },
      });
      if (!bgmMedia) throw new Error('BGM 媒体不存在');
      const bgmPath = join(tmp, 'bgm-input');
      await resolveMediaToFile(bgmMedia, bgmPath, 'BGM');
      const mixedOut = join(tmp, 'mixed.mp4');
      await mixBgm({
        videoIn: current,
        bgmIn: bgmPath,
        output: mixedOut,
        timeoutMs: 20 * 60_000,
      });
      current = mixedOut;
    }

    // ---- 7. 上传产物 + 建 MediaItem ----
    const storage = getStorageAdapter();
    const finalProbe = await probeMedia(current);
    const sizeBytes = statSync(current).size;
    const seq =
      (await prisma.episodeRender.count({
        where: { episodeId: episode.id, status: 'SUCCESS' },
      })) + 1;
    // 六八命名规范:统一走 naming.ts(`项目_第E集_成片_第K次`)
    const baseName = episodeRenderBasename(episode.project.name, episode.number, seq);

    const videoKey = buildStorageKey({
      scope: 'project',
      projectId: episode.projectId,
      kind: 'video',
      ext: 'mp4',
    });
    await storage.putObject(videoKey, await readFile(current), {
      contentType: 'video/mp4',
    });
    const videoMedia = await prisma.mediaItem.create({
      data: {
        projectId: episode.projectId,
        scope: 'PROJECT',
        kind: 'VIDEO',
        filename: `${baseName}.mp4`,
        assetCategory: 'VIDEO',
        mimeType: 'video/mp4',
        sizeBytes,
        storageKey: videoKey,
        aspectRatio: episode.project.aspect,
        meta: {
          durationS: finalProbe.durationS,
          width: finalProbe.width,
          height: finalProbe.height,
          renderId,
          groups: files.length,
          burnFallback,
        },
        source: 'AIGC',
        sourceRef: `episode-render:${renderId}`,
      },
      select: { id: true },
    });

    let srtMediaId: string | null = null;
    if (srtContent.trim().length > 0) {
      const srtKey = buildStorageKey({
        scope: 'project',
        projectId: episode.projectId,
        kind: 'other',
        ext: 'srt',
      });
      await storage.putObject(srtKey, Buffer.from('﻿' + srtContent, 'utf8'), {
        contentType: 'application/x-subrip',
      });
      const srtMedia = await prisma.mediaItem.create({
        data: {
          projectId: episode.projectId,
          scope: 'PROJECT',
          kind: 'OTHER',
          filename: `${baseName}.srt`,
          mimeType: 'application/x-subrip',
          sizeBytes: Buffer.byteLength(srtContent, 'utf8'),
          storageKey: srtKey,
          meta: { renderId, cues: segments.reduce((n, s) => n + s.lines.length, 0) },
          source: 'AIGC',
          sourceRef: `episode-render:${renderId}`,
        },
        select: { id: true },
      });
      srtMediaId = srtMedia.id;
    }

    // ---- 8. 标 SUCCESS + 通知 ----
    await prisma.episodeRender.update({
      where: { id: renderId },
      data: {
        status: 'SUCCESS',
        mediaId: videoMedia.id,
        srtMediaId,
        finishedAt: new Date(),
        paramsJson: {
          ...(render.paramsJson as object),
          burnFallback,
          stats: {
            groups: files.length,
            gapsSkipped: timeline.gaps.map((g) => g.number),
            durationS: Math.round(finalProbe.durationS * 10) / 10,
          },
        },
      },
    });

    await notify(prisma, {
      userId: render.createdBy,
      type: 'job_done',
      title: `第${episode.number}集成片完成`,
      body: `${files.length} 段 · ${Math.round(finalProbe.durationS)}s${timeline.gaps.length > 0 ? ` · 跳过缺口 ${timeline.gaps.length} 段` : ''}${burnFallback ? ' · 字幕烧录回退(SRT 可单独下载)' : ''}`,
      payload: { renderId, episodeId: episode.id, mediaId: videoMedia.id },
    });
  } catch (err) {
    const msg = sanitizeErrorMsg(err, 500);
    console.error(`[compose] render ${renderId} failed:`, msg);
    await prisma.episodeRender
      .update({
        where: { id: renderId },
        data: { status: 'FAILED', errorMsg: msg, finishedAt: new Date() },
      })
      .catch((e) => console.error(`[compose] 标 FAILED 失败:`, e));
    await notify(prisma, {
      userId: render.createdBy,
      type: 'job_failed',
      title: `第${episode.number}集成片失败`,
      body: msg,
      payload: { renderId, episodeId: episode.id },
    }).catch((e) => console.error(`[compose] 失败通知发送失败:`, e));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
