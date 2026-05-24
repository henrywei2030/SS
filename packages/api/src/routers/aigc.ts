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

import { getEventBus } from '@ss/adapters/eventbus';
import { getVideoProvider } from '@ss/adapters/provider';
import { Prisma } from '@ss/db';
import { autoMatchAssets, type MatchableAsset } from '@ss/core/generation';
import {
  autoTagPromptWithReferences,
  compileShotGroupVideoPrompt,
  kindFromUsage,
  type AutoTagBinding,
  type VideoReference,
} from '@ss/core/storyboard';
import { EVENTS } from '@ss/shared/events';
import { addVideoGenJob } from '@ss/queue/video-gen';
import { signStreamToken } from '@ss/queue/sse-token';

import { router, protectedProcedure, rateLimit } from '../trpc.js';
import type { Context } from '../context.js';
import { logOperation } from '../middleware/audit.js';
import { isEpisodeLockedNow } from '../utils/episode-lock.js';
import {
  sanitizePromptForLedger,
  sanitizeReferencesForLedger,
} from '../utils/sanitize-prompt.js';

// W5.4:视频生成相关 SystemSetting 读取
// W1-W5 audit P1 followup(P1-5):加 requireForVideo 守卫(原 setting dead,从未被读)
async function getVideoBindings(ctx: Context): Promise<{
  providerId: string;
  maxDurationS: number;
  defaultAspectRatio: '9:16' | '16:9' | '1:1';
  dailyBudgetCny: number;
  requireComplianceForVideo: boolean;
}> {
  const settings = await ctx.prisma.systemSetting.findMany({
    where: {
      key: {
        in: [
          'binding.shot.video.providerId',
          'shot.video.maxDurationS',
          'shot.video.defaultAspectRatio',
          'shot.video.dailyBudgetCny',
          'asset.compliance.requireForVideo',
        ],
      },
    },
  });
  const map = new Map(settings.map((s) => [s.key, s.value]));
  const rawAr = map.get('shot.video.defaultAspectRatio') ?? '9:16';
  const ar: '9:16' | '16:9' | '1:1' =
    rawAr === '16:9' ? '16:9' : rawAr === '1:1' ? '1:1' : '9:16';
  return {
    providerId: map.get('binding.shot.video.providerId') ?? 'seedance-2.0',
    maxDurationS: Number(map.get('shot.video.maxDurationS') ?? '10'),
    defaultAspectRatio: ar,
    dailyBudgetCny: Number(map.get('shot.video.dailyBudgetCny') ?? '500'),
    requireComplianceForVideo:
      (map.get('asset.compliance.requireForVideo') ?? 'false') === 'true',
  };
}

// ---------------------------------------------------------------------------
// 通用访问校验 — 抽到 ../middleware/access.ts(W7+ audit R10)
// ---------------------------------------------------------------------------

import { assertProjectAccess } from '../middleware/access.js';

async function loadEpisodeOrThrow(
  ctx: Context,
  episodeId: string,
  opts: { skipLockCheck?: boolean } = {},
) {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const ep = await ctx.prisma.episode.findFirst({
    where: { id: episodeId, deletedAt: null },
  });
  if (!ep) throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
  await assertProjectAccess(ctx, ep.projectId);
  // W1-W5 audit 三轮 L1:写操作必须先确认 episode 没在 fresh GENERATING
  if (!opts.skipLockCheck && isEpisodeLockedNow(ep)) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: '本集正在生成分镜中,请等导演侧完成后再操作 AIGC 工作台',
    });
  }
  return ep;
}

/**
 * loadGroupOrThrow 选项:
 *   - allowArchived:true 时允许返回 deletedAt!=null 的 group(只读路径用,如 listVideoTakes 历史回溯)
 *   - skipLockCheck:true 时不抛 GENERATING(only for 只读 query;mutation 必须 false)
 */
