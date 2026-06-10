/**
 * Compose Router — 整集成片(M1 · 2026-06-10,蓝图 docs/06 §3 M1)
 *
 * renderEpisode:预检时间线(快速失败给缺口清单)→ 事务内 advisory lock('episode_render')
 *   + stale 清扫 + 防重入 → 建 EpisodeRender(QUEUED)→ 事务提交后 enqueueJob('compose')
 *   (入队失败回标 FAILED,不留幽灵 QUEUED)。
 * timeline:成片 tab 预览(就绪/缺口统计)。listRenders:渲染历史 + 产物签名 URL。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getStorageAdapter } from '@ss/adapters/storage';
import { buildEpisodeTimeline } from '@ss/core/compose';
import { enqueueJob } from '@ss/queue/job-queue';

import { loadEpisodeOrThrow } from '../middleware/access.js';
import { router, protectedProcedure } from '../trpc.js';
import { acquireTxAdvisoryLock } from '../utils/advisory-lock.js';

/** RUNNING/QUEUED 超过该时长视为 stale(worker 崩溃残留),发起新渲染时自动标 FAILED */
const RENDER_STALE_TTL_MS = 30 * 60_000;

/** 产物签名 URL(对齐 media.list 的 previewUrl 语义) */
async function signMediaUrl(media: {
  storageKey: string;
  cdnUrl: string | null;
}): Promise<string | null> {
  if (media.cdnUrl) return media.cdnUrl;
  if (media.storageKey.startsWith('external://')) {
    return media.storageKey.replace(/^external:\/\//, '');
  }
  try {
    return await getStorageAdapter().getSignedUrl(media.storageKey, 3600);
  } catch {
    return null;
  }
}

export const composeRouter = router({
  /** 成片 tab 顶部预览:时间线就绪度(总段/就绪/缺口编号) */
  timeline: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await loadEpisodeOrThrow(ctx, input.episodeId, { skipLockCheck: true });
      const tl = await buildEpisodeTimeline(ctx.prisma, input.episodeId);
      return {
        total: tl.entries.length,
        ready: tl.ready.length,
        gaps: tl.gaps.map((g) => g.number),
      };
    }),

  /** 发起整集成片 */
  renderEpisode: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().cuid(),
        allowGaps: z.boolean().default(false),
        burnSubtitles: z.boolean().default(true),
        bgmMediaId: z.string().cuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const episode = await loadEpisodeOrThrow(ctx, input.episodeId, { skipLockCheck: true });

      // 预检时间线 — 快速失败,把缺口编号给到 UI
      const tl = await buildEpisodeTimeline(ctx.prisma, input.episodeId);
      if (tl.entries.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '本集还没有任何含镜头的生成段,无法成片',
        });
      }
      if (tl.ready.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '所有生成段都没有可用 take(成功且未拒),先去生成视频',
        });
      }
      if (tl.gaps.length > 0 && !input.allowGaps) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `存在缺口段: ${tl.gaps.map((g) => g.number).join(' / ')} — 补齐后重试,或勾选「允许缺口」跳过这些段`,
        });
      }

      // BGM 校验:必须是本项目可见的音频
      if (input.bgmMediaId) {
        const bgm = await ctx.prisma.mediaItem.findFirst({
          where: {
            id: input.bgmMediaId,
            kind: 'AUDIO',
            deletedAt: null,
            OR: [{ projectId: episode.projectId }, { scope: 'PUBLIC' }],
          },
          select: { id: true },
        });
        if (!bgm) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'BGM 音频不存在或不属于本项目' });
        }
      }

      // 事务:episode_render 域串行 + stale 清扫 + 防重入 + 建行
      const render = await ctx.prisma.$transaction(async (tx) => {
        await acquireTxAdvisoryLock(tx, 'episode_render', input.episodeId);

        const staleBefore = new Date(Date.now() - RENDER_STALE_TTL_MS);
        await tx.episodeRender.updateMany({
          where: {
            episodeId: input.episodeId,
            status: { in: ['QUEUED', 'RUNNING'] },
            createdAt: { lt: staleBefore },
          },
          data: {
            status: 'FAILED',
            errorMsg: '渲染超 30 分钟未完成,发起新渲染时自动清理(stale)',
            finishedAt: new Date(),
          },
        });

        const active = await tx.episodeRender.findFirst({
          where: { episodeId: input.episodeId, status: { in: ['QUEUED', 'RUNNING'] } },
          select: { id: true },
        });
        if (active) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: '本集已有进行中的成片任务,等它完成或失败后再发起',
          });
        }

        return tx.episodeRender.create({
          data: {
            episodeId: input.episodeId,
            status: 'QUEUED',
            createdBy: ctx.user.id,
            paramsJson: {
              allowGaps: input.allowGaps,
              burnSubtitles: input.burnSubtitles,
              ...(input.bgmMediaId ? { bgmMediaId: input.bgmMediaId } : {}),
              gapsAtEnqueue: tl.gaps.map((g) => g.number),
            },
          },
          select: { id: true, status: true, createdAt: true },
        });
      });

      // 事务已提交,入队(失败回标,不留幽灵 QUEUED)
      try {
        await enqueueJob(
          'compose',
          { renderId: render.id },
          { jobId: `compose:render:${render.id}` },
        );
      } catch (err) {
        await ctx.prisma.episodeRender.update({
          where: { id: render.id },
          data: {
            status: 'FAILED',
            errorMsg: `入队失败: ${err instanceof Error ? err.message : String(err)}`,
            finishedAt: new Date(),
          },
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '成片任务入队失败,请稍后重试',
        });
      }

      return render;
    }),

  /** 渲染历史(成片 tab 列表,前端按 QUEUED/RUNNING 条件轮询) */
  listRenders: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid(), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      await loadEpisodeOrThrow(ctx, input.episodeId, { skipLockCheck: true });

      const renders = await ctx.prisma.episodeRender.findMany({
        where: { episodeId: input.episodeId },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
      });

      const mediaIds = renders
        .flatMap((r) => [r.mediaId, r.srtMediaId])
        .filter((id): id is string => !!id);
      const mediaRows = await ctx.prisma.mediaItem.findMany({
        where: { id: { in: mediaIds } },
        select: {
          id: true,
          filename: true,
          sizeBytes: true,
          storageKey: true,
          cdnUrl: true,
          meta: true,
        },
      });
      const mediaById = new Map(mediaRows.map((m) => [m.id, m]));

      return Promise.all(
        renders.map(async (r) => {
          const video = r.mediaId ? mediaById.get(r.mediaId) : undefined;
          const srt = r.srtMediaId ? mediaById.get(r.srtMediaId) : undefined;
          const meta = (video?.meta ?? {}) as { durationS?: number };
          const params = (r.paramsJson ?? {}) as {
            allowGaps?: boolean;
            burnSubtitles?: boolean;
            bgmMediaId?: string;
            burnFallback?: boolean;
            stats?: { groups?: number; gapsSkipped?: string[]; durationS?: number };
          };
          return {
            id: r.id,
            status: r.status,
            errorMsg: r.errorMsg,
            createdAt: r.createdAt,
            startedAt: r.startedAt,
            finishedAt: r.finishedAt,
            params,
            filename: video?.filename ?? null,
            sizeBytes: video?.sizeBytes ?? null,
            durationS: params.stats?.durationS ?? meta.durationS ?? null,
            videoUrl: video ? await signMediaUrl(video) : null,
            srtUrl: srt ? await signMediaUrl(srt) : null,
            srtFilename: srt?.filename ?? null,
          };
        }),
      );
    }),
});
