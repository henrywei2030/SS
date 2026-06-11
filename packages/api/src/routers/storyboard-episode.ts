/**
 * Storyboard Router — Episode 组(listEpisodes / setBatchLock / archiveEpisode / getEpisode)。
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
import { pruneOrphanAssetEpisodes } from './episode-cleanup.js';

export const episodeProcedures = {
  // -------- Episode --------

  /** 列出某项目所有集 + 聚合元信息（场数 / 单镜数 / 合并组数） */
  listEpisodes: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const episodes = await ctx.prisma.episode.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        orderBy: { number: 'asc' },
        include: {
          _count: {
            select: {
              scenes: { where: { deletedAt: null } },
            },
          },
          // 拉 shot/group 的 status,用于「分镜已生成 vs 已发布」判断(数据量小,每集数十行 status)
          // 七二 UI-P0(docs/08 §1-3):+sceneId — 历史分镜重生成软删过场行未重建,
          //   纯 _count.scenes(deletedAt:null)会把有 63 镜的集显示成「0 场」(ep1 实测 11 场全软删)。
          //   显示口径改为 max(存活场数, 分镜实际引用的去重场数),反映真实结构。
          shots: { where: { deletedAt: null }, select: { status: true, sceneId: true } },
          shotGroups: { where: { deletedAt: null }, select: { status: true } },
        },
      });
      return episodes.map((e) => ({
        id: e.id,
        number: e.number,
        title: e.title,
        status: e.status,
        publishedAt: e.publishedAt,
        publishedVersion: e.publishedVersion,
        batchLocked: e.batchLocked,
        sceneCount: Math.max(
          e._count.scenes,
          new Set(e.shots.map((s) => s.sceneId).filter(Boolean)).size,
        ),
        shotCount: e.shots.length,
        groupCount: e.shotGroups.length,
        // 2026-06:发布后又改了分镜/组(自动整合 / 重新生成 → 新建的是 DRAFT)→ 标"有未发布改动",
        //   让分集列表从「已发布」回到「分镜已生成」,提示需重新发布同步 AIGC
        hasUnpublishedChanges:
          e.shots.some((s) => s.status !== 'PUBLISHED') ||
          e.shotGroups.some((g) => g.status !== 'PUBLISHED'),
      }));
    }),

  /**
   * 切换集数批量生成锁定 — Phase 1.5.3 精炼 4
   *
   * 锁定后:storyboard.listEligibleForGeneration 不返回本集,
   * "全部集数生成" 会跳过(不影响"当前集生成"按钮)。
   */
  setBatchLock: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().cuid(),
        locked: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId);
      const updated = await ctx.prisma.episode.update({
        where: { id: ep.id },
        data: { batchLocked: input.locked },
      });
      await logOperation(
        ctx,
        input.locked ? 'episode.batch_lock' : 'episode.batch_unlock',
        'episode',
        ep.id,
        { batchLocked: ep.batchLocked },
        { batchLocked: updated.batchLocked },
      );
      return { ok: true, batchLocked: updated.batchLocked };
    }),

  /**
   * 软删整集 — 项目成员级
   *
   * Phase 1.5.3 点追加 1:用户在剧本工坊左栏需要直接删除测试集。
   * 复用 admin.archive 的级联逻辑(scenes/shots/shotGroups/bindings 一并软删),
   * 但允许项目成员调用而非仅 admin。
   *
   * 安全门槛:
   *   - 软锁中的集不允许删(防覆盖正在生成的工作)
   *   - 已发布的集不允许删(防止 AIGC 后续引用悬空)— 可改为 ARCHIVED 状态备份
   */
  archiveEpisode: protectedProcedure
    .meta({
      agentTool: {
        description: '软删整集 + 级联清 scenes/shots/shotGroups/bindings:不可逆,需 confirmDelete',
        sideEffects: [
          'db.update:Episode.deletedAt',
          'db.updateMany:Scene/Shot/ShotGroup/AssetUsageBinding.deletedAt',
          'OperationLog.write',
        ],
        costEstimateCny: 0,
        requireConfirm: true,
      },
    })
    .input(
      z.object({
        episodeId: z.string().cuid(),
        confirmDelete: z.literal(true, {
          errorMap: () => ({ message: '需显式 confirmDelete=true(防误删)' }),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await loadEpisodeOrThrow(ctx, input.episodeId);
      if (before.deletedAt) {
        return { ok: true, alreadyArchived: true };
      }
      if (isEpisodeLockedNow(before)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,无法删除(请等生成完成或解锁后再删)',
        });
      }
      if (before.publishedAt) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            '本集已发布,无法直接删除(下游 AIGC 可能引用)。需先在 admin 后台强制归档。',
        });
      }
      const now = new Date();
      await ctx.prisma.$transaction([
        ctx.prisma.episode.update({
          where: { id: before.id },
          data: { deletedAt: now, status: 'ARCHIVED' },
        }),
        ctx.prisma.scene.updateMany({
          where: { episodeId: before.id, deletedAt: null },
          data: { deletedAt: now },
        }),
        ctx.prisma.shot.updateMany({
          where: { episodeId: before.id, deletedAt: null },
          data: { deletedAt: now },
        }),
        ctx.prisma.shotGroup.updateMany({
          where: { episodeId: before.id, deletedAt: null },
          data: { deletedAt: now },
        }),
        ctx.prisma.assetUsageBinding.updateMany({
          where: { episodeId: before.id, deletedAt: null },
          data: { deletedAt: now },
        }),
        // 七二第六波(根治「99集」幽灵):此前 archiveEpisode 漏删 script,留下 active script→deleted
        //   episode 孤儿,在剧本拆解列表显示为幽灵集。补齐脚本级联软删(与 deleteAllForProject 对齐)。
        ctx.prisma.script.updateMany({
          where: { episodeId: before.id, deletedAt: null },
          data: { deletedAt: now, isCurrent: false },
        }),
      ]);
      // 七二第六波:删集后修剪各资产 episodes[] 的孤儿集号(根治「99集」幽灵)
      const prunedAssets = await pruneOrphanAssetEpisodes(ctx.prisma, before.projectId);
      await logOperation(ctx, 'episode.archive', 'episode', before.id, before, {
        deletedAt: now,
        projectId: before.projectId,
        prunedAssets,
      });
      return { ok: true, alreadyArchived: false };
    }),

  getEpisode: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId);
      const [scenes, shots, groups] = await Promise.all([
        ctx.prisma.scene.findMany({
          where: { episodeId: ep.id, deletedAt: null },
          orderBy: { positionIdx: 'asc' },
        }),
        ctx.prisma.shot.findMany({
          where: { episodeId: ep.id, deletedAt: null },
          orderBy: { positionIdx: 'asc' },
        }),
        ctx.prisma.shotGroup.findMany({
          where: { episodeId: ep.id, deletedAt: null },
          orderBy: { positionIdx: 'asc' },
        }),
      ]);
      return { episode: ep, scenes, shots, groups };
    }),
};
