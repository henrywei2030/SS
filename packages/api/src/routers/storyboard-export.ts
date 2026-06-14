/**
 * Storyboard Router — 导出快照 + 流水线状态(v0.2.0 · 导演链路重构 · 方案丙)。
 *
 * - pipelineStatus:导演四阶段流水线的【单一真相】聚合,替代前端 episodes.every() 推断。
 *   驱动顶部 stepper 进度条、阶段门禁、缺失集提示。
 * - exportScript / listExports:分镜脚本快照(StoryboardExport),阶段 B 补齐。
 *
 * 共用 helper / schema / 常量见 storyboard-shared.ts;分镜脚本文本构建见 asset-shared.loadProjectShootingScript。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { protectedProcedure } from '../trpc.js';
import { assertProjectAccess } from '../middleware/access.js';
import { logOperation } from '../middleware/audit.js';
import { isEpisodeLockedNow } from '../utils/episode-lock.js';
import { loadProjectShootingScript } from './asset-shared.js';

export const exportProcedures = {
  /**
   * 导演流水线状态聚合 — 单一真相。
   * 返回各阶段完成度 + 全集生成门禁(allGenerated / missingEpisodes) + 最新导出快照 + 资产数。
   * allGenerated 口径:所有「有 isCurrent 剧本」的集都已生成分镜(shotCount>0)且无集在生成中(软锁)。
   */
  pipelineStatus: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      const episodes = await ctx.prisma.episode.findMany({
        where: { projectId: input.projectId, deletedAt: null, status: { not: 'ARCHIVED' } },
        orderBy: { number: 'asc' },
        select: {
          id: true,
          number: true,
          status: true,
          generatingStartedAt: true,
          _count: { select: { shots: { where: { deletedAt: null } } } },
          scripts: { where: { isCurrent: true, deletedAt: null }, select: { id: true } },
        },
      });

      const eps = episodes.map((e) => {
        const shotCount = e._count.shots;
        return {
          episodeId: e.id,
          episodeNumber: e.number,
          hasCurrentScript: e.scripts.length > 0,
          shotCount,
          hasShots: shotCount > 0,
          generating: isEpisodeLockedNow(e),
        };
      });

      const withScript = eps.filter((e) => e.hasCurrentScript);
      const generated = withScript.filter((e) => e.hasShots);
      const missingEpisodes = withScript.filter((e) => !e.hasShots).map((e) => e.episodeNumber);
      const anyGenerating = eps.some((e) => e.generating);
      const allGenerated =
        withScript.length > 0 && missingEpisodes.length === 0 && !anyGenerating;

      const [latestExport, assetCount, draftCount] = await Promise.all([
        ctx.prisma.storyboardExport.findFirst({
          where: { projectId: input.projectId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true, episodeNumbers: true, shotCountSnapshot: true, createdAt: true },
        }),
        ctx.prisma.asset.count({ where: { projectId: input.projectId, deletedAt: null } }),
        ctx.prisma.inspirationDraft.count({ where: { projectId: input.projectId, deletedAt: null } }),
      ]);

      return {
        inspiration: { done: draftCount > 0, draftCount },
        script: { done: withScript.length > 0, episodeCount: withScript.length },
        generate: {
          done: allGenerated,
          total: withScript.length,
          generated: generated.length,
          missingEpisodes,
          anyGenerating,
        },
        export: {
          hasSnapshot: latestExport != null,
          latestExportId: latestExport?.id ?? null,
          episodeNumbers: latestExport?.episodeNumbers ?? [],
          shotCountSnapshot: latestExport?.shotCountSnapshot ?? 0,
          createdAt: latestExport?.createdAt ?? null,
        },
        breakdown: { done: assetCount > 0, assetCount },
        episodes: eps,
      };
    }),

  /**
   * 导出分镜脚本快照(v0.2.0 · 阶段 B)。把选中集的分镜(场结构 + 分镜)序列化为结构化文本,
   * 落一条不可变 StoryboardExport 行 —— 作为剧本拆解的输入句柄,同时可下载/留痕。
   * 仅纳入已生成分镜的集;选中集全无分镜则 PRECONDITION_FAILED。
   */
  exportScript: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        episodeNumbers: z.array(z.number().int().positive()).min(1, '请至少选择一集'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const { text, shotCount, episodeNumbers, truncated } = await loadProjectShootingScript(
        ctx,
        input.projectId,
        input.episodeNumbers,
      );
      if (shotCount === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '所选集尚未生成分镜,无法导出分镜脚本 — 请先到分镜工坊生成',
        });
      }
      const exp = await ctx.prisma.storyboardExport.create({
        data: {
          projectId: input.projectId,
          episodeNumbers,
          scriptText: text,
          shotCountSnapshot: shotCount,
          createdById: ctx.user?.id ?? null,
        },
        select: { id: true },
      });
      await logOperation(
        ctx,
        'storyboard.exportScript',
        'project',
        input.projectId,
        { requested: input.episodeNumbers },
        { exportId: exp.id, episodeNumbers, shotCount, truncated },
      );
      return { exportId: exp.id, scriptText: text, shotCount, episodeNumbers, truncated };
    }),

  /** 列出项目的分镜脚本导出快照(供拆解选输入 / 下载 / 历史)。列表不含 scriptText 正文(轻量)。 */
  listExports: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      return ctx.prisma.storyboardExport.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, episodeNumbers: true, shotCountSnapshot: true, createdAt: true },
        take: 50,
      });
    }),
};