async function loadGroupOrThrow(
  ctx: Context,
  groupId: string,
  opts: { allowArchived?: boolean; skipLockCheck?: boolean } = {},
) {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const grp = await ctx.prisma.shotGroup.findFirst({
    where: {
      id: groupId,
      ...(opts.allowArchived ? {} : { deletedAt: null }),
      episode: { deletedAt: null },
    },
    include: { episode: true },
  });
  if (!grp) throw new TRPCError({ code: 'NOT_FOUND', message: '生成段不存在' });
  await assertProjectAccess(ctx, grp.episode.projectId);
  // W1-W5 audit 三轮 L1:导演 generateForEpisode 跑时(Episode.status=GENERATING fresh),
  // AIGC 这边写入会基于"被覆盖前快照",拒绝。
  if (!opts.skipLockCheck && isEpisodeLockedNow(grp.episode)) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: '本集正在生成分镜中,请等导演侧完成后再操作 AIGC 工作台',
    });
  }
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
      await assertProjectAccess(ctx, input.projectId);

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

      // W5.4:统计每集的已生成视频(GenerationAttempt VIDEO SUCCESS) + 已完成 group(至少一个非废片 SUCCESS)
      // W1-W5 audit 三轮 L6:过滤已归档 group(archiveGroup 软删后不算进进度)
      const episodeIds = episodes.map((e) => e.id);
      const successAttempts = episodeIds.length
        ? await ctx.prisma.generationAttempt.findMany({
            where: {
              episodeId: { in: episodeIds },
              action: 'VIDEO',
              status: 'SUCCESS',
              rejected: false,
              shotGroupId: { not: null },
              shotGroup: { deletedAt: null },
            },
            select: { episodeId: true, shotGroupId: true },
          })
        : [];
      const takeCountByEp = new Map<string, number>();
      const completedGroupSetByEp = new Map<string, Set<string>>();
      for (const a of successAttempts) {
        if (!a.episodeId) continue;
        takeCountByEp.set(a.episodeId, (takeCountByEp.get(a.episodeId) ?? 0) + 1);
        if (a.shotGroupId) {
          const s = completedGroupSetByEp.get(a.episodeId) ?? new Set<string>();
          s.add(a.shotGroupId);
          completedGroupSetByEp.set(a.episodeId, s);
        }
      }

      return episodes.map((e) => ({
        id: e.id,
        number: e.number,
        title: e.title,
        status: e.status,
        totalGroups: e._count.shotGroups,
        completedGroups: completedGroupSetByEp.get(e.id)?.size ?? 0,
        generatedTakeCount: takeCountByEp.get(e.id) ?? 0,
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
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId, { skipLockCheck: true });

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

      // W5 完善 L1:按 group 聚合 SUCCESS 视频 attempt 数(左列表显示"已抽卡 N")
      // 注:groups 已过滤 deletedAt,这里 attempts 默认就只关联到这些(W1-W5 audit 三轮 L6 一致)
      const groupIds = groups.map((g) => g.id);
      const videoAttempts = groupIds.length
        ? await ctx.prisma.generationAttempt.groupBy({
            by: ['shotGroupId', 'status'],
            where: {
              shotGroupId: { in: groupIds },
              action: 'VIDEO',
              rejected: false,
            },
            _count: { _all: true },
          })
        : [];
      const takeStats = new Map<string, { success: number; failed: number; running: number }>();
      for (const r of videoAttempts) {
        if (!r.shotGroupId) continue;
        const s = takeStats.get(r.shotGroupId) ?? { success: 0, failed: 0, running: 0 };
        if (r.status === 'SUCCESS') s.success += r._count._all;
        else if (r.status === 'FAILED') s.failed += r._count._all;
        else if (r.status === 'RUNNING' || r.status === 'QUEUED') s.running += r._count._all;
        takeStats.set(r.shotGroupId, s);
      }

      return groups.map((g) => {
        const ts = takeStats.get(g.id) ?? { success: 0, failed: 0, running: 0 };
        return {
          id: g.id,
          number: g.number, // free-form label,"1-8" 只是 W3 默认,可重命名为"陆乘·开场"等
          positionIdx: g.positionIdx,
          durationS: g.durationS,
          status: g.status,
          publishedAt: g.publishedAt,
          shotCount: g._count.shots,
          bindingCount: g._count.bindings,
          hasPrompt: g.prompt.trim().length > 0,
          videoTakes: ts,
        };
      });
    }),

  /**
   * 单生成段详情 — 右侧 4 区显示用
   * 含:shots / 原始剧本(scenes) / bindings(按 refSlotIdx 排序,带 asset + mediaUrl) / 提示词
   */
  getGroupDetail: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId, { skipLockCheck: true });

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
      // W1-W5 audit P1 followup(P1-6):查全 7 槽位 mediaId,让 fallback 链覆盖三视图/侧面/全景等
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
              threeViewMediaId: true,
              sceneMainMediaId: true,
              sceneFrontMediaId: true,
              sceneLeftMediaId: true,
              sceneRightMediaId: true,
              sceneBackMediaId: true,
              panoramaMediaId: true,
              mainMediaId: true,
              voiceMediaId: true,
              maturity: true,
              complianceStatus: true,
            },
          },
        },
      });

      // 3. 收集所有引用的 mediaId 一次性查 MediaItem
      // 第 20 轮 audit P2:加 size guard(防异常用例 1000+ binding 单次 IN 查询塞爆)
      const MEDIA_IDS_QUERY_LIMIT = 1000;
      const mediaIds = new Set<string>();
      for (const b of bindings) {
        const a = b.asset;
        for (const id of [
          a.portraitMediaId,
          a.threeViewMediaId,
          a.sceneMainMediaId,
          a.sceneFrontMediaId,
          a.sceneLeftMediaId,
          a.sceneRightMediaId,
          a.sceneBackMediaId,
          a.panoramaMediaId,
          a.mainMediaId,
          a.voiceMediaId,
        ]) {
          if (id) mediaIds.add(id);
          if (mediaIds.size >= MEDIA_IDS_QUERY_LIMIT) break;
        }
        if (mediaIds.size >= MEDIA_IDS_QUERY_LIMIT) {
          console.warn(`[aigc.getGroupDetail] mediaIds 触发 ${MEDIA_IDS_QUERY_LIMIT} 上限 (group=${grp.id} bindings=${bindings.length}),部分槽位预览可能不全`);
          break;
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

      // 4. 选 mediaUrl 策略(P1-6 audit 后扩展为全 7 槽位 fallback 链):
      //    AUDIO → voiceMediaId
      //    CHARACTER → portrait → threeView → main
      //    SCENE → sceneMain → sceneFront → sceneLeft → sceneRight → sceneBack → panorama → main
      //    PROP/STYLE → main
      const bindingsWithMedia = bindings.map((b) => {
        const a = b.asset;
        let chosenMediaId: string | null = null;
        if (kindFromUsage(b.usageType) === 'AUDIO') {
          chosenMediaId = a.voiceMediaId;
        } else if (a.type === 'CHARACTER') {
          chosenMediaId = a.portraitMediaId ?? a.threeViewMediaId ?? a.mainMediaId;
        } else if (a.type === 'SCENE') {
          chosenMediaId =
            a.sceneMainMediaId ??
            a.sceneFrontMediaId ??
            a.sceneLeftMediaId ??
            a.sceneRightMediaId ??
            a.sceneBackMediaId ??
            a.panoramaMediaId ??
            a.mainMediaId;
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

      // 4. W5 audit R1:全部写入在事务里 + advisory lock,防两个用户同时点"自动匹配"
      //    导致 refSlotIdx 双分配(partial unique 会拦,但拦到第二个用户那边抛 P2002 体验差)
      const result = await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext('aigc_match:' || $1)::bigint)`,
          grp.id,
        );

        // 锁内 re-read 现有 bindings 查重 + 算 next slot
        const existing = await tx.assetUsageBinding.findMany({
          where: { shotGroupId: grp.id, deletedAt: null },
          select: { assetId: true, usageType: true, refSlotIdx: true },
        });
        const existingKey = new Set(
          existing.map((e) => `${e.assetId}:${e.usageType}`),
        );
        const existingImageSlots = existing
          .filter((e) => !['SOUND_BG', 'SOUND_VOICE', 'THEME'].includes(e.usageType))
          .map((e) => e.refSlotIdx ?? 0);
        let nextImageIdx = Math.max(0, ...existingImageSlots) + 1;

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
          const binding = await tx.assetUsageBinding.create({
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

        return { created, skipped };
      });

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
          createdCount: result.created.length,
          skippedCount: result.skipped.length,
        },
      );

      return {
        created: result.created.length,
        skipped: result.skipped.length,
        matches: result.created,
      };
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
        // W1-W5 audit 三轮 P2-13:aspectRatio 改 enum 与 generateVideo 一致
        aspectRatio: z.enum(['9:16', '16:9', '1:1']).optional(),
        extraInstruction: z.string().max(500).optional(),
        extraNegative: z.array(z.string().max(50)).max(20).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId, { skipLockCheck: true });

      // 取 group 风格(project 默认 style)
      const project = await ctx.prisma.project.findUnique({
        where: { id: grp.episode.projectId },
        include: { style: true },
      });

      // 取 bindings + media 给 references
      // W1-W5 audit P1 followup(P1-6):查全 7 槽位 mediaId,fallback 链覆盖三视图/侧面/全景
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
              threeViewMediaId: true,
              sceneMainMediaId: true,
              sceneFrontMediaId: true,
              sceneLeftMediaId: true,
              sceneRightMediaId: true,
              sceneBackMediaId: true,
              panoramaMediaId: true,
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
          b.asset.threeViewMediaId,
          b.asset.sceneMainMediaId,
          b.asset.sceneFrontMediaId,
          b.asset.sceneLeftMediaId,
          b.asset.sceneRightMediaId,
          b.asset.sceneBackMediaId,
          b.asset.panoramaMediaId,
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

      // W5 audit W1:缺图也保留 reference(mediaUrl=null),由 compile 报 missingMedia
      const references: VideoReference[] = bindings.map((b) => {
        const kind = kindFromUsage(b.usageType);
        let chosen: string | null = null;
        if (kind === 'AUDIO') chosen = b.asset.voiceMediaId;
        else if (b.asset.type === 'CHARACTER')
          chosen = b.asset.portraitMediaId ?? b.asset.threeViewMediaId ?? b.asset.mainMediaId;
        else if (b.asset.type === 'SCENE')
          chosen =
            b.asset.sceneMainMediaId ??
            b.asset.sceneFrontMediaId ??
            b.asset.sceneLeftMediaId ??
            b.asset.sceneRightMediaId ??
            b.asset.sceneBackMediaId ??
            b.asset.panoramaMediaId ??
            b.asset.mainMediaId;
        else chosen = b.asset.mainMediaId;
        const url = chosen ? (mediaMap.get(chosen) ?? null) : null;
        return {
          refSlotIdx: b.refSlotIdx!,
          kind,
          assetId: b.asset.id,
          name: b.asset.name,
          mediaUrl: url,
        };
      });

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
        for (const id of [a.portraitMediaId, a.sceneMainMediaId, a.mainMediaId, a.voiceMediaId]) {
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
      return assets.map((a) => {
        const thumb = a.portraitMediaId
          ? mediaMap.get(a.portraitMediaId)
          : a.sceneMainMediaId
            ? mediaMap.get(a.sceneMainMediaId)
            : a.mainMediaId
              ? mediaMap.get(a.mainMediaId)
              : null;
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
      });
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
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext('aigc_match:' || $1)::bigint)`,
          grp.id,
        );

        const existing = await tx.assetUsageBinding.findFirst({
          where: {
            shotGroupId: grp.id,
            assetId: input.assetId,
            usageType,
            deletedAt: null,
          },
        });
        if (existing) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `资产 "${asset.name}" 已用 ${usageType} 关联到本生成段`,
          });
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

      await logOperation(ctx, 'aigc.bindAsset', 'shotGroup', grp.id, null, {
        bindingId: binding.id,
        assetId: input.assetId,
        assetName: asset.name,
        usageType,
        refSlotIdx: binding.refSlotIdx,
        groupNumber: grp.number,
        projectId: grp.episode.projectId,
      });

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
        return { id: binding.id, alreadyUnbound: true };
      }

      await logOperation(ctx, 'aigc.unbindAsset', 'assetUsageBinding', binding.id, binding, {
        deletedAt: new Date(),
        assetName: binding.asset.name,
        projectId: binding.episode.projectId,
      });

      return { id: binding.id, alreadyUnbound: false };
    }),

  // ============================== W5.4 视频生成 ==============================

  /**
   * 生成视频(W5.4)— 调用视频 Provider(Seedance / Kling / HappyHorse / 本地 / Mock 兜底)
   *
   * Provider 选择优先级:input.providerOverride > SystemSetting.binding.shot.video.providerId
   * 真 provider 没配置 / 无 key → MockVideoProvider 自动兜底(返公开样片,UI 端到端可演示)
   */
  generateVideo: protectedProcedure
    // 第 19 轮 audit / ADR-27:最贵的 mutation,Mastra agent 调用前必看预算 + Provider 容量
    .meta({
      agentTool: {
        description: '为一个 ShotGroup 异步抽卡生成视频片段(BullMQ 入队,SSE 推进度),调 Seedance/Volcengine',
        sideEffects: [
          'queue.enqueue:VideoGenJob',
          'db.create:GenerationAttempt',
          'cost.deduct',
          'extern.api:VideoProvider',
        ],
        costEstimateCny: 2.0,
        requireConfirm: false,
      },
    })
    // W7 audit R8 P0:per-user 10 次 / 60s — 防同用户无限烧 LLM 钱
    .use(
      rateLimit({
        key: (ctx) => `aigc.generateVideo:${ctx.user?.id ?? 'anon'}`,
        max: 10,
        windowMs: 60_000,
        message: '视频抽卡过快(每分钟最多 10 次)— 请等等再试',
      }),
    )
    .input(
      z.object({
        groupId: z.string().cuid(),
        durationS: z.number().min(1).max(15).optional(),
        aspectRatio: z.enum(['9:16', '16:9', '1:1', 'auto']).optional(),
        providerOverride: z.string().max(100).optional(),
        extraInstruction: z.string().max(500).optional(),
        extraNegative: z.array(z.string().max(50)).max(20).optional(),
        // W5.5.1 扩展参数(2026-05-24)
        resolution: z.enum(['480p', '720p', '1080p']).optional(),
        generateAudio: z.boolean().optional(),
        addWatermark: z.boolean().optional(),
        webSearchEnabled: z.boolean().optional(),
        refVideoUrl: z.string().min(1).max(2000).optional(),
        refAudioUrl: z.string().min(1).max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);
      const bindings = await getVideoBindings(ctx);

      const providerId = input.providerOverride ?? bindings.providerId;
      // W5.5.1:'auto' 比例 resolve 到项目默认(短剧默认 9:16)
      const resolvedAspect =
        input.aspectRatio === 'auto' || input.aspectRatio === undefined
          ? bindings.defaultAspectRatio
          : input.aspectRatio;
      const aspectRatio = resolvedAspect;
      const durationS = Math.min(
        input.durationS ?? grp.durationS ?? 5,
        bindings.maxDurationS,
      );

      // W1-W5 audit 三轮 G1 + 7 轮 audit P0(A1):advisory lock 必须在 $transaction 内,
      // 否则 pg_advisory_xact_lock 在 implicit transaction(单条 raw)立即释放,串行失效。
      //
      // 模式:transaction 内 锁 + inflight check + 占位 attempt(status=QUEUED)。锁释放后
      // 占位 attempt 仍在 DB,其他并发 inflight check 会看到 QUEUED → 拒。
      // 后续检查(gachaMax/budget/compile)失败时 update 占位为 FAILED 释放;通过则升 RUNNING。
      const earlyAttempt = await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext('aigc_video:' || $1)::bigint)`,
          grp.id,
        );
        const inflight = await tx.generationAttempt.findFirst({
          where: {
            shotGroupId: grp.id,
            action: 'VIDEO',
            status: { in: ['QUEUED', 'RUNNING'] },
          },
          select: { id: true, providerId: true, startedAt: true },
        });
        if (inflight) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `本生成段已有进行中的视频任务(provider=${inflight.providerId})— 等完成或失败后再点`,
          });
        }
        // 锁内创建占位 attempt(QUEUED),commit 后即占位防其他并发
        return tx.generationAttempt.create({
          data: {
            projectId: grp.episode.projectId,
            episodeId: grp.episodeId,
            shotGroupId: grp.id,
            providerId,
            modelId: providerId,
            action: 'VIDEO',
            inputJson: { kind: 'aigc.generateVideo.placeholder' },
            outputMediaIds: [],
            inputUnits: 0,
            outputUnits: 0,
            unitPriceCny: '0',
            costCny: '0',
            status: 'QUEUED',
            createdBy: ctx.user.id,
          },
        });
      });

      // 7 轮 audit A1:任何前置 check 失败都要把占位 attempt 标 FAILED 释放
      // 用 try/catch 集中处理,失败时 update earlyAttempt 然后 rethrow
      const failPlaceholder = async (err: Error, code: 'TOO_MANY_REQUESTS' | 'PRECONDITION_FAILED' | 'BAD_REQUEST') => {
        await ctx.prisma.generationAttempt.updateMany({
          where: { id: earlyAttempt.id, status: 'QUEUED' },
          data: {
            status: 'FAILED',
            errorMsg: err.message,
            finishedAt: new Date(),
          },
        });
        throw new TRPCError({ code, message: err.message });
      };

      // W1-W5 audit P2 followup(P2-5):接通 system.gacha.max_attempts(原 dead config)
      // 单 group 累计非 rejected attempt 数(含成功/失败)超 max_attempts 时拒,防失控烧钱
      const gachaSetting = await ctx.prisma.systemSetting.findUnique({
        where: { key: 'system.gacha.max_attempts' },
        select: { value: true },
      });
      const gachaMax = Number(gachaSetting?.value ?? '0');
      if (gachaMax > 0) {
        const used = await ctx.prisma.generationAttempt.count({
          where: {
            shotGroupId: grp.id,
            action: 'VIDEO',
            rejected: false,
            status: { in: ['SUCCESS', 'FAILED'] },
          },
        });
        if (used >= gachaMax) {
          await failPlaceholder(
            new Error(`本生成段已抽 ${used} 次(上限 ${gachaMax}),把废片标 rejected 或在后台调高 system.gacha.max_attempts 再试`),
            'TOO_MANY_REQUESTS',
          );
        }
      }

      // 提前 fetch provider 实例(estimateCost 用 + 后续 generate 用,Mock 兜底始终可用)
      const provider = await getVideoProvider(providerId);

      // W1-W5 audit 三轮 B1:每日预算护栏 — 用 provider.estimateCost(req) 真实预估,
      // 不再写死 seedance 系数,Mock 也按 mock 真单价 estimate(默认 0,但若管理员 unitPriceCny>0 会拦)
      // W1-W5 audit P1 followup(R9):Decimal 比较防大额预算累加 IEEE-754 漂移
      if (bindings.dailyBudgetCny > 0) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todaySpent = await ctx.prisma.costLedgerEntry.aggregate({
          where: {
            projectId: grp.episode.projectId,
            action: 'video.generate',
            success: true,
            createdAt: { gte: todayStart },
          },
          _sum: { costCny: true },
        });
        const spentDec = new Prisma.Decimal(todaySpent._sum.costCny ?? 0);
        const estimateDec = new Prisma.Decimal(
          provider.estimateCost({
            prompt: '',
            durationS,
            aspectRatio,
          }),
        );
        const limitDec = new Prisma.Decimal(bindings.dailyBudgetCny);
        if (spentDec.plus(estimateDec).gt(limitDec)) {
          await failPlaceholder(
            new Error(`今日视频预算已用 ${spentDec.toFixed(2)}¥ / 上限 ${bindings.dailyBudgetCny}¥,本次预估 ${estimateDec.toFixed(2)}¥ 会超限`),
            'TOO_MANY_REQUESTS',
          );
        }
      }

      // 1. 取项目风格 + bindings + media,编译 prompt
      const project = await ctx.prisma.project.findUnique({
        where: { id: grp.episode.projectId },
        include: { style: true },
      });

      // W1-W5 audit P1 followup(P1-6):查全 7 槽位 mediaId
      const dbBindings = await ctx.prisma.assetUsageBinding.findMany({
        where: { shotGroupId: grp.id, deletedAt: null, refSlotIdx: { not: null } },
        orderBy: { refSlotIdx: 'asc' },
        include: {
          asset: {
            select: {
              id: true,
              name: true,
              type: true,
              portraitMediaId: true,
              threeViewMediaId: true,
              sceneMainMediaId: true,
              sceneFrontMediaId: true,
              sceneLeftMediaId: true,
              sceneRightMediaId: true,
              sceneBackMediaId: true,
              panoramaMediaId: true,
              mainMediaId: true,
              voiceMediaId: true,
              complianceStatus: true,
            },
          },
        },
      });

      // W1-W5 audit P1 followup(P1-5):合规守卫 — 若 system 配 requireForVideo,
      // 引用了任何 CHARACTER 且 complianceStatus !== APPROVED 则拒生成,
      // 防止把未过合规的人物送给视频模型出片
      if (bindings.requireComplianceForVideo) {
        const blockedChars = dbBindings.filter(
          (b) => b.asset.type === 'CHARACTER' && b.asset.complianceStatus !== 'APPROVED',
        );
        if (blockedChars.length > 0) {
          await failPlaceholder(
            new Error(
              `合规未通过的人物不允许生成视频:${blockedChars
                .map((b) => `${b.asset.name}(${b.asset.complianceStatus})`)
                .join(', ')} — 在美术工作台完成合规后再试`,
            ),
            'PRECONDITION_FAILED',
          );
        }
      }

      const mediaIds = new Set<string>();
      for (const b of dbBindings) {
        for (const id of [
          b.asset.portraitMediaId,
          b.asset.threeViewMediaId,
          b.asset.sceneMainMediaId,
          b.asset.sceneFrontMediaId,
          b.asset.sceneLeftMediaId,
          b.asset.sceneRightMediaId,
          b.asset.sceneBackMediaId,
          b.asset.panoramaMediaId,
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

      // W1-W5 audit P1 followup(P1-6):全 7 槽位 fallback 链
      const refs: VideoReference[] = dbBindings.map((b) => {
        const kind = kindFromUsage(b.usageType);
        let chosen: string | null = null;
        if (kind === 'AUDIO') chosen = b.asset.voiceMediaId;
        else if (b.asset.type === 'CHARACTER')
          chosen = b.asset.portraitMediaId ?? b.asset.threeViewMediaId ?? b.asset.mainMediaId;
        else if (b.asset.type === 'SCENE')
          chosen =
            b.asset.sceneMainMediaId ??
            b.asset.sceneFrontMediaId ??
            b.asset.sceneLeftMediaId ??
            b.asset.sceneRightMediaId ??
            b.asset.sceneBackMediaId ??
            b.asset.panoramaMediaId ??
            b.asset.mainMediaId;
        else chosen = b.asset.mainMediaId;
        return {
          refSlotIdx: b.refSlotIdx!,
          kind,
          assetId: b.asset.id,
          name: b.asset.name,
          mediaUrl: chosen ? (mediaMap.get(chosen) ?? null) : null,
        };
      });

      const compiled = compileShotGroupVideoPrompt({
        text: grp.prompt,
        durationS,
        references: refs,
        style: project?.style
          ? {
              characterPrompt: project.style.characterPrompt,
              scenePrompt: project.style.scenePrompt,
              propPrompt: project.style.propPrompt,
              forbiddenWords: project.style.forbiddenWords,
            }
          : null,
        aspectRatio,
        extraInstruction: input.extraInstruction,
        extraNegative: input.extraNegative,
      });

      // 2. 提示词缺图 / 未关联 token 阻断 — 让用户先修
      if (compiled.warnings.missingMedia.length > 0) {
        await failPlaceholder(
          new Error(
            `${compiled.warnings.missingMedia
              .map((m) => `${m.assetName} 缺主图`)
              .join(' / ')} — 去美术工作台补图后再试`,
          ),
          'BAD_REQUEST',
        );
      }
      if (compiled.warnings.unknownTokens.length > 0) {
        await failPlaceholder(
          new Error(
            `提示词里用了未关联的 token:${compiled.warnings.unknownTokens.join(', ')} — 先关联或删除 token`,
          ),
          'BAD_REQUEST',
        );
      }
      if (!grp.prompt.trim()) {
        await failPlaceholder(
          new Error('提示词为空 — 去导演工作台生成或手编'),
          'BAD_REQUEST',
        );
      }

      // 3. 升级占位 attempt 到 RUNNING + 真实 inputJson(7 轮 audit A1)
      // 注:projectId/episodeId/shotGroupId/providerId/modelId/action 在占位时已写,不重复 set
      const startedAt = new Date();
      const attempt = await ctx.prisma.generationAttempt.update({
        where: { id: earlyAttempt.id },
        data: {
          // W7 audit R8 P0:inputJson 脱敏 — 不存明文 prompt + 不存资产 name/mediaUrl
          // 保留 preview/hash/length 便于追溯;references 只留 idx+kind+assetId
          inputJson: {
            kind: 'aigc.generateVideo',
            groupNumber: grp.number,
            positivePrompt: sanitizePromptForLedger(compiled.positive),
            negativePrompt: sanitizePromptForLedger(compiled.negative),
            aspectRatio,
            durationS,
            references: sanitizeReferencesForLedger(compiled.references),
          },
          status: 'RUNNING',
          startedAt,
          createdBy: ctx.user.id,
        },
      });

      // 4. 入队 BullMQ video-gen worker(ADR-25 W5.5)
      //    handler 立即返回 attemptId,worker 收到 job 后:
      //      - 调 provider.generate(ctx.skipLedger=true)
      //      - 写 MediaItem + 升 attempt SUCCESS|FAILED + costLedgerEntry
      //      - publish EVENTS.GENERATION_COMPLETED + Redis 'success'/'failed' 推 SSE
      //    失败分类(白名单):timeout/429/5xx → retry;censored/compliance → UnrecoverableError
      const refImageUrls = compiled.references
        .filter((r) => r.kind === 'IMAGE')
        .map((r) => r.mediaUrl)
        .filter((u): u is string => !!u);

      // W5.5.1 audit 修复 P2:Provider 不支持的多模态参考字段直接拒(防绕 UI 直调 API 滥用)
      const caps = await ctx.prisma.providerConfig
        .findUnique({
          where: { providerId },
          select: { defaultParams: true },
        })
        .catch(() => null);
      const capsParams =
        caps?.defaultParams && typeof caps.defaultParams === 'object'
          ? (caps.defaultParams as Record<string, unknown>)
          : {};
      if (input.refVideoUrl && capsParams.supportsRefVideo !== true) {
        await failPlaceholder(
          new Error(`当前 Provider 不支持 refVideo(请去 admin/providers 配 supportsRefVideo:true)`),
          'BAD_REQUEST',
        );
      }
      if (input.refAudioUrl && capsParams.supportsRefAudio !== true) {
        await failPlaceholder(
          new Error(`当前 Provider 不支持 refAudio`),
          'BAD_REQUEST',
        );
      }

      // W5.5 audit 修复 P0-7:入队失败时占位 attempt 必须标 FAILED,否则 5min 内同 group 抽卡被拒
      try {
        await addVideoGenJob({
          attemptId: attempt.id,
          projectId: grp.episode.projectId,
          episodeId: grp.episodeId,
          shotGroupId: grp.id,
          userId: ctx.user.id,
          providerId,
          modelId: providerId,
          prompt: compiled.positive,
          durationS,
          aspectRatio,
          refImageUrls: refImageUrls.length > 0 ? refImageUrls : undefined,
          // W5.5.1 扩展参数透传(Provider 自己消费 extra)
          resolution: input.resolution,
          generateAudio: input.generateAudio,
          addWatermark: input.addWatermark,
          webSearchEnabled: input.webSearchEnabled,
          refVideoUrl: input.refVideoUrl,
          refAudioUrl: input.refAudioUrl,
          groupNumber: grp.number,
          // 第 19 轮 audit P1:requestId 贯通到 worker,运维 grep 日志可看全链路
          requestId: ctx.requestId,
        });
      } catch (enqueueErr) {
        const errMsg = enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr);
        const finishedAt = new Date();
        await ctx.prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'FAILED',
            errorMsg: `enqueue failed: ${errMsg}`,
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
          },
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `视频任务入队失败,请稍后重试:${errMsg}`,
          cause: enqueueErr,
        });
      }

      await logOperation(ctx, 'aigc.generateVideo.enqueued', 'shotGroup', grp.id, null, {
        attemptId: attempt.id,
        providerId,
        aspectRatio,
        durationS,
        projectId: grp.episode.projectId,
      });

      return {
        attemptId: attempt.id,
        status: 'RUNNING' as const,
      };
    }),

  // ============================== W5.5 SSE + 能力查询 ==============================

  /**
   * SSE 访问 token(ADR-25 M5)— EventSource 不能塞自定义 header,只能用 query。
   *
   * 用 HMAC 短 TTL 票据替代"session cookie 走 query"的不安全做法:
   *   - 校 attemptId 关联的 projectId 用户访问权后签 5min token
   *   - 前端拿 token → `new EventSource('/api/sse/aigc/${id}?token=...')`
   *   - SSE route 仅校 token,长连接服务零业务逻辑
   */
  getStreamToken: protectedProcedure
    .input(z.object({ attemptId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const attempt = await ctx.prisma.generationAttempt.findFirst({
        where: { id: input.attemptId, action: 'VIDEO' },
        include: { shotGroup: { include: { episode: true } } },
      });
      if (!attempt || !attempt.shotGroup) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'attempt 不存在' });
      }
      await assertProjectAccess(ctx, attempt.shotGroup.episode.projectId);
      return signStreamToken({
        attemptId: input.attemptId,
        userId: ctx.user.id,
      });
    }),

  /**
   * Provider 能力查询(W5.5)— 前端渲染时长选择器范围 / 比例选择 / 显示当前模型名
   *
   * 数据源优先级:
   *   1. ProviderConfig.defaultParams.maxDurationS(后台 /admin/providers 可改 JSON 字段)
   *   2. Provider.info.maxDuration(Adapter 自报)
   *   3. SystemSetting `shot.video.maxDurationS`(全局兜底)
   *   4. 10s 默认
   *
   * 不传 providerId 时返回当前 SystemSetting binding 的 video provider 信息。
   * 业界 2026 现状:视频模型上限 ≤15s,这里硬截。
   */
  getProviderCapabilities: protectedProcedure
    .input(z.object({ providerId: z.string().max(100).optional() }))
    .query(async ({ ctx, input }) => {
      const bindings = await getVideoBindings(ctx);
      const providerId = input.providerId ?? bindings.providerId;

      const config = await ctx.prisma.providerConfig.findUnique({
        where: { providerId },
        select: {
          displayName: true,
          defaultParams: true,
          isActive: true,
        },
      });

      // Provider Adapter 自报(kind 不对会 throw)
      const provider = await getVideoProvider(providerId);

      // 解析 defaultParams JSON(后台 /admin/providers 可改)
      const params: Record<string, unknown> =
        config?.defaultParams && typeof config.defaultParams === 'object'
          ? (config.defaultParams as Record<string, unknown>)
          : {};

      const adminMaxDuration =
        typeof params.maxDurationS === 'number' ? params.maxDurationS : null;
      const adminMinDuration =
        typeof params.minDurationS === 'number' ? params.minDurationS : null;
      const adminAspectRatios = Array.isArray(params.supportedAspectRatios)
        ? (params.supportedAspectRatios as unknown[]).filter(
            (r): r is '9:16' | '16:9' | '1:1' =>
              r === '9:16' || r === '16:9' || r === '1:1',
          )
        : null;

      const rawMaxDuration =
        adminMaxDuration ?? provider.info.maxDuration ?? bindings.maxDurationS ?? 10;
      const maxDurationS = Math.min(Math.max(rawMaxDuration, 1), 15);
      const minDurationS = Math.max(adminMinDuration ?? 1, 1);
      const supportedAspectRatios =
        adminAspectRatios && adminAspectRatios.length > 0
          ? adminAspectRatios
          : (['9:16', '16:9', '1:1'] as const);

      // W5.5.1 扩展(2026-05-24):分辨率 / 音频 / 水印 / 参考素材等能力标志
      // 数据源同 maxDuration:ProviderConfig.defaultParams 优先,fallback 到默认值
      const adminResolutions = Array.isArray(params.supportedResolutions)
        ? (params.supportedResolutions as unknown[]).filter(
            (r): r is '480p' | '720p' | '1080p' =>
              r === '480p' || r === '720p' || r === '1080p',
          )
        : null;
      const supportedResolutions: Array<'480p' | '720p' | '1080p'> =
        adminResolutions && adminResolutions.length > 0
          ? adminResolutions
          : ['720p', '1080p'];
      const defaultResolution =
        typeof params.defaultResolution === 'string' &&
        ['480p', '720p', '1080p'].includes(params.defaultResolution)
          ? (params.defaultResolution as '480p' | '720p' | '1080p')
          : '720p';

      const supportsAudio = params.supportsAudio === true;
      const supportsWatermark = params.supportsWatermark !== false; // 默认 true(水印多数 Provider 都能后处理)
      const supportsWebSearch = params.supportsWebSearch === true;
      const supportsRefImage = params.supportsRefImage !== false; // 默认 true
      const supportsRefVideo = params.supportsRefVideo === true;
      const supportsRefAudio = params.supportsRefAudio === true;

      const isMock = provider.info.displayName.toLowerCase().includes('mock');

      return {
        providerId,
        displayName: config?.displayName ?? provider.info.displayName ?? providerId,
        maxDurationS,
        minDurationS,
        supportedAspectRatios,
        // W5.5.1 扩展能力
        supportedResolutions,
        defaultResolution,
        supportsAudio,
        supportsWatermark,
        supportsWebSearch,
        supportsRefImage,
        supportsRefVideo,
        supportsRefAudio,
        isActive: config?.isActive ?? true,
        isMock,
      };
    }),

  /**
   * 列出某 group 的视频生成历史(W5.4)— 含成功 / 失败 / 进行中,按 createdAt 倒序
   * W1-W5 audit 三轮 A1:allowArchived:true 让归档的 group 也能查历史(配合 archiveGroup "保留审计")
   */
  listVideoTakes: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId, {
        skipLockCheck: true,
        allowArchived: true,
      });
      const attempts = await ctx.prisma.generationAttempt.findMany({
        where: {
          shotGroupId: grp.id,
          action: 'VIDEO',
        },
        orderBy: { createdAt: 'desc' },
        include: {
          costEntry: { select: { costCny: true, success: true } },
        },
      });
      // 一次性查所有 outputMediaId 对应的 MediaItem
      const mediaIds = attempts
        .map((a) => a.outputMediaId)
        .filter((id): id is string => !!id);
      const medias =
        mediaIds.length > 0
          ? await ctx.prisma.mediaItem.findMany({
              where: { id: { in: mediaIds } },
              select: {
                id: true,
                cdnUrl: true,
                aspectRatio: true,
                meta: true,
              },
            })
          : [];
      const mediaMap = new Map(medias.map((m) => [m.id, m]));

      return attempts.map((a) => {
        const media = a.outputMediaId ? mediaMap.get(a.outputMediaId) ?? null : null;
        return {
          id: a.id,
          status: a.status,
          providerId: a.providerId,
          createdAt: a.createdAt,
          durationMs: a.durationMs,
          costCny: a.costCny,
          errorMsg: a.errorMsg,
          videoUrl: media?.cdnUrl ?? null,
          aspectRatio: media?.aspectRatio ?? null,
          mediaId: media?.id ?? null,
          rejected: a.rejected,
        };
      });
    }),

  /**
   * 标记一次视频抽卡为废片(rejected)— 只标 attempt,不删 MediaItem(保留可复用)
   */
  rejectVideoTake: protectedProcedure
    .input(z.object({ attemptId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const attempt = await ctx.prisma.generationAttempt.findFirst({
        where: { id: input.attemptId, action: 'VIDEO' },
        include: { shotGroup: { include: { episode: true } } },
      });
      if (!attempt || !attempt.shotGroup) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'video attempt 不存在' });
      }
      await assertProjectAccess(ctx, attempt.shotGroup.episode.projectId);
      // W1-W5 audit 三轮 L1:导演 GENERATING 时拒
      if (isEpisodeLockedNow(attempt.shotGroup.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜中,请等导演侧完成后再操作 AIGC 工作台',
        });
      }
      // W1-W5 audit 三轮 P2-15:幂等(已 rejected 不重复写审计)
      if (attempt.rejected) {
        return { id: attempt.id, alreadyRejected: true };
      }
      const updated = await ctx.prisma.generationAttempt.update({
        where: { id: attempt.id },
        data: {
          rejected: true,
          rejectedAt: new Date(),
          rejectedBy: ctx.user.id,
        },
      });
      await logOperation(ctx, 'aigc.rejectVideoTake', 'generationAttempt', attempt.id, attempt, {
        ...updated,
        projectId: attempt.shotGroup.episode.projectId,
      });
      return { id: updated.id, alreadyRejected: false };
    }),

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
});
