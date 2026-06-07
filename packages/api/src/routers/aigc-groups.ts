/**
 * AIGC Router — W5 完善 G1:ShotGroup CRUD(机械拆分 ADR-31,纯搬运)。
 *   createEmptyGroup / renameGroup / archiveGroup
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { protectedProcedure } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';
import { loadEpisodeOrThrow } from '../middleware/access.js';

import { loadGroupOrThrow } from './aigc-shared.js';

export const groupsProcedures = {
  // ============================== W5 完善 G1:ShotGroup CRUD ==============================
  // "1-8" 只是 W3 mergeShots 自动产出的 label;实际上 group 是灵活组合概念,
  // 用户应能:
  //   - createEmptyGroup:从零建立"陆乘·开场"这种命名 group(还没有 shots,后续手动加)
  //   - renameGroup:把 "1-8" 改成有意义的 label
  //   - archiveGroup:软删 group + 级联软删 bindings(attempts 保留审计)
  // shots 编辑(合并/拆分/移动)仍走 W3 storyboard 工作台,不在 AIGC 模块重做。

  /**
   * 新建空白生成段(W5 完善 G1)— 续 episode 内 positionIdx,label 由用户给
   */
  createEmptyGroup: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().cuid(),
        label: z.string().min(1).max(100), // ShotGroup.number 字段承载 free-form label
        prompt: z.string().max(20000).default(''),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId);
      // W1-W5 audit 三轮 L5:终态 episode(COMPLETED/ARCHIVED)不能再加 group
      if (ep.status === 'COMPLETED' || ep.status === 'ARCHIVED') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `本集状态为 ${ep.status},不能创建生成段(终态)`,
        });
      }

      // 用 advisory lock 防并发抢同一 positionIdx(跟 W3 storyboard 一致)
      const group = await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext('storyboard_group:' || $1)::bigint)`,
          ep.id,
        );
        const last = await tx.shotGroup.findFirst({
          where: { episodeId: ep.id },
          orderBy: { positionIdx: 'desc' },
        });
        const nextIdx = (last?.positionIdx ?? 0) + 1;
        return tx.shotGroup.create({
          data: {
            episodeId: ep.id,
            number: input.label,
            positionIdx: nextIdx,
            durationS: 0,
            prompt: input.prompt,
          },
        });
      });

      await logOperation(ctx, 'aigc.createEmptyGroup', 'shotGroup', group.id, null, {
        episodeId: ep.id,
        projectId: ep.projectId,
        label: input.label,
        positionIdx: group.positionIdx,
      });
      return group;
    }),

  /**
   * 重命名生成段(W5 完善 G1)— ShotGroup.number 是 free-form label,
   * 默认 "X-Y" 由 W3 merge 给,用户可改成"陆乘·开场"之类有意义的名
   */
  renameGroup: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        label: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);
      if (grp.number === input.label) {
        return grp;
      }
      const updated = await ctx.prisma.shotGroup.update({
        where: { id: grp.id },
        data: { number: input.label },
      });
      await logOperation(ctx, 'aigc.renameGroup', 'shotGroup', grp.id, grp, {
        ...updated,
        projectId: grp.episode.projectId,
      });
      return updated;
    }),

  /**
   * 归档生成段(W5 完善 G1)— 软删 group + 级联软删 bindings
   * attempts 保留(审计 + 重新启用时可见历史)
   */
  archiveGroup: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);
      // W1-W5 audit 三轮 L4:有进行中 attempt 时不能归档,防 attempt SUCCESS 回写到死引用
      const inflight = await ctx.prisma.generationAttempt.count({
        where: {
          shotGroupId: grp.id,
          action: 'VIDEO',
          status: { in: ['QUEUED', 'RUNNING'] },
        },
      });
      if (inflight > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `本生成段有 ${inflight} 个进行中的视频任务,等完成或失败后再归档`,
        });
      }
      const now = new Date();
      await ctx.prisma.$transaction([
        ctx.prisma.shotGroup.update({
          where: { id: grp.id },
          data: { deletedAt: now },
        }),
        ctx.prisma.assetUsageBinding.updateMany({
          where: { shotGroupId: grp.id, deletedAt: null },
          data: { deletedAt: now },
        }),
      ]);
      await logOperation(ctx, 'aigc.archiveGroup', 'shotGroup', grp.id, grp, {
        archivedAt: now,
        projectId: grp.episode.projectId,
      });
      return { id: grp.id, archivedAt: now };
    }),
};
