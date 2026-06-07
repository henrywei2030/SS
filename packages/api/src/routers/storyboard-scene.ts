/**
 * Storyboard Router — Scene 组(listScenes / deleteScene)。
 *
 * 机械重构(ADR-31):从 storyboard.ts 按逻辑组拆出,纯搬运无行为变化。
 *   共用 helper / schema / 常量见 storyboard-shared.ts。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { protectedProcedure } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';
import { isEpisodeLockedNow } from '../utils/episode-lock.js';

// W7+ audit R10:assertProjectAccess 抽到 middleware/access.ts
import { assertProjectAccess } from '../middleware/access.js';

import { loadEpisodeOrThrow } from './storyboard-shared.js';

export const sceneProcedures = {
  // -------- Scene --------

  listScenes: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await loadEpisodeOrThrow(ctx, input.episodeId);
      return ctx.prisma.scene.findMany({
        where: { episodeId: input.episodeId, deletedAt: null },
        orderBy: { positionIdx: 'asc' },
      });
    }),

  /**
   * 软删 Scene — W1-W5 audit P2 followup(P2-1):级联清 shots + shot groups + bindings
   * 防止 binding/shot 悬空指向已删 scene。事务内一次性完成,任一步失败回滚。
   */
  deleteScene: protectedProcedure
    .input(z.object({ sceneId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const scene = await ctx.prisma.scene.findFirst({
        where: { id: input.sceneId, deletedAt: null },
        include: {
          episode: {
            select: { id: true, projectId: true, status: true, generatingStartedAt: true },
          },
        },
      });
      if (!scene || !scene.episode) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '场不存在' });
      }
      await assertProjectAccess(ctx, scene.episode.projectId);
      if (isEpisodeLockedNow(scene.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,请等导演侧完成后再删除场',
        });
      }
      const now = new Date();
      await ctx.prisma.$transaction([
        ctx.prisma.scene.update({
          where: { id: input.sceneId },
          data: { deletedAt: now },
        }),
        // 级联软删本场所有 shots
        ctx.prisma.shot.updateMany({
          where: { sceneId: input.sceneId, deletedAt: null },
          data: { deletedAt: now },
        }),
        // 级联软删指向本场的 binding(P2-1 修复点)
        ctx.prisma.assetUsageBinding.updateMany({
          where: { sceneId: input.sceneId, deletedAt: null },
          data: { deletedAt: now },
        }),
      ]);
      await logOperation(
        ctx,
        'scene.delete',
        'scene',
        input.sceneId,
        { ...scene, projectId: scene.episode.projectId },
        null,
      );
      return { ok: true };
    }),
};
