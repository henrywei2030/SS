/**
 * AIGC Router — W5.2.1 手动 binding(机械拆分 ADR-31,纯搬运)。
 *   listAvailableAssets / bindAssetToGroup / unbindAsset
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { resolveMediaFetchUrl } from '@ss/core/media';

import { protectedProcedure } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';
import { isEpisodeLockedNow } from '../utils/episode-lock.js';
import { acquireTxAdvisoryLock } from '../utils/advisory-lock.js';
import { assertProjectAccess } from '../middleware/access.js';

import { loadGroupOrThrow } from './aigc-shared.js';

export const bindingsProcedures = {
  // ============================== W5.2.1 手动 binding ==============================

  /**
   * 列出项目可关联的资产(给"关联素材"弹窗用)— 已绑到本 group 的标 alreadyBound
   */
  listAvailableAssets: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        type: z.enum(['CHARACTER', 'SCENE', 'PROP', 'STYLE_REFERENCE']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId, { skipLockCheck: true });
      const [assets, bindings] = await Promise.all([
        ctx.prisma.asset.findMany({
          where: {
            projectId: grp.episode.projectId,
            deletedAt: null,
            ...(input.type && { type: input.type }),
          },
          orderBy: [{ type: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            type: true,
            name: true,
            alias: true,
            description: true,
            portraitMediaId: true,
            panoramaMediaId: true,
            threeViewMediaId: true,
            sceneMainMediaId: true,
            mainMediaId: true,
            voiceMediaId: true,
            maturity: true,
            complianceStatus: true,
          },
        }),
        ctx.prisma.assetUsageBinding.findMany({
          where: { shotGroupId: grp.id, deletedAt: null },
          select: { assetId: true },
        }),
      ]);
      const boundSet = new Set(bindings.map((b) => b.assetId));
      // 一次性查所有相关 media,UI 卡片显示缩略
      const mediaIds = new Set<string>();
      for (const a of assets) {
        for (const id of [a.portraitMediaId, a.panoramaMediaId, a.threeViewMediaId, a.sceneMainMediaId, a.mainMediaId, a.voiceMediaId]) {
          if (id) mediaIds.add(id);
        }
      }
      const medias =
        mediaIds.size > 0
          ? await ctx.prisma.mediaItem.findMany({
              where: { id: { in: Array.from(mediaIds) } },
              select: { id: true, cdnUrl: true, storageKey: true },
            })
          : [];
      const mediaMap = new Map(medias.map((m) => [m.id, m]));
      return Promise.all(
        assets.map(async (a) => {
          // 缩略图优先级:人物=形象;场景=360°全景优先(再兜底九宫格/旧主视角/main);道具=main
          const tmId =
            a.portraitMediaId ??
            a.panoramaMediaId ??
            a.threeViewMediaId ??
            a.sceneMainMediaId ??
            a.mainMediaId ??
            null;
          const tm = tmId ? mediaMap.get(tmId) : null;
          // 用 resolveMediaFetchUrl(cdnUrl/外链/签名 storageKey)而非裸 cdnUrl —— 上传图 cdnUrl=null 也能出缩略
          const thumb = tm ? await resolveMediaFetchUrl(tm) : null;
          return {
            id: a.id,
            type: a.type,
            name: a.name,
            alias: a.alias,
            description: a.description,
            maturity: a.maturity,
            complianceStatus: a.complianceStatus,
            thumbnailUrl: thumb ?? null,
            alreadyBound: boundSet.has(a.id),
          };
        }),
      );
    }),

  /**
   * 手动 binding 资产到 group(W5.2.1)— 续 refSlotIdx,跟 autoMatch 用同 advisory lock
   * usageType 默认按 asset.type 推导(CHARACTER→APPEAR / SCENE→ENVIRONMENT / PROP→APPEAR)
   */
  bindAssetToGroup: protectedProcedure
    // 第 20 轮 audit / ADR-27:绑定资产到生成段,影响后续 compileVideoPrompt
    .meta({
      agentTool: {
        description: '绑定一个资产到 ShotGroup,可指定 usageType + refSlotIdx + refKind',
        sideEffects: ['db.create:AssetUsageBinding', 'OperationLog.write'],
        costEstimateCny: 0,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        groupId: z.string().cuid(),
        assetId: z.string().cuid(),
        usageType: z
          .enum([
            'APPEAR',
            'SPEAK',
            'HOLD',
            'WEAR',
            'ENVIRONMENT',
            'BACKGROUND',
            'SOUND_BG',
            'SOUND_VOICE',
            'THEME',
            'REFERENCE',
          ])
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);

      // 校验 asset 属于同项目(防越权)
      const asset = await ctx.prisma.asset.findFirst({
        where: {
          id: input.assetId,
          projectId: grp.episode.projectId,
          deletedAt: null,
        },
        select: { id: true, type: true, name: true },
      });
      if (!asset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '资产不存在或不属于本项目' });
      }

      const usageType =
        input.usageType ??
        (asset.type === 'SCENE' ? 'ENVIRONMENT' : 'APPEAR');

      const binding = await ctx.prisma.$transaction(async (tx) => {
        await acquireTxAdvisoryLock(tx, 'aigc_match', grp.id);

        const existing = await tx.assetUsageBinding.findFirst({
          where: {
            shotGroupId: grp.id,
            assetId: input.assetId,
            usageType,
            deletedAt: null,
          },
        });
        if (existing) {
          // 2026-05-27 audit r12 P0-C2:重复绑定改幂等(跟 unbindAsset 设计一致)
          // 前端 BindAssetDialog 已关闭,如果硬错用户无 retry 入口,UX 卡顿
          return { ...existing, alreadyBound: true } as typeof existing & {
            alreadyBound: boolean;
          };
        }

        // 续 refSlotIdx — IMAGE 类 / AUDIO 类各自一个计数器
        const isAudio = ['SOUND_BG', 'SOUND_VOICE', 'THEME'].includes(usageType);
        const slotPool = await tx.assetUsageBinding.findMany({
          where: {
            shotGroupId: grp.id,
            deletedAt: null,
            usageType: isAudio
              ? { in: ['SOUND_BG', 'SOUND_VOICE', 'THEME'] }
              : { notIn: ['SOUND_BG', 'SOUND_VOICE', 'THEME'] },
          },
          select: { refSlotIdx: true },
        });
        const nextIdx =
          Math.max(0, ...slotPool.map((s) => s.refSlotIdx ?? 0)) + 1;

        return tx.assetUsageBinding.create({
          data: {
            assetId: input.assetId,
            projectId: grp.episode.projectId,
            episodeId: grp.episodeId,
            shotGroupId: grp.id,
            usageType,
            refSlotIdx: nextIdx,
            note: 'manual',
          },
        });
      });

      // 2026-05-27 audit r12 P0-C2:幂等命中时不写 OperationLog(不是真的新增动作)
      if (!('alreadyBound' in binding && binding.alreadyBound)) {
        await logOperation(ctx, 'aigc.bindAsset', 'shotGroup', grp.id, null, {
          bindingId: binding.id,
          assetId: input.assetId,
          assetName: asset.name,
          usageType,
          refSlotIdx: binding.refSlotIdx,
          groupNumber: grp.number,
          projectId: grp.episode.projectId,
        });
      }

      return binding;
    }),

  /**
   * 删除 binding(软删,保留审计)— W1-W5 audit 三轮 L1+L2:加 lock check + 幂等
   */
  unbindAsset: protectedProcedure
    .input(z.object({ bindingId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const binding = await ctx.prisma.assetUsageBinding.findFirst({
        where: { id: input.bindingId, deletedAt: null },
        include: {
          asset: { select: { name: true } },
          episode: {
            select: { id: true, projectId: true, deletedAt: true, status: true, generatingStartedAt: true },
          },
        },
      });
      if (!binding || binding.episode.deletedAt) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'binding 不存在' });
      }
      await assertProjectAccess(ctx, binding.episode.projectId);
      if (isEpisodeLockedNow(binding.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜中,请等导演侧完成后再操作 AIGC 工作台',
        });
      }

      // W1-W5 audit 三轮 L2:幂等 — updateMany 配合 deletedAt:null 守卫,
      // count=0 表示已被另一并发请求软删了,返 200 OK 而不是再写审计
      const result = await ctx.prisma.assetUsageBinding.updateMany({
        where: { id: binding.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) {
        return {
          id: binding.id,
          alreadyUnbound: true,
          shotGroupId: binding.shotGroupId,
        };
      }

      await logOperation(ctx, 'aigc.unbindAsset', 'assetUsageBinding', binding.id, binding, {
        deletedAt: new Date(),
        assetName: binding.asset.name,
        projectId: binding.episode.projectId,
      });

      // 2026-05-27 audit r15:返 shotGroupId 给前端 onSuccess 定向 invalidate({groupId}),防跨 group 污染
      return { id: binding.id, alreadyUnbound: false, shotGroupId: binding.shotGroupId };
    }),
};
