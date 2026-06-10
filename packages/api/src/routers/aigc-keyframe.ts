/**
 * AIGC Router — M3a 关键帧先行 + M3b 场内尾帧链(六八,蓝图 docs/06 §M3)。
 *
 * 关键帧先行(animatic 流):每组先用图片模型出首帧候选(便宜、可审、可重抽),确认后写
 * 组首 shot.startFrameMediaId(ADR-23 预留字段,0 migration)→ generateVideo 作首帧约束
 * 烧视频钱。生成 N 组关键帧时自动以 N-1 组已确认关键帧 + 绑定资产形象图作 img2img 参考,
 * 一致性在图层先收敛。
 *
 * 尾帧链(scene-aware):本组最新未拒成功 take → ffmpeg 抽尾帧 → 写下一组首帧;
 * 组首 shot.sceneId 不同(切场)自动拒绝断链 — 跨场各自用关键帧锚定。
 */
import { mkdtempSync, rmSync, createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getImageProvider } from '@ss/adapters/provider';
import { getStorageAdapter, buildStorageKey } from '@ss/adapters/storage';
import {
  extractFrame,
  keyframeFilename,
  resolveMediaFetchUrl,
  tailFrameFilename,
} from '@ss/core/media';
import { compileVideoPromptForGroup } from '@ss/core/video-generation';
import { sanitizeErrorMsg, billingCycle } from '@ss/shared';

import { protectedProcedure } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';
import { loadSystemSettings } from '../utils/system-bindings.js';

import { loadGroupOrThrow } from './aigc-shared.js';

/** 组首 shot(positionIdx 最小)— 关键帧/首帧约束的落点 */
async function loadFirstShot(
  prisma: Parameters<typeof compileVideoPromptForGroup>[0],
  groupId: string,
): Promise<{ id: string; sceneId: string | null; startFrameMediaId: string | null } | null> {
  return prisma.shot.findFirst({
    where: { groupId, deletedAt: null },
    orderBy: { positionIdx: 'asc' },
    select: { id: true, sceneId: true, startFrameMediaId: true },
  });
}

