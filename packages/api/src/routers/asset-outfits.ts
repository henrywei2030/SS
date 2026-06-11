/**
 * Asset Router · 按集造型版本(七二·跨集换装)
 *
 * 同一人物/场景在不同集数更换服装造型 — AssetVersion 每行 = 某资产在某集的槽位覆盖。
 * 编译/取图时(core/video-generation/compile.ts)按 group 所属集查覆盖,非空槽位顶替 Asset 默认;
 * 通用造型 = Asset 自身槽位(本表不存通用行)。
 *
 * P2(ADR-31)同款:作为 asset.ts 的 sibling,procedures spread 回 assetRouter。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { protectedProcedure } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';
import { loadAssetWithAccess } from './asset-shared.js';

/** 造型可覆盖的槽位 — 仅 AssetVersion 上有对应字段的三个(人物形象/三视图 + 场景主视角) */
const OutfitSlotSchema = z.enum(['portrait', 'three_view', 'scene_main']);

/** outfit slot → AssetVersion 字段名(string 类型,与 confirmCandidate 的 SLOT_FIELD 计算键写法一致) */
const OUTFIT_SLOT_FIELD: Record<z.infer<typeof OutfitSlotSchema>, string> = {
  portrait: 'portraitMediaId',
  three_view: 'threeViewMediaId',
  scene_main: 'sceneMainMediaId',
};

export const outfitsProcedures = {
  /** 列出某资产的所有按集造型 + 项目可选集(供前端造型切换器) */
  listOutfits: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      const outfits = await ctx.prisma.assetVersion.findMany({
        where: { assetId: asset.id },
        include: { episode: { select: { id: true, number: true, title: true } } },
        orderBy: { episode: { number: 'asc' } },
      });
      // 槽位 media → 可显示 url
      const mediaIds = new Set<string>();
      for (const o of outfits) {
        for (const id of [o.portraitMediaId, o.threeViewMediaId, o.sceneMainMediaId]) {
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
      const mediaMap = new Map(medias.map((m) => [m.id, m.cdnUrl ?? m.storageKey]));
      const slotOf = (id: string | null): { mediaId: string; url: string | null } | null =>
        id ? { mediaId: id, url: mediaMap.get(id) ?? null } : null;

      // 项目所有集(供切换器列"可设造型的集")
      const episodes = await ctx.prisma.episode.findMany({
        where: { projectId: asset.projectId, deletedAt: null },
        select: { id: true, number: true, title: true },
        orderBy: { number: 'asc' },
      });

      return {
        episodes,
        outfits: outfits.map((o) => ({
          episodeId: o.episodeId,
          episodeNumber: o.episode?.number ?? null,
          episodeTitle: o.episode?.title ?? null,
          label: o.label,
          slots: {
            portrait: slotOf(o.portraitMediaId),
            three_view: slotOf(o.threeViewMediaId),
            scene_main: slotOf(o.sceneMainMediaId),
          },
        })),
      };
    }),

  /** 为某集某槽位设造型图(upsert AssetVersion;UPLOAD/AIGC 同项目即可) */
  setOutfitSlot: protectedProcedure
    .input(
      z.object({
        assetId: z.string().cuid(),
        episodeId: z.string().cuid(),
        slot: OutfitSlotSchema,
        mediaItemId: z.string().cuid(),
        label: z.string().max(60).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);

      // 集必须属于本项目
      const episode = await ctx.prisma.episode.findFirst({
        where: { id: input.episodeId, projectId: asset.projectId, deletedAt: null },
        select: { id: true, number: true },
      });
      if (!episode) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在或不属于本项目' });
      }
      // media 必须属于本项目(与 confirmCandidate 的 UPLOAD 放行口径一致)
      const media = await ctx.prisma.mediaItem.findFirst({
        where: { id: input.mediaItemId, projectId: asset.projectId, deletedAt: null },
        select: { id: true },
      });
      if (!media) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'MediaItem 不存在或不属于本项目' });
      }

      const field = OUTFIT_SLOT_FIELD[input.slot];
      const outfit = await ctx.prisma.assetVersion.upsert({
        where: { assetId_episodeId: { assetId: asset.id, episodeId: input.episodeId } },
        create: {
          assetId: asset.id,
          episodeId: input.episodeId,
          [field]: input.mediaItemId,
          ...(input.label ? { label: input.label } : {}),
        },
        update: {
          [field]: input.mediaItemId,
          ...(input.label ? { label: input.label } : {}),
        },
      });

      await logOperation(ctx, 'asset.outfit.set', 'asset', asset.id, null, {
        episodeId: input.episodeId,
        episodeNumber: episode.number,
        slot: input.slot,
        mediaItemId: input.mediaItemId,
        projectId: asset.projectId,
      });
      return outfit;
    }),

  /** 清除某集某槽位造型(置空;清空后该集三槽全空则删整行,不留空造型) */
  clearOutfitSlot: protectedProcedure
    .input(
      z.object({
        assetId: z.string().cuid(),
        episodeId: z.string().cuid(),
        slot: OutfitSlotSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      const existing = await ctx.prisma.assetVersion.findUnique({
        where: { assetId_episodeId: { assetId: asset.id, episodeId: input.episodeId } },
      });
      if (!existing) return { cleared: false, deletedRow: false };

      const field = OUTFIT_SLOT_FIELD[input.slot];
      // 清空该槽后,其余两槽是否也空 → 决定删行还是置空
      const remaining = {
        portrait: input.slot === 'portrait' ? null : existing.portraitMediaId,
        three_view: input.slot === 'three_view' ? null : existing.threeViewMediaId,
        scene_main: input.slot === 'scene_main' ? null : existing.sceneMainMediaId,
      };
      const allEmpty = !remaining.portrait && !remaining.three_view && !remaining.scene_main;
      if (allEmpty) {
        await ctx.prisma.assetVersion.delete({ where: { id: existing.id } });
      } else {
        await ctx.prisma.assetVersion.update({
          where: { id: existing.id },
          data: { [field]: null },
        });
      }

      await logOperation(ctx, 'asset.outfit.clear', 'asset', asset.id, null, {
        episodeId: input.episodeId,
        slot: input.slot,
        deletedRow: allEmpty,
        projectId: asset.projectId,
      });
      return { cleared: true, deletedRow: allEmpty };
    }),
};
