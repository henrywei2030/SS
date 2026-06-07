/**
 * AIGC Router — 集数总览 / 单集工作台查询(机械拆分 ADR-31,纯搬运)。
 *   listEpisodes / listGroups / getGroupDetail
 */
import { z } from 'zod';

import { pickAssetMediaId } from '@ss/core/asset';
import { kindFromUsage } from '@ss/core/storyboard';
import { ASPECT_RATIOS, type AspectRatio } from '@ss/shared/constants';

import { protectedProcedure } from '../trpc.js';
import { assertProjectAccess, loadEpisodeOrThrow } from '../middleware/access.js';

import { loadGroupOrThrow } from './aigc-shared.js';

export const overviewProcedures = {
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

      // 用户反馈 r5:按组内**首镜 positionIdx** 排序,而不是 ShotGroup.positionIdx(创建顺序)
      // 让组 1-6 真的排在 7-11 之前,12-14 之后(按剧本顺序展示)
      // r7 audit P1-A3:原实现用 include shots.take:1 每组发一次子查询(N+1)
      //   改成 1 次 findMany 取所有 shots(只 select groupId + positionIdx),内存里 groupBy 取首镜
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

      // 单次拉取本集所有 shots 的 (groupId, positionIdx),内存里 groupBy 算每组首镜
      const allShotPositions = await ctx.prisma.shot.findMany({
        where: { episodeId: ep.id, deletedAt: null, groupId: { not: null } },
        select: { groupId: true, positionIdx: true },
        orderBy: { positionIdx: 'asc' },
      });
      const firstShotPosByGroup = new Map<string, number>();
      for (const s of allShotPositions) {
        if (s.groupId && !firstShotPosByGroup.has(s.groupId)) {
          firstShotPosByGroup.set(s.groupId, s.positionIdx);
        }
      }

      // 按首镜 positionIdx 升序排;空组(无 shots)排到底部
      groups.sort((a, b) => {
        const aPos = firstShotPosByGroup.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const bPos = firstShotPosByGroup.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return aPos - bPos;
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

      // 用户反馈 2026-05-27:返项目 aspect 让前端默认 aspect 跟项目走
      // r15:加 project.name + episode.number 给下载文件名规则化用
      const project = await ctx.prisma.project.findUnique({
        where: { id: grp.episode.projectId },
        select: { aspect: true, name: true },
      });

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
        const chosenMediaId = pickAssetMediaId(a, kindFromUsage(b.usageType));
        const media = chosenMediaId ? mediaMap.get(chosenMediaId) : null;
        return {
          ...b,
          mediaUrl: media?.cdnUrl ?? null,
          kind: kindFromUsage(b.usageType),
        };
      });

      // 项目 aspect 白名单校验(老项目 DB 字段是 String,可能有非标准值)
      const projectAspect: AspectRatio =
        project?.aspect &&
        (ASPECT_RATIOS as readonly string[]).includes(project.aspect)
          ? (project.aspect as AspectRatio)
          : '9:16';

      return {
        group: {
          id: grp.id,
          number: grp.number,
          positionIdx: grp.positionIdx,
          durationS: grp.durationS,
          prompt: grp.prompt,
          promptCompiled: grp.promptCompiled,
          status: grp.status,
          // 2026-05-27 audit r12 P1:暴露 episodeId 给前端 invalidate 限定使用
          episodeId: grp.episodeId,
        },
        project: {
          aspect: projectAspect,
          // r15:下载文件名规则化用
          name: project?.name ?? '',
        },
        // r15:剧集编号 + 标题给下载文件名拼接用
        episode: {
          number: grp.episode.number,
          title: grp.episode.title ?? null,
        },
        shots,
        bindings: bindingsWithMedia,
      };
    }),
};
