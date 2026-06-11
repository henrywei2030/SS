/**
 * Storyboard Router — ShotGroup 组(mergeShots / autoMergeEpisode / splitGroup / updateGroup)。
 *
 * 机械重构(ADR-31):从 storyboard.ts 按逻辑组拆出,纯搬运无行为变化。
 *   共用 helper / schema / 常量见 storyboard-shared.ts。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { buildGroupShotLine, mergeShots } from '@ss/core/storyboard';
import { normalizePrompt, asRecord } from '@ss/shared';

import { protectedProcedure } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';
// 三十二收工 S3 followup:batch SystemSetting 读 helper
import { loadSystemSettings } from '../utils/system-bindings.js';
import { isEpisodeLockedNow } from '../utils/episode-lock.js';
import { acquireTxAdvisoryLock } from '../utils/advisory-lock.js';

// W7+ audit R10:assertProjectAccess 抽到 middleware/access.ts
import { assertProjectAccess } from '../middleware/access.js';

import {
  loadEpisodeOrThrow,
  parseGroupPromptSections,
  recordPromptEdit,
} from './storyboard-shared.js';

export const groupProcedures = {
  // -------- ShotGroup (合并组) --------

  /**
   * 合并若干 Shot 成一组
   * - 若 shots 已在其它组里，先解除
   * - 组的 positionIdx 取所选 shots 的最小 positionIdx
   * - 组的 number 用首尾镜号拼接（如 "1-8"）
   */
  mergeShots: protectedProcedure
    // 第 20 轮 audit / ADR-27:合并镜头改变 ShotGroup 结构,Mastra agent 需 confirm 防误操作
    .meta({
      agentTool: {
        description: '把 N 个相邻镜头(shotIds)合并到一个 ShotGroup,自动算 number=首-末',
        sideEffects: ['db.create:ShotGroup', 'db.update:Shot.groupId', 'OperationLog.write'],
        costEstimateCny: 0,
        requireConfirm: true,
      },
    })
    .input(
      z.object({
        shotIds: z.array(z.string().cuid()).min(2, '至少选 2 个镜头才能合并'),
        promptOverride: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 一次性按"id ∈ list AND 项目对当前用户可访问"过滤；
      // 任何 shot 缺失（不存在 / 跨项目 / 无权访问）都统一 NOT_FOUND，避免泄漏归属
      const shots = await ctx.prisma.shot.findMany({
        where: {
          id: { in: input.shotIds },
          deletedAt: null,
          episode: {
            deletedAt: null,
            project: {
              deletedAt: null,
              OR: [
                { ownerId: ctx.user.id },
                { members: { some: { userId: ctx.user.id } } },
              ],
            },
          },
        },
        include: {
          episode: {
            select: { projectId: true, status: true, generatingStartedAt: true },
          },
        },
      });
      if (shots.length !== input.shotIds.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '部分分镜不存在或无访问权限' });
      }
      const episodeIds = new Set(shots.map((s) => s.episodeId));
      if (episodeIds.size !== 1) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '只能合并同一集分镜' });
      }
      // r10 audit:防御性 narrow · 替代链式 ! non-null(若 prisma include 未返 episode 则给明确错而非运行时崩)
      const firstShot = shots[0];
      if (!firstShot || !firstShot.episode) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '分镜数据不完整(缺 episode 关联)— 可能数据异常,请刷新重试',
        });
      }
      const episodeId = firstShot.episodeId;
      const projectId = firstShot.episode.projectId;

      // W1-W5 audit P1 followup(P1-2):本集 fresh GENERATING 时不允许 merge
      if (isEpisodeLockedNow(firstShot.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,请等导演侧完成后再合并镜头',
        });
      }

      const sorted = [...shots].sort((a, b) => a.positionIdx - b.positionIdx);
      const firstNum = sorted[0]!.number;
      const lastNum = sorted[sorted.length - 1]!.number;
      const groupNumber = firstNum === lastNum ? firstNum : `${firstNum}-${lastNum}`;

      const totalDuration = sorted.reduce((s, x) => s + x.durationS, 0);

      // 默认提示词：组内 shots 的 prompt 拼接(用户后续可编辑)
      // 七二·提示词去重:buildGroupShotLine 只拼 [i/N] 镜号 + 正文 + 音效 —
      //   景别/机位/运镜由正文自带 + 编译期【时间轴】段承载,不再前置同源维度标签(防字面重复);
      //   与 autoMergeEpisode 的 merge.ts 同一真相源
      const defaultPrompt =
        input.promptOverride ??
        sorted
          .map((s, i) =>
            buildGroupShotLine({ sound: s.sound ?? undefined, prompt: s.prompt }, i, sorted.length),
          )
          .join('\n');

      // 记录被选中 shots 当前所属的旧组 — 合并后这些组可能变空,需要清理
      const oldGroupIds = Array.from(
        new Set(shots.map((s) => s.groupId).filter((id): id is string => id !== null)),
      );

      // group.positionIdx 用 max+1 单调递增（含 soft-deleted）
      // advisory lock 保证读 max + create + 清空组的整个过程原子
      const group = await ctx.prisma.$transaction(async (tx) => {
        await acquireTxAdvisoryLock(tx, 'storyboard_group', episodeId);
        const lastGroup = await tx.shotGroup.findFirst({
          where: { episodeId },
          orderBy: { positionIdx: 'desc' },
        });
        const groupPositionIdx = (lastGroup?.positionIdx ?? 0) + 1;

        const g = await tx.shotGroup.create({
          data: {
            episodeId,
            number: groupNumber,
            positionIdx: groupPositionIdx,
            durationS: totalDuration,
            prompt: defaultPrompt,
          },
        });
        // 若选中的 shots 已在其它组，updateMany 直接覆盖 groupId 即可
        await tx.shot.updateMany({
          where: { id: { in: input.shotIds } },
          data: { groupId: g.id },
        });

        // 清理变空的旧组(剩 0 个 shot 的)
        if (oldGroupIds.length > 0) {
          const emptyOldGroups = await tx.shotGroup.findMany({
            where: {
              id: { in: oldGroupIds },
              deletedAt: null,
              shots: { none: { deletedAt: null } },
            },
            select: { id: true },
          });
          if (emptyOldGroups.length > 0) {
            await tx.shotGroup.updateMany({
              where: { id: { in: emptyOldGroups.map((x) => x.id) } },
              data: { deletedAt: new Date() },
            });
          }
        }

        return g;
      });

      await logOperation(ctx, 'shot_group.merge', 'shot_group', group.id, null, {
        shotIds: input.shotIds,
        number: groupNumber,
        projectId,
      });

      return group;
    }),

  /**
   * 自动整合(2026-06 用户需求):对当前集所有「单一分镜」(未入组)按 positionIdx 顺序贪心合并。
   * 规则三条:①每组累计时长 ≤ maxDurationS(默认 15s)②**仅同一场景(sceneId 相同)的相邻镜头可合并**,
   * 跨场景强制开新组 ③严格按顺序,不任意组合。复用 core/storyboard/merge.ts(与手动合并同一真相源)。
   */
  autoMergeEpisode: protectedProcedure
    .meta({
      agentTool: {
        description: '对当前集未入组的单一分镜按顺序贪心合并成多个 ShotGroup(每组累计时长 ≤maxDurationS)',
        sideEffects: ['db.create:ShotGroup', 'db.update:Shot.groupId', 'OperationLog.write'],
        costEstimateCny: 0,
        requireConfirm: true,
      },
    })
    .input(
      z.object({
        episodeId: z.string().cuid(),
        maxDurationS: z.number().positive().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId);
      if (isEpisodeLockedNow(ep)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,请等完成后再自动整合',
        });
      }
      // 合并阈值:前端传(可选)优先,否则读系统设置 storyboard.maxDurationS(默认 15)。
      //   不走 getStoryboardBindings(它强制要求 LLM modelId,而自动整合纯本地不调 LLM)
      const settings = await loadSystemSettings(ctx.prisma, ['storyboard.maxDurationS']);
      const maxD = input.maxDurationS ?? Number(settings['storyboard.maxDurationS'] ?? '15');

      // 该集所有「单一分镜」(未入组)按 positionIdx 顺序
      const standalone = await ctx.prisma.shot.findMany({
        where: { episodeId: input.episodeId, groupId: null, deletedAt: null },
        orderBy: { positionIdx: 'asc' },
      });
      if (standalone.length < 2) {
        return { groupsCreated: 0, shotsMerged: 0, message: '没有可整合的单一分镜(需 ≥2 个未入组镜头)' };
      }

      // 贪心合并(merge.ts):规则(2026-06 用户)= ①每组累计 ≤maxD ②仅同一场景(sceneId)相邻镜头可并,
      //   跨场景强制开新组 ③严格按 positionIdx 顺序,不任意组合。
      const { groups } = mergeShots(
        standalone.map((s) => ({
          id: s.id,
          number: s.number,
          durationS: s.durationS,
          framing: s.framing ?? undefined,
          angle: s.angle ?? undefined,
          // H0 捡漏:四维 + 音效透传给 merge.ts 默认拼接(此前丢失)
          movement: s.movement ?? undefined,
          lighting: s.lighting ?? undefined,
          sound: s.sound ?? undefined,
          content: s.content,
          prompt: s.prompt,
          positionIdx: s.positionIdx,
          sceneId: s.sceneId,
          priority: (s.priority ?? undefined) as 'S' | 'A' | 'B' | 'C' | undefined,
        })),
        { maxDurationS: maxD, requireSameScene: true },
      );
      // 只对 ≥2 镜的组建 ShotGroup(单镜保持 standalone,发布时再 1:1 成组)
      const mergeable = groups.filter((g) => g.shots.length >= 2);
      if (mergeable.length === 0) {
        return {
          groupsCreated: 0,
          shotsMerged: 0,
          message: `按「同场景 + ≤${maxD}s」整合后没有可合并的相邻镜头(均跨场景/超单镜时长/已成组)`,
        };
      }

      let shotsMerged = 0;
      await ctx.prisma.$transaction(async (tx) => {
        await acquireTxAdvisoryLock(tx, 'storyboard_group', input.episodeId);
        const lastGroup = await tx.shotGroup.findFirst({
          where: { episodeId: input.episodeId },
          orderBy: { positionIdx: 'desc' },
        });
        let nextPos = (lastGroup?.positionIdx ?? 0) + 1;
        for (const g of mergeable) {
          const created = await tx.shotGroup.create({
            data: {
              episodeId: input.episodeId,
              number: g.number,
              positionIdx: nextPos++,
              durationS: g.durationS,
              prompt: g.mergedPrompt,
            },
          });
          await tx.shot.updateMany({
            where: { id: { in: g.shots.map((s) => s.id) } },
            data: { groupId: created.id },
          });
          shotsMerged += g.shots.length;
        }
      });

      await logOperation(ctx, 'shot_group.auto_merge', 'episode', input.episodeId, null, {
        groupsCreated: mergeable.length,
        shotsMerged,
        maxDurationS: maxD,
        projectId: ep.projectId,
      });

      return {
        groupsCreated: mergeable.length,
        shotsMerged,
        message: `已按「同场景 + ≤${maxD}s」顺序整合为 ${mergeable.length} 组(共 ${shotsMerged} 镜)`,
      };
    }),

  /**
   * 解散一组 — soft-delete ShotGroup + 清 shots.groupId
   *
   * 不复用 Prisma 的 onDelete: SetNull（我们用 soft-delete 不真删行），
   * 因此必须手动 updateMany 清 groupId，且与 group soft-delete 同事务避免半成品状态。
   */
  splitGroup: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.prisma.shotGroup.findFirst({
        where: { id: input.groupId, deletedAt: null },
        include: {
          episode: {
            select: { projectId: true, status: true, generatingStartedAt: true },
          },
          shots: true,
        },
      });
      if (!group || !group.episode) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '合并组不存在或已删除' });
      }
      await assertProjectAccess(ctx, group.episode.projectId);
      // W1-W5 audit P1 followup(P1-2):本集 fresh GENERATING 时不允许拆组
      if (isEpisodeLockedNow(group.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,请等导演侧完成后再拆分合并组',
        });
      }

      // 用户反馈:在分镜组保存修改的 prompt,拆分时需同步到对应子镜
      // 按合并时的拼接格式 `[i/N] <标题行>\n<prompt 内容>` 反向解析
      // 解析失败(用户改乱了格式)→ fallback 保留 shot.prompt 原值
      const sortedShots = [...group.shots].sort((a, b) => a.positionIdx - b.positionIdx);
      const sectionUpdates = parseGroupPromptSections(group.prompt, sortedShots);

      await ctx.prisma.$transaction(async (tx) => {
        await tx.shotGroup.update({
          where: { id: input.groupId },
          data: { deletedAt: new Date() },
        });
        await tx.shot.updateMany({
          where: { groupId: input.groupId },
          data: { groupId: null },
        });
        // 解析成功(段数等于子镜数)才回写,否则保留原 shot.prompt
        if (sectionUpdates && sectionUpdates.length === sortedShots.length) {
          for (let i = 0; i < sortedShots.length; i++) {
            const newPrompt = sectionUpdates[i]!;
            if (newPrompt !== sortedShots[i]!.prompt) {
              await tx.shot.update({
                where: { id: sortedShots[i]!.id },
                data: { prompt: newPrompt },
              });
            }
          }
        }
      });

      await logOperation(
        ctx,
        'shot_group.split',
        'shot_group',
        input.groupId,
        { ...group, projectId: group.episode.projectId },
        null,
      );
      return {
        ok: true,
        shotCount: group.shots.length,
        promptSynced: sectionUpdates !== null,
      };
    }),

  updateGroup: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        patch: z
          .object({
            prompt: z.string().optional(),
            number: z.string().optional(),
          })
          .strict(),
        diffNote: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.shotGroup.findUnique({
        where: { id: input.groupId },
        include: {
          episode: {
            select: { projectId: true, status: true, generatingStartedAt: true },
          },
        },
      });
      if (!before || !before.episode) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await assertProjectAccess(ctx, before.episode.projectId);
      // W1-W5 audit P1 followup(P1-2):本集 fresh GENERATING 时不允许改 group
      if (isEpisodeLockedNow(before.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,请等导演侧完成后再编辑合并组',
        });
      }

      // 2026-05-27 audit r12 P0-C1:prompt 字段 server 端 normalize,跟前端 GroupPromptEditor 显示对齐
      // 训练集 PromptEdit before/after 用 normalize 版本(否则 LLM raw 跟用户 compact 改不对标)
      const patchToWrite: Record<string, unknown> = { ...input.patch };
      if (typeof patchToWrite.prompt === 'string') {
        patchToWrite.prompt = normalizePrompt(patchToWrite.prompt);
      }
      const after = await ctx.prisma.shotGroup.update({
        where: { id: input.groupId },
        data: patchToWrite,
      });

      const currentScript = await ctx.prisma.script.findFirst({
        where: { episodeId: before.episodeId, isCurrent: true, deletedAt: null },
        select: { id: true },
      });

      for (const [field, newVal] of Object.entries(patchToWrite)) {
        if (newVal === undefined) continue;
        const rawOld = asRecord(before)?.[field];
        const oldVal =
          field === 'prompt' && typeof rawOld === 'string'
            ? normalizePrompt(rawOld)
            : (rawOld ?? '');
        await recordPromptEdit(ctx, {
          targetType: 'SHOT_GROUP',
          targetId: input.groupId,
          field,
          before: oldVal,
          after: newVal,
          diffNote: input.diffNote,
          projectId: before.episode.projectId,
          episodeId: before.episodeId,
          scriptId: currentScript?.id,
        });
      }

      await logOperation(
        ctx,
        'shot_group.update',
        'shot_group',
        after.id,
        { ...before, projectId: before.episode.projectId },
        { ...after, projectId: before.episode.projectId },
      );
      return after;
    }),
};