export const keyframeProcedures = {
  /**
   * 关键帧总览:候选 attempts(action=IMAGE × 本组)+ 已确认首帧 + URL map。
   */
  listKeyframes: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId, { skipLockCheck: true });
      const [attempts, firstShot] = await Promise.all([
        ctx.prisma.generationAttempt.findMany({
          where: { shotGroupId: grp.id, action: 'IMAGE' },
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: {
            id: true,
            status: true,
            createdAt: true,
            costCny: true,
            outputMediaIds: true,
          },
        }),
        loadFirstShot(ctx.prisma, grp.id),
      ]);

      const mediaIds = new Set<string>();
      for (const a of attempts) for (const id of a.outputMediaIds) mediaIds.add(id);
      if (firstShot?.startFrameMediaId) mediaIds.add(firstShot.startFrameMediaId);
      const medias =
        mediaIds.size > 0
          ? await ctx.prisma.mediaItem.findMany({
              where: { id: { in: Array.from(mediaIds) }, deletedAt: null },
              select: { id: true, cdnUrl: true, storageKey: true },
            })
          : [];
      const urlMap: Record<string, string> = {};
      for (const m of medias) {
        const u = await resolveMediaFetchUrl(m);
        if (u) urlMap[m.id] = u;
      }

      return {
        attempts: attempts.map((a) => ({
          id: a.id,
          status: a.status,
          createdAt: a.createdAt,
          costCny: String(a.costCny),
          mediaIds: a.outputMediaIds,
        })),
        urlMap,
        firstShotId: firstShot?.id ?? null,
        confirmedMediaId: firstShot?.startFrameMediaId ?? null,
      };
    }),

  /**
   * 生成关键帧候选 — 用已编译组提示词走图片 binding(默认 seedream,可 modelId 覆盖)。
   * 一致性参考(蓝图四层 §1):N-1 组已确认关键帧 + 本组绑定资产形象图(token 引用的)。
   */
  generateKeyframe: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        modelId: z.string().max(100).optional(),
        count: z.number().int().min(1).max(4).default(1),
        extraInstruction: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);
      if (!grp.prompt.trim()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '提示词为空 — 去导演工作台生成或手编后再出关键帧',
        });
      }

      const settings = await loadSystemSettings(ctx.prisma, [
        'binding.asset.image.providerId',
        'shot.video.defaultAspectRatio',
      ]);
      const providerId = input.modelId ?? settings['binding.asset.image.providerId'] ?? '';
      if (!providerId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            '关键帧生成未配置 Image Provider — 去 /admin/bindings 选 binding.asset.image.providerId(或传 modelId)',
        });
      }
      const aspectRatio = settings['shot.video.defaultAspectRatio'] ?? '9:16';

      // 组提示词编译(复用视频同一真相源);关键帧是静帧 → 用 parts 重组,去掉时长参数段
      const { compiled } = await compileVideoPromptForGroup(ctx.prisma, {
        group: {
          id: grp.id,
          prompt: grp.prompt,
          durationS: grp.durationS,
          episode: { projectId: grp.episode.projectId },
        },
        providerId: '',
        durationS: grp.durationS,
        aspectRatio,
      });
      const prompt = [
        compiled.parts.stylePart,
        compiled.parts.textPart,
        '【关键帧】输出一张静帧:取本组第一镜的开场瞬间,构图完整稳定,人物姿态与场景与描述一致,无字幕无水印',
        (input.extraInstruction ?? '').trim(),
      ]
        .filter((s) => s.length > 0)
        .join('\n');

      // img2img 参考:N-1 组已确认关键帧(链式收敛)+ 本组 token 引用的资产图
      const refUrls: string[] = [];
      const prevGroup = await ctx.prisma.shotGroup.findFirst({
        where: {
          episodeId: grp.episodeId,
          deletedAt: null,
          positionIdx: { lt: grp.positionIdx },
        },
        orderBy: { positionIdx: 'desc' },
        select: { id: true },
      });
      if (prevGroup) {
        const prevFirst = await loadFirstShot(ctx.prisma, prevGroup.id);
        if (prevFirst?.startFrameMediaId) {
          const m = await ctx.prisma.mediaItem.findFirst({
            where: { id: prevFirst.startFrameMediaId, deletedAt: null },
            select: { cdnUrl: true, storageKey: true },
          });
          const u = m ? await resolveMediaFetchUrl(m) : null;
          if (u) refUrls.push(u);
        }
      }
      for (const r of compiled.references) {
        if (r.kind === 'IMAGE' && r.mediaUrl) refUrls.push(r.mediaUrl);
      }
      const refImageUrls = Array.from(new Set(refUrls)).slice(0, 9);

      // 生成(失败也留 attempt + ledger,口径同 asset.generateImage)
      const startedAt = new Date();
      let imageResult;
      try {
        const provider = await getImageProvider(providerId);
        imageResult = await provider.generate(
          {
            prompt,
            count: input.count,
            aspectRatio,
            mode: 'standard',
            ...(refImageUrls.length > 0 ? { refImageUrls } : {}),
          },
          {
            userId: ctx.user.id,
            projectId: grp.episode.projectId,
            skipLedger: true,
          },
        );
      } catch (e) {
        console.error('[aigc.generateKeyframe] provider failed (raw):', e);
        const errMsg = sanitizeErrorMsg(e);
        const failedAt = new Date();
        const failed = await ctx.prisma.generationAttempt.create({
          data: {
            projectId: grp.episode.projectId,
            episodeId: grp.episodeId,
            shotGroupId: grp.id,
            providerId,
            modelId: input.modelId ?? providerId,
            action: 'IMAGE',
            inputJson: { kind: 'aigc.generateKeyframe', groupNumber: grp.number },
            errorMsg: errMsg,
            status: 'FAILED',
            startedAt,
            finishedAt: failedAt,
            durationMs: failedAt.getTime() - startedAt.getTime(),
            createdBy: ctx.user.id,
            unitPriceCny: '0',
            costCny: '0',
          },
        });
        await ctx.prisma.costLedgerEntry.create({
          data: {
            userId: ctx.user.id,
            projectId: grp.episode.projectId,
            attemptId: failed.id,
            providerId,
            modelId: input.modelId ?? providerId,
            action: 'keyframe.generate',
            inputUnits: 0,
            outputUnits: 0,
            unitPriceCny: '0',
            costCny: '0',
            success: false,
            billingCycle: billingCycle(),
          },
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `关键帧生成失败: ${errMsg}`,
          cause: e,
        });
      }
      const finishedAt = new Date();
      const realUnitPriceCny =
        imageResult.imageUrls.length > 0
          ? (imageResult.costCny / imageResult.imageUrls.length).toFixed(6)
          : '0';
      const project = await ctx.prisma.project.findUnique({
        where: { id: grp.episode.projectId },
        select: { name: true },
      });

      const { mediaIds, attemptId } = await ctx.prisma.$transaction(async (tx) => {
        const createdMedias = await Promise.all(
          imageResult.imageUrls.map((url, i) =>
            tx.mediaItem.create({
              data: {
                projectId: grp.episode.projectId,
                scope: 'PROJECT',
                kind: 'IMAGE',
                filename: keyframeFilename(
                  project?.name,
                  grp.episode.number ?? null,
                  grp.number,
                  startedAt,
                  i,
                ),
                mimeType: 'image/png',
                sizeBytes: 0,
                storageKey: url.startsWith('http')
                  ? `external://${url}`
                  : url,
                cdnUrl: url,
                aspectRatio,
                viewKind: 'keyframe',
                meta: {
                  kind: 'keyframe',
                  groupNumber: grp.number,
                  prompt,
                  providerId,
                  refCount: refImageUrls.length,
                },
                source: 'AIGC',
                sourceRef: `keyframe:${grp.id}`,
              },
              select: { id: true },
            }),
          ),
        );
        const ids = createdMedias.map((m) => m.id);
        const attemptRow = await tx.generationAttempt.create({
          data: {
            projectId: grp.episode.projectId,
            episodeId: grp.episodeId,
            shotGroupId: grp.id,
            providerId,
            modelId: input.modelId ?? providerId,
            action: 'IMAGE',
            inputJson: {
              kind: 'aigc.generateKeyframe',
              groupNumber: grp.number,
              refCount: refImageUrls.length,
              promptLength: prompt.length,
            },
            outputMediaId: ids[0],
            outputMediaIds: ids,
            inputUnits: 0,
            outputUnits: imageResult.imageUrls.length,
            unitPriceCny: realUnitPriceCny,
            costCny: imageResult.costCny.toFixed(4),
            status: 'SUCCESS',
            startedAt,
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            createdBy: ctx.user.id,
          },
        });
        await tx.costLedgerEntry.create({
          data: {
            userId: ctx.user.id,
            projectId: grp.episode.projectId,
            attemptId: attemptRow.id,
            providerId,
            modelId: input.modelId ?? providerId,
            action: 'keyframe.generate',
            inputUnits: 0,
            outputUnits: imageResult.imageUrls.length,
            unitPriceCny: realUnitPriceCny,
            costCny: imageResult.costCny.toFixed(4),
            success: true,
            billingCycle: billingCycle(),
          },
        });
        return { mediaIds: ids, attemptId: attemptRow.id };
      });

      await logOperation(ctx, 'aigc.generateKeyframe', 'shotGroup', grp.id, null, {
        groupNumber: grp.number,
        episodeId: grp.episodeId,
        projectId: grp.episode.projectId,
        providerId,
        count: mediaIds.length,
        refCount: refImageUrls.length,
        cost: imageResult.costCny,
        usedPrevKeyframe: !!prevGroup && refUrls.length > compiled.references.filter((r) => r.kind === 'IMAGE' && r.mediaUrl).length,
      });

      return {
        attemptId,
        mediaIds,
        cost: imageResult.costCny,
        providerId,
        refCount: refImageUrls.length,
      };
    }),

  /**
   * 确认/清除关键帧 → 组首 shot.startFrameMediaId(generateVideo 读它作首帧约束)。
   */
  confirmKeyframe: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        mediaId: z.string().cuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);
      const firstShot = await loadFirstShot(ctx.prisma, grp.id);
      if (!firstShot) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '本组没有分镜,无法设置首帧' });
      }
      if (input.mediaId) {
        const media = await ctx.prisma.mediaItem.findFirst({
          where: {
            id: input.mediaId,
            deletedAt: null,
            kind: 'IMAGE',
            projectId: grp.episode.projectId,
          },
          select: { id: true },
        });
        if (!media) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '媒体不存在或不是本项目的图片' });
        }
      }
      await ctx.prisma.shot.update({
        where: { id: firstShot.id },
        data: { startFrameMediaId: input.mediaId },
      });
      await logOperation(ctx, 'aigc.confirmKeyframe', 'shotGroup', grp.id, {
        startFrameMediaId: firstShot.startFrameMediaId,
      }, {
        startFrameMediaId: input.mediaId,
        groupNumber: grp.number,
        episodeId: grp.episodeId,
        projectId: grp.episode.projectId,
      });
      return { firstShotId: firstShot.id, mediaId: input.mediaId };
    }),

  /**
   * M3b 尾帧链:本组最新未拒成功 take → ffmpeg 抽尾帧 → 写下一组首帧。
   * 同场景校验:组首 shot.sceneId 不同 = 切场 → 拒绝(跨场各自用关键帧锚定)。
   */
  chainTailFrame: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);
      const nextGroup = await ctx.prisma.shotGroup.findFirst({
        where: {
          episodeId: grp.episodeId,
          deletedAt: null,
          positionIdx: { gt: grp.positionIdx },
        },
        orderBy: { positionIdx: 'asc' },
        select: { id: true, number: true },
      });
      if (!nextGroup) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '本组已是最后一组,没有下一组可链' });
      }
      const [curFirst, nextFirst] = await Promise.all([
        loadFirstShot(ctx.prisma, grp.id),
        loadFirstShot(ctx.prisma, nextGroup.id),
      ]);
      if (!nextFirst) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '下一组没有分镜,无法写首帧' });
      }
      // scene-aware 断链:都有 sceneId 且不同 = 切场
      if (curFirst?.sceneId && nextFirst.sceneId && curFirst.sceneId !== nextFirst.sceneId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '下一组切场(场景不同),尾帧链不适用 — 跨场景请各自生成关键帧锚定',
        });
      }

      // 最新未拒成功 take(口径同 M1 成片 timeline)
      const take = await ctx.prisma.generationAttempt.findFirst({
        where: {
          shotGroupId: grp.id,
          action: 'VIDEO',
          status: 'SUCCESS',
          rejected: false,
          outputMediaId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, outputMediaId: true },
      });
      if (!take?.outputMediaId) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '本组还没有可用的成功 take(或全被拒)— 先抽卡' });
      }
      const videoMedia = await ctx.prisma.mediaItem.findFirst({
        where: { id: take.outputMediaId, deletedAt: null },
        select: { id: true, cdnUrl: true, storageKey: true },
      });
      if (!videoMedia) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'take 视频媒体不存在' });
      }

      const storage = getStorageAdapter();
      const tmp = mkdtempSync(join(tmpdir(), 'ss-tailframe-'));
      try {
        // 下载视频(provider 直链可能过期 → 给可读错误)
        const videoPath = join(tmp, 'take-video');
        const fetchUrl = await resolveMediaFetchUrl(videoMedia);
        if (fetchUrl) {
          const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(120_000) });
          if (!res.ok || !res.body) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'take 视频拉取失败 — provider 直链可能已过期(火山 24h),需重新生成该段',
            });
          }
          await pipeline(Readable.fromWeb(res.body as never), createWriteStream(videoPath));
        } else {
          await pipeline(await storage.getObject(videoMedia.storageKey), createWriteStream(videoPath));
        }

        // 抽尾帧 → 存储 → MediaItem
        const framePath = join(tmp, 'tail.png');
        await extractFrame({ input: videoPath, output: framePath });
        const buf = await readFile(framePath);
        const key = buildStorageKey({
          scope: 'project',
          projectId: grp.episode.projectId,
          kind: 'image',
          ext: 'png',
        });
        await storage.putObject(key, buf, { contentType: 'image/png' });
        const project = await ctx.prisma.project.findUnique({
          where: { id: grp.episode.projectId },
          select: { name: true },
        });
        const frameMedia = await ctx.prisma.mediaItem.create({
          data: {
            projectId: grp.episode.projectId,
            scope: 'PROJECT',
            kind: 'IMAGE',
            filename: tailFrameFilename(project?.name, grp.episode.number ?? null, grp.number),
            mimeType: 'image/png',
            sizeBytes: buf.length,
            storageKey: key,
            viewKind: 'keyframe',
            meta: {
              kind: 'tail-frame-chain',
              fromGroupId: grp.id,
              fromGroupNumber: grp.number,
              fromAttemptId: take.id,
              toGroupId: nextGroup.id,
            },
            source: 'AIGC',
            sourceRef: `tail-frame:${grp.id}`,
          },
          select: { id: true },
        });
        await ctx.prisma.shot.update({
          where: { id: nextFirst.id },
          data: { startFrameMediaId: frameMedia.id },
        });
        await logOperation(ctx, 'aigc.chainTailFrame', 'shotGroup', grp.id, null, {
          groupNumber: grp.number,
          nextGroupId: nextGroup.id,
          nextGroupNumber: nextGroup.number,
          mediaId: frameMedia.id,
          fromAttemptId: take.id,
          episodeId: grp.episodeId,
          projectId: grp.episode.projectId,
        });
        return {
          mediaId: frameMedia.id,
          nextGroupId: nextGroup.id,
          nextGroupNumber: nextGroup.number,
        };
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }),
};
