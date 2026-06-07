/**
 * Asset Router · 出场绑定 + 缺口/审计 + 锁定组
 *
 * P2(ADR-31):从 asset.ts(god 路由)按组拆出的 sibling。纯搬运,无行为变化。
 * helper / schema / 常量见 ./asset-shared.ts;在 asset.ts 里 spread 回 assetRouter。
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure } from "../trpc.js";
import { logOperation } from "../middleware/audit.js";
import { assertProjectAccess, loadEpisodeOrThrow } from "../middleware/access.js";
import { loadAssetWithAccess, UsageTypeSchema } from "./asset-shared.js";

export const bindingsProcedures = {
  // -------- 出场绑定 (AssetUsageBinding) --------

  /** 列出某资产的所有出场绑定(group by episode 便于前端展示卡片底部 1-1, 2-1, 14-2) */
  listBindings: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      return ctx.prisma.assetUsageBinding.findMany({
        where: { assetId: asset.id, deletedAt: null },
        include: {
          episode: { select: { id: true, number: true, title: true } },
          scene: { select: { id: true, number: true, place: true } },
          shot: { select: { id: true, number: true, positionIdx: true } },
        },
        orderBy: [{ episode: { number: 'asc' } }, { createdAt: 'asc' }],
      });
    }),


  /**
   * W6 polish:批量列出多个资产的出场绑定,按 assetId group 返回
   *
   * 修复 N+1:art-workspace 资产列表里每张 AssetCard 原来各调 listBindings,
   * 50 张资产 = 50 次 query。现父级批量查一次,返回 { assetId → bindings[] }。
   */
  listBindingsByAssetIds: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        assetIds: z.array(z.string().cuid()).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
      if (input.assetIds.length === 0) return {} as Record<string, never>;
      await assertProjectAccess(ctx, input.projectId);

      const bindings = await ctx.prisma.assetUsageBinding.findMany({
        where: {
          assetId: { in: input.assetIds },
          deletedAt: null,
          asset: { projectId: input.projectId, deletedAt: null },
        },
        include: {
          episode: { select: { id: true, number: true, title: true } },
          scene: { select: { id: true, number: true, place: true } },
          shot: { select: { id: true, number: true, positionIdx: true } },
        },
        orderBy: [{ episode: { number: 'asc' } }, { createdAt: 'asc' }],
      });

      const grouped: Record<string, typeof bindings> = {};
      for (const b of bindings) {
        const list = grouped[b.assetId] ?? [];
        list.push(b);
        grouped[b.assetId] = list;
      }
      return grouped;
    }),


  /**
   * 按 shotId 列出 binding(W1-W5 audit P1 followup P1-8)
   *
   * AIGC 工作台跑 group 级查询,但导演侧编辑单镜时(原 W3 ShotAssetRef 兼容路径)
   * 需要按 shotId 查 binding。当前 binding 已有 shotId 字段(W4-MM 加),只是没暴露查询端点。
   */
  listShotBindings: protectedProcedure
    .input(z.object({ shotId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const shot = await ctx.prisma.shot.findFirst({
        where: { id: input.shotId, deletedAt: null },
        select: { id: true, episodeId: true, episode: { select: { projectId: true } } },
      });
      if (!shot || !shot.episode) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '分镜不存在' });
      }
      await assertProjectAccess(ctx, shot.episode.projectId);
      return ctx.prisma.assetUsageBinding.findMany({
        where: { shotId: input.shotId, deletedAt: null },
        include: {
          asset: {
            select: {
              id: true,
              type: true,
              name: true,
              alias: true,
              maturity: true,
              complianceStatus: true,
              portraitMediaId: true,
              sceneMainMediaId: true,
              mainMediaId: true,
            },
          },
        },
        orderBy: [{ createdAt: 'asc' }],
      });
    }),


  /** 列出本集所有用到的资产(给"按集补充"或"集详情资产卡"用) */
  listEpisodeAssets: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId, { skipLockCheck: true });

      const bindings = await ctx.prisma.assetUsageBinding.findMany({
        where: { episodeId: ep.id, deletedAt: null },
        include: {
          asset: true,
          scene: { select: { id: true, number: true } },
          shot: { select: { id: true, number: true } },
        },
      });
      return bindings;
    }),


  /** 新建出场绑定 */
  bindUsage: protectedProcedure
    .input(
      z.object({
        assetId: z.string().cuid(),
        episodeId: z.string().cuid(),
        sceneId: z.string().cuid().optional(),
        shotId: z.string().cuid().optional(),
        usageType: UsageTypeSchema.default('APPEAR'),
        required: z.boolean().default(true),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      const ep = await ctx.prisma.episode.findFirst({
        where: { id: input.episodeId, projectId: asset.projectId, deletedAt: null },
      });
      if (!ep) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '集不存在或不属于本项目',
        });
      }

      // 用 findFirst + 条件 create/update 替代 upsert
      // (Prisma 不允许 composite unique 含 null 字段的 upsert.where)
      const existing = await ctx.prisma.assetUsageBinding.findFirst({
        where: {
          assetId: input.assetId,
          episodeId: input.episodeId,
          sceneId: input.sceneId ?? null,
          shotId: input.shotId ?? null,
          usageType: input.usageType,
        },
      });

      // 并发兜底:即使 findFirst 没查到,两个并发请求都走 create 分支也会撞 unique。
      // 抓 P2002 → 回退 update 走完。
      let binding;
      if (existing) {
        binding = await ctx.prisma.assetUsageBinding.update({
          where: { id: existing.id },
          data: {
            required: input.required,
            note: input.note,
            deletedAt: null,
          },
        });
      } else {
        try {
          binding = await ctx.prisma.assetUsageBinding.create({
            data: {
              assetId: input.assetId,
              projectId: asset.projectId,
              episodeId: input.episodeId,
              sceneId: input.sceneId,
              shotId: input.shotId,
              usageType: input.usageType,
              required: input.required,
              note: input.note,
            },
          });
        } catch (e) {
          // P2002 — 并发产生,重读后 update
          const dup = await ctx.prisma.assetUsageBinding.findFirst({
            where: {
              assetId: input.assetId,
              episodeId: input.episodeId,
              sceneId: input.sceneId ?? null,
              shotId: input.shotId ?? null,
              usageType: input.usageType,
            },
          });
          if (!dup) throw e;
          binding = await ctx.prisma.assetUsageBinding.update({
            where: { id: dup.id },
            data: {
              required: input.required,
              note: input.note,
              deletedAt: null,
            },
          });
        }
      }
      await logOperation(
        ctx,
        existing ? 'asset.binding.update' : 'asset.binding.create',
        'asset_usage_binding',
        binding.id,
        existing,
        binding,
      );
      return binding;
    }),


  /** 删除出场绑定(软删) */
  unbindUsage: protectedProcedure
    .input(z.object({ bindingId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const binding = await ctx.prisma.assetUsageBinding.findUnique({
        where: { id: input.bindingId },
      });
      if (!binding) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertProjectAccess(ctx, binding.projectId);

      await ctx.prisma.assetUsageBinding.update({
        where: { id: input.bindingId },
        data: { deletedAt: new Date() },
      });
      await logOperation(ctx, 'asset.binding.delete', 'asset_usage_binding', binding.id, binding, null);
      return { ok: true };
    }),


  // -------- 缺口检测(W4-MM.8) --------

  /**
   * 检测某集的资产缺口 — 用于"按集补充"
   *
   * 比对:
   *   - Scene.characters 字段(剧本拆出来的本场角色名)
   *   - Scene.place 字段(场景地点)
   *   vs
   *   - 已建 Asset(同 projectId + 同 name 或 alias 命中)
   *
   * 返回:
   *   - existingCount: 已有资产数
   *   - missingCharacters: 剧本提到但未建的角色名列表
   *   - missingScenes: 剧本提到但未建的场景列表
   *   - sceneCount: 本集场数(供前端显示进度)
   */
  detectGaps: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId, { skipLockCheck: true });

      const scenes = await ctx.prisma.scene.findMany({
        where: { episodeId: ep.id, deletedAt: null },
        orderBy: { positionIdx: 'asc' },
      });

      // 收集本集所有 character / place
      const mentionedCharacters = new Set<string>();
      const mentionedScenes = new Map<string, { number: string; place: string }>();
      for (const sc of scenes) {
        for (const c of sc.characters) {
          const trimmed = c.trim();
          if (trimmed) mentionedCharacters.add(trimmed);
        }
        if (sc.place && sc.place.trim()) {
          mentionedScenes.set(sc.place.trim(), { number: sc.number, place: sc.place });
        }
      }

      // 取本项目已有资产(含 alias 匹配)
      const projectAssets = await ctx.prisma.asset.findMany({
        where: { projectId: ep.projectId, deletedAt: null },
        select: { id: true, type: true, name: true, alias: true, archetypeKey: true },
      });

      // 构建已有名字集合(name + alias + archetypeKey 都算命中)
      const knownNames = new Set<string>();
      for (const a of projectAssets) {
        knownNames.add(a.name.trim());
        if (a.archetypeKey) knownNames.add(a.archetypeKey.trim());
        for (const al of a.alias) knownNames.add(al.trim());
      }

      const missingCharacters = Array.from(mentionedCharacters).filter(
        (c) => !knownNames.has(c),
      );
      const missingScenes = Array.from(mentionedScenes.entries())
        .filter(([place]) => !knownNames.has(place))
        .map(([place, info]) => ({ name: place, sceneNumber: info.number }));

      // 本集已绑定的资产数
      const existingBindings = await ctx.prisma.assetUsageBinding.count({
        where: { episodeId: ep.id, deletedAt: null },
      });

      return {
        episodeId: ep.id,
        episodeNumber: ep.number,
        episodeTitle: ep.title,
        sceneCount: scenes.length,
        existingBindingCount: existingBindings,
        mentionedCharactersCount: mentionedCharacters.size,
        mentionedScenesCount: mentionedScenes.size,
        missingCharacters,
        missingScenes,
      };
    }),


  // -------- 资产-剧集 二次匹配审计(W4-MM.9) --------

  /**
   * 审计本项目的资产-剧集关联完整性,返回三类问题清单
   *
   * (a) noAssetForMentioned:剧本提到但没建资产(全项目维度)
   * (b) noBindingAssets:资产建了但 0 个 binding(可能是被遗忘了)
   * (c) danglingBindings:binding 指向已 soft-deleted 的 scene/shot/asset(数据脏)
   */
  auditProject: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      // (a) 只查本项目下的 scene(经 episode.projectId 过滤,DB 层完成,避免拉全表 + 跨租户信息泄漏)
      const projectScenes = await ctx.prisma.scene.findMany({
        where: {
          episode: { projectId: input.projectId },
          deletedAt: null,
        },
        include: { episode: { select: { id: true, number: true } } },
      });

      const allMentionedChars = new Set<string>();
      const allMentionedScenes = new Map<string, { episodeNumber: number; sceneNumber: string }>();
      for (const sc of projectScenes) {
        for (const c of sc.characters) {
          if (c.trim()) allMentionedChars.add(c.trim());
        }
        if (sc.place?.trim()) {
          allMentionedScenes.set(sc.place.trim(), {
            episodeNumber: sc.episode.number,
            sceneNumber: sc.number,
          });
        }
      }

      const allAssets = await ctx.prisma.asset.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        include: { usageBindings: { where: { deletedAt: null } } },
      });
      const knownNames = new Set<string>();
      for (const a of allAssets) {
        knownNames.add(a.name.trim());
        if (a.archetypeKey) knownNames.add(a.archetypeKey.trim());
        for (const al of a.alias) knownNames.add(al.trim());
      }
      const noAssetForMentioned = {
        characters: Array.from(allMentionedChars).filter((c) => !knownNames.has(c)),
        scenes: Array.from(allMentionedScenes.entries())
          .filter(([place]) => !knownNames.has(place))
          .map(([place, info]) => ({ name: place, ...info })),
      };

      // (b) 资产 0 binding
      const noBindingAssets = allAssets
        .filter((a) => a.usageBindings.length === 0)
        .map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          archetypeKey: a.archetypeKey,
        }));

      // (c) 悬空 binding — 指向已 soft-deleted 的 scene/shot/asset
      const allBindings = await ctx.prisma.assetUsageBinding.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        include: {
          asset: { select: { id: true, name: true, deletedAt: true } },
          scene: { select: { id: true, number: true, deletedAt: true } },
          shot: { select: { id: true, number: true, deletedAt: true } },
        },
      });
      const danglingBindings = allBindings
        .filter(
          (b) =>
            (b.asset && b.asset.deletedAt) ||
            (b.scene && b.scene.deletedAt) ||
            (b.shot && b.shot.deletedAt),
        )
        .map((b) => ({
          id: b.id,
          assetName: b.asset?.name ?? '(已删)',
          reason: b.asset?.deletedAt
            ? 'asset 已软删'
            : b.scene?.deletedAt
              ? 'scene 已软删'
              : 'shot 已软删',
        }));

      return {
        noAssetForMentioned,
        noBindingAssets,
        danglingBindings,
        summary: {
          missingCharCount: noAssetForMentioned.characters.length,
          missingSceneCount: noAssetForMentioned.scenes.length,
          unboundCount: noBindingAssets.length,
          danglingCount: danglingBindings.length,
        },
      };
    }),


  // -------- 锁定 / 解锁 --------

  lockAsset: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      if (asset.lockedAt) return { ok: true, alreadyLocked: true };
      await ctx.prisma.asset.update({
        where: { id: input.assetId },
        data: { lockedAt: new Date() },
      });
      await logOperation(ctx, 'asset.lock', 'asset', asset.id, asset, {
        lockedAt: new Date(),
        projectId: asset.projectId,
      });
      return { ok: true };
    }),


  unlockAsset: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      if (!asset.lockedAt) return { ok: true, alreadyUnlocked: true };
      await ctx.prisma.asset.update({
        where: { id: input.assetId },
        data: { lockedAt: null },
      });
      await logOperation(ctx, 'asset.unlock', 'asset', asset.id, asset, {
        lockedAt: null,
        projectId: asset.projectId,
      });
      return { ok: true };
    }),

};
