/**
 * AIGC Router — 视频生成工作台(W5.2)
 *
 * 模块边界:
 *   - 不重新拆生成段:1-8 / 9-18 直接复用 W3 ShotGroup 表
 *   - 不重写剧本 / 提示词:原始剧本 = Scene.content,提示词 = ShotGroup.prompt(由 W3 LLM 生成)
 *   - 资产关联用 W4 AssetUsageBinding 表(已加 shotGroupId + refSlotIdx 字段)
 *   - 视频拼接用 packages/core/storyboard/video.ts 的 compileShotGroupVideoPrompt
 *   - W5.2 不接 Seedance(留 W5.4),只做查询 + 自动匹配 + 自动@ + 预览
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { autoMatchAssets, type MatchableAsset } from '@ss/core/generation';
import {
  autoTagPromptWithReferences,
  compileShotGroupVideoPrompt,
  kindFromUsage,
  type AutoTagBinding,
  type VideoReference,
} from '@ss/core/storyboard';

import { router, protectedProcedure } from '../trpc.js';
import type { Context } from '../context.js';
import { logOperation } from '../middleware/audit.js';

// ---------------------------------------------------------------------------
// 通用访问校验(与 storyboard.ts 一致)
// ---------------------------------------------------------------------------

async function assertProjectAccess(
  ctx: Context,
  projectId: string,
  userId: string,
): Promise<void> {
  const p = await ctx.prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
  });
  if (!p) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '无项目访问权限' });
  }
}

async function loadEpisodeOrThrow(ctx: Context, episodeId: string) {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const ep = await ctx.prisma.episode.findFirst({
    where: { id: episodeId, deletedAt: null },
  });
  if (!ep) throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
  await assertProjectAccess(ctx, ep.projectId, ctx.user.id);
  return ep;
}

async function loadGroupOrThrow(ctx: Context, groupId: string) {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const grp = await ctx.prisma.shotGroup.findFirst({
    where: { id: groupId, deletedAt: null },
    include: { episode: true },
  });
  if (!grp) throw new TRPCError({ code: 'NOT_FOUND', message: '生成段不存在' });
  await assertProjectAccess(ctx, grp.episode.projectId, ctx.user.id);
  return grp;
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

export const aigcRouter = router({
  // ============================== 集数总览(W5.3) ==============================

  /**
   * 列出项目所有集(AIGC 集数工作台首屏)
   * 含生成段进度统计:total_units / completed_units / generated_take_count
   */
  listEpisodes: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, ctx.user.id);

      const episodes = await ctx.prisma.episode.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        orderBy: { number: 'asc' },
        include: {
          _count: {
            select: {
              shotGroups: { where: { deletedAt: null } },
            },
          },
        },
      });

      // 每集的"已生成视频候选"数量(GenerationAttempt action=VIDEO success 的 outputMediaIds 求和)
      // MVP:先返 0,等 W5.4 接 Seedance 后实装
      return episodes.map((e) => ({
        id: e.id,
        number: e.number,
        title: e.title,
        status: e.status,
        totalGroups: e._count.shotGroups,
        completedGroups: 0, // TODO W5.4:已确认 takes 的 group 数
        generatedTakeCount: 0, // TODO W5.4
        publishedAt: e.publishedAt,
        updatedAt: e.updatedAt,
      }));
    }),

  // ============================== 单集工作台 ==============================

  /**
   * 列出某集所有生成段(左侧列表)
   * 含 binding 数量、是否有提示词、是否已自动@
   */
  listGroups: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId);

      const groups = await ctx.prisma.shotGroup.findMany({
        where: { episodeId: ep.id, deletedAt: null },
        orderBy: { positionIdx: 'asc' },
        include: {
          _count: {
            select: {
              shots: { where: { deletedAt: null } },
              bindings: { where: { deletedAt: null } },
            },
          },
        },
      });

      return groups.map((g) => ({
        id: g.id,
        number: g.number, // "1-8" / "9-18"
        positionIdx: g.positionIdx,
        durationS: g.durationS,
        status: g.status,
        publishedAt: g.publishedAt,
        shotCount: g._count.shots,
        bindingCount: g._count.bindings,
        hasPrompt: g.prompt.trim().length > 0,
      }));
    }),

  /**
   * 单生成段详情 — 右侧 4 区显示用
   * 含:shots / 原始剧本(scenes) / bindings(按 refSlotIdx 排序,带 asset + mediaUrl) / 提示词
   */
  getGroupDetail: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);

      // 1. 组内 shots(按 positionIdx 排序)
      const shots = await ctx.prisma.shot.findMany({
        where: { groupId: grp.id, deletedAt: null },
        orderBy: { positionIdx: 'asc' },
        include: {
          scene: {
            select: { id: true, number: true, content: true, timeOfDay: true, location: true, place: true },
          },
        },
      });

      // 2. bindings(按 refSlotIdx 升序,null 排末尾)
      const bindings = await ctx.prisma.assetUsageBinding.findMany({
        where: { shotGroupId: grp.id, deletedAt: null },
        orderBy: [{ refSlotIdx: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        include: {
          asset: {
            select: {
              id: true,
              type: true,
              name: true,
              alias: true,
              description: true,
              prompt: true,
              portraitMediaId: true,
              sceneMainMediaId: true,
              mainMediaId: true,
              voiceMediaId: true,
              maturity: true,
              complianceStatus: true,
            },
          },
        },
      });

      // 3. 收集所有引用的 mediaId 一次性查 MediaItem
      const mediaIds = new Set<string>();
      for (const b of bindings) {
        const a = b.asset;
        for (const id of [a.portraitMediaId, a.sceneMainMediaId, a.mainMediaId, a.voiceMediaId]) {
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

      // 4. 选 mediaUrl 的策略:character → portrait,scene → sceneMain or mainMedia,
      //    prop / 其他 → mainMedia,voice → voiceMedia
      const bindingsWithMedia = bindings.map((b) => {
        const a = b.asset;
        let chosenMediaId: string | null = null;
        if (kindFromUsage(b.usageType) === 'AUDIO') {
          chosenMediaId = a.voiceMediaId;
        } else if (a.type === 'CHARACTER') {
          chosenMediaId = a.portraitMediaId ?? a.mainMediaId;
        } else if (a.type === 'SCENE') {
          chosenMediaId = a.sceneMainMediaId ?? a.mainMediaId;
        } else {
          chosenMediaId = a.mainMediaId;
        }
        const media = chosenMediaId ? mediaMap.get(chosenMediaId) : null;
        return {
          ...b,
          mediaUrl: media?.cdnUrl ?? null,
          kind: kindFromUsage(b.usageType),
        };
      });

      return {
        group: {
          id: grp.id,
          number: grp.number,
          positionIdx: grp.positionIdx,
          durationS: grp.durationS,
          prompt: grp.prompt,
          promptCompiled: grp.promptCompiled,
          status: grp.status,
        },
        shots,
        bindings: bindingsWithMedia,
      };
    }),

  /**
   * 自动匹配 — 把项目资产库扫一遍,对在 ShotGroup.prompt + shots.content 中
   * 出现的资产创建 binding,分配 refSlotIdx(scene→1, characters→2..., props→...,音频另起)
   *
   * 规则:
   *   - 已有 binding(同 assetId+shotGroupId+usageType)→ 跳过,不覆盖
   *   - 新建 binding 时 refSlotIdx 续号(图片类 / 音频类各自一个计数器,基于本 group 现有最大值续接)
   *   - 暂只对 IMAGE 类(scene/character/prop)做自动 — voice 留 W5.4
   */
  autoMatchAssets: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);

      // 1. 取本 group 所有 shots,合并文本扫描
      const shots = await ctx.prisma.shot.findMany({
        where: { groupId: grp.id, deletedAt: null },
        select: { content: true, prompt: true },
      });
      const fullText = [
        grp.prompt,
        ...shots.flatMap((s) => [s.content, s.prompt]),
      ]
        .filter((s) => s && s.trim().length > 0)
        .join('\n');

      if (!fullText) {
        return { created: 0, skipped: 0, matches: [] };
      }

      // 2. 取项目资产(已确认 + 未软删 + IMAGE 类)
      const assets = await ctx.prisma.asset.findMany({
        where: {
          projectId: grp.episode.projectId,
          deletedAt: null,
          type: { in: ['CHARACTER', 'SCENE', 'PROP'] },
        },
        select: { id: true, type: true, name: true, alias: true },
      });

      // 3. 跑 auto-match
      const matchable: MatchableAsset[] = assets.map((a) => ({
        id: a.id,
        type: a.type as 'CHARACTER' | 'SCENE' | 'PROP',
        name: a.name,
        alias: a.alias,
      }));
      const matches = autoMatchAssets(fullText, matchable);

      if (matches.length === 0) {
        return { created: 0, skipped: 0, matches: [] };
      }

      // 4. 已有 bindings 查重(避免重复创建)
      const existing = await ctx.prisma.assetUsageBinding.findMany({
        where: { shotGroupId: grp.id, deletedAt: null },
        select: { assetId: true, usageType: true, refSlotIdx: true },
      });
      const existingKey = new Set(
        existing.map((e) => `${e.assetId}:${e.usageType}`),
      );
      const existingImageSlots = existing
        .filter((e) => !['SOUND_BG', 'SOUND_VOICE', 'THEME'].includes(e.usageType))
        .map((e) => e.refSlotIdx ?? 0);
      const existingAudioSlots = existing
        .filter((e) => ['SOUND_BG', 'SOUND_VOICE', 'THEME'].includes(e.usageType))
        .map((e) => e.refSlotIdx ?? 0);
      let nextImageIdx = Math.max(0, ...existingImageSlots) + 1;
      let nextAudioIdx = Math.max(0, ...existingAudioSlots) + 1;

      // 5. 按 (type=SCENE 优先, 然后 CHARACTER, 然后 PROP) 重排,稳定 refSlotIdx
      const typeOrder: Record<string, number> = { SCENE: 0, CHARACTER: 1, PROP: 2 };
      const sortedMatches = [...matches].sort((a, b) => {
        const ta = typeOrder[a.type] ?? 9;
        const tb = typeOrder[b.type] ?? 9;
        if (ta !== tb) return ta - tb;
        return a.position - b.position;
      });

      const created: Array<{
        bindingId: string;
        assetId: string;
        assetName: string;
        refSlotIdx: number;
      }> = [];
      const skipped: string[] = [];

      for (const m of sortedMatches) {
        const usageType = m.type === 'SCENE' ? 'ENVIRONMENT' : 'APPEAR';
        const key = `${m.assetId}:${usageType}`;
        if (existingKey.has(key)) {
          skipped.push(m.assetName);
          continue;
        }
        const refSlotIdx = nextImageIdx++;
        const binding = await ctx.prisma.assetUsageBinding.create({
          data: {
            assetId: m.assetId,
            projectId: grp.episode.projectId,
            episodeId: grp.episodeId,
            shotGroupId: grp.id,
            usageType,
            refSlotIdx,
            note: `auto-match: ${m.refKind} @${m.matchedTerm}`,
          },
        });
        existingKey.add(key);
        created.push({
          bindingId: binding.id,
          assetId: m.assetId,
          assetName: m.assetName,
          refSlotIdx,
        });
      }

      await logOperation(
        ctx,
        'aigc.autoMatch',
        'shotGroup',
        grp.id,
        null,
        {
          groupNumber: grp.number,
          episodeId: grp.episodeId,
          projectId: grp.episode.projectId,
          createdCount: created.length,
          skippedCount: skipped.length,
        },
      );

      return { created: created.length, skipped: skipped.length, matches: created };
    }),

  /**
   * 自动 @ — 在 ShotGroup.prompt 中给已 binding 的资产插入 @图片N / @音频N token。
   * 保存回 ShotGroup.prompt(用户接下来可编辑)。
   */
  autoTagPrompt: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);

      const bindings = await ctx.prisma.assetUsageBinding.findMany({
        where: { shotGroupId: grp.id, deletedAt: null, refSlotIdx: { not: null } },
        orderBy: { refSlotIdx: 'asc' },
        include: { asset: { select: { name: true, alias: true } } },
      });

      const tagBindings: AutoTagBinding[] = bindings.map((b) => ({
        refSlotIdx: b.refSlotIdx!,
        kind: kindFromUsage(b.usageType),
        name: b.asset.name,
        aliases: b.asset.alias,
      }));

      const tagged = autoTagPromptWithReferences(grp.prompt, tagBindings);

      if (tagged === grp.prompt) {
        return { changed: false, prompt: grp.prompt };
      }

      const updated = await ctx.prisma.shotGroup.update({
        where: { id: grp.id },
        data: { prompt: tagged },
      });

      await logOperation(ctx, 'aigc.autoTag', 'shotGroup', grp.id, { prompt: grp.prompt }, {
        prompt: tagged,
        groupNumber: grp.number,
        episodeId: grp.episodeId,
        projectId: grp.episode.projectId,
      });

      return { changed: true, prompt: updated.prompt };
    }),

  /**
   * 编辑 ShotGroup.prompt — 写 PromptEdit 训练集(target=SHOT_GROUP)
   */
  updateGroupPrompt: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        prompt: z.string().min(1).max(20000),
        diffNote: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);
      if (grp.prompt === input.prompt) {
        return { changed: false, prompt: grp.prompt };
      }
      const updated = await ctx.prisma.$transaction(async (tx) => {
        const u = await tx.shotGroup.update({
          where: { id: grp.id },
          data: { prompt: input.prompt },
        });
        await tx.promptEdit.create({
          data: {
            targetType: 'SHOT_GROUP',
            targetId: grp.id,
            projectId: grp.episode.projectId,
            episodeId: grp.episodeId,
            field: 'prompt',
            before: grp.prompt,
            after: input.prompt,
            diffNote: input.diffNote ?? null,
            userId: ctx.user.id,
          },
        });
        return u;
      });
      return { changed: true, prompt: updated.prompt };
    }),

  /**
   * 预览编译后的 prompt(调 compileShotGroupVideoPrompt)
   * 给 UI 实时显示"送 Seedance 的 prompt 长什么样"+ warnings
   */
  previewCompiledPrompt: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        durationS: z.number().min(1).max(15).optional(),
        aspectRatio: z.string().max(20).optional(),
        extraInstruction: z.string().max(500).optional(),
        extraNegative: z.array(z.string().max(50)).max(20).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);

      // 取 group 风格(project 默认 style)
      const project = await ctx.prisma.project.findUnique({
        where: { id: grp.episode.projectId },
        include: { style: true },
      });

      // 取 bindings + media 给 references
      const bindings = await ctx.prisma.assetUsageBinding.findMany({
        where: { shotGroupId: grp.id, deletedAt: null, refSlotIdx: { not: null } },
        orderBy: { refSlotIdx: 'asc' },
        include: {
          asset: {
            select: {
              id: true,
              name: true,
              type: true,
              portraitMediaId: true,
              sceneMainMediaId: true,
              mainMediaId: true,
              voiceMediaId: true,
            },
          },
        },
      });

      const mediaIds = new Set<string>();
      for (const b of bindings) {
        for (const id of [
          b.asset.portraitMediaId,
          b.asset.sceneMainMediaId,
          b.asset.mainMediaId,
          b.asset.voiceMediaId,
        ]) {
          if (id) mediaIds.add(id);
        }
      }
      const medias =
        mediaIds.size > 0
          ? await ctx.prisma.mediaItem.findMany({
              where: { id: { in: Array.from(mediaIds) } },
              select: { id: true, cdnUrl: true },
            })
          : [];
      const mediaMap = new Map(medias.map((m) => [m.id, m.cdnUrl]));

      const references: VideoReference[] = bindings
        .map((b) => {
          const kind = kindFromUsage(b.usageType);
          let chosen: string | null = null;
          if (kind === 'AUDIO') chosen = b.asset.voiceMediaId;
          else if (b.asset.type === 'CHARACTER')
            chosen = b.asset.portraitMediaId ?? b.asset.mainMediaId;
          else if (b.asset.type === 'SCENE')
            chosen = b.asset.sceneMainMediaId ?? b.asset.mainMediaId;
          else chosen = b.asset.mainMediaId;
          const url = chosen ? mediaMap.get(chosen) : null;
          if (!url) return null; // 缺图就跳过,会进 warnings
          return {
            refSlotIdx: b.refSlotIdx!,
            kind,
            assetId: b.asset.id,
            name: b.asset.name,
            mediaUrl: url,
          };
        })
        .filter((r): r is VideoReference => r !== null);

      const compiled = compileShotGroupVideoPrompt({
        text: grp.prompt,
        durationS: input.durationS ?? grp.durationS,
        references,
        style: project?.style
          ? {
              characterPrompt: project.style.characterPrompt,
              scenePrompt: project.style.scenePrompt,
              propPrompt: project.style.propPrompt,
              forbiddenWords: project.style.forbiddenWords,
            }
          : null,
        aspectRatio: input.aspectRatio,
        extraInstruction: input.extraInstruction,
        extraNegative: input.extraNegative,
      });

      return compiled;
    }),
});
