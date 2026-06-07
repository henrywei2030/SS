/**
 * Script Router — 版本查询/切换组(list / listVersions / getById /
 *   setCurrentVersion / lockVersion / unlockVersion)。
 *
 * 机械重构(ADR-31):从 script.ts 按逻辑组拆出,纯搬运无行为变化。
 *   跨组共用 helper 见 script-shared.ts。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { protectedProcedure } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';

// W7+ audit R10:assertProjectAccess 抽到 middleware/access.ts
import { assertProjectAccess, loadEpisodeOrThrow } from '../middleware/access.js';

import { loadScriptWithAccess } from './script-shared.js';

export const versionProcedures = {
  /**
   * 列出某项目所有剧本（当前版本视图）
   *
   * 默认 onlyCurrent=true，即每集只返回 isCurrent=true 那一份。
   * 想拿历史版本切换 UI 用 listVersions。
   */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        onlyCurrent: z.boolean().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      return ctx.prisma.script.findMany({
        where: {
          projectId: input.projectId,
          deletedAt: null,
          ...(input.onlyCurrent ? { isCurrent: true } : {}),
        },
        orderBy: [{ episode: { number: 'asc' } }, { version: 'desc' }],
        include: {
          episode: { select: { id: true, number: true, title: true } },
          analyses: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              overallScore: true,
              createdAt: true,
            },
          },
        },
      });
    }),

  /** 列出某集所有版本（用于版本切换 UI） */
  listVersions: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await loadEpisodeOrThrow(ctx, input.episodeId, { skipLockCheck: true });

      return ctx.prisma.script.findMany({
        where: { episodeId: input.episodeId, deletedAt: null },
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          title: true,
          contentHash: true,
          language: true,
          source: true,
          isCurrent: true,
          lockedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }),

  /** 取指定版本完整内容 — 供剧本视图显示 */
  getById: protectedProcedure
    .input(z.object({ scriptId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return loadScriptWithAccess(ctx, input.scriptId);
    }),

  /**
   * 把指定版本设为当前 — 同 episode 其它版本 isCurrent 全部清空
   */
  setCurrentVersion: protectedProcedure
    .input(z.object({ scriptId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const script = await loadScriptWithAccess(ctx, input.scriptId);
      if (!script.episodeId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '项目级总剧本（无 episodeId）不参与版本切换',
        });
      }

      await ctx.prisma.$transaction([
        ctx.prisma.script.updateMany({
          where: {
            episodeId: script.episodeId,
            isCurrent: true,
            id: { not: script.id },
          },
          data: { isCurrent: false },
        }),
        ctx.prisma.script.update({
          where: { id: script.id },
          data: { isCurrent: true },
        }),
      ]);

      await logOperation(
        ctx,
        'script.version.setCurrent',
        'script',
        script.id,
        null,
        { projectId: script.projectId, episodeId: script.episodeId, version: script.version },
      );
      return { ok: true };
    }),

  /** 锁定版本(只读快照) */
  lockVersion: protectedProcedure
    .input(z.object({ scriptId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const script = await loadScriptWithAccess(ctx, input.scriptId);
      if (script.lockedAt) {
        return { ok: true, alreadyLocked: true };
      }
      await ctx.prisma.script.update({
        where: { id: script.id },
        data: { lockedAt: new Date() },
      });
      await logOperation(
        ctx,
        'script.version.lock',
        'script',
        script.id,
        { lockedAt: null },
        { lockedAt: new Date(), projectId: script.projectId },
      );
      return { ok: true };
    }),

  unlockVersion: protectedProcedure
    .input(z.object({ scriptId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const script = await loadScriptWithAccess(ctx, input.scriptId);
      if (!script.lockedAt) {
        return { ok: true, alreadyUnlocked: true };
      }
      await ctx.prisma.script.update({
        where: { id: script.id },
        data: { lockedAt: null },
      });
      await logOperation(
        ctx,
        'script.version.unlock',
        'script',
        script.id,
        { lockedAt: script.lockedAt },
        { lockedAt: null, projectId: script.projectId },
      );
      return { ok: true };
    }),
};
