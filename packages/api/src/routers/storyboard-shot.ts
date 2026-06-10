/**
 * Storyboard Router — Shot 组(listShots / createShot / updateShot / deleteShot)。
 *
 * 机械重构(ADR-31):从 storyboard.ts 按逻辑组拆出,纯搬运无行为变化。
 *   共用 helper / schema / 常量见 storyboard-shared.ts。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord } from '@ss/shared';

import { protectedProcedure } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';
import { isEpisodeLockedNow } from '../utils/episode-lock.js';

// W7+ audit R10:assertProjectAccess 抽到 middleware/access.ts
import { assertProjectAccess } from '../middleware/access.js';

import { loadEpisodeOrThrow, recordPromptEdit } from './storyboard-shared.js';

export const shotProcedures = {
  // -------- Shot --------

  /**
   * 列出某集分镜
   * - grouped=true：返回 { groups, ungrouped } 视图（UI 主视图）
   * - grouped=false：返回扁平 shots[]（导出 / 编辑用）
   */
  listShots: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().cuid(),
        grouped: z.boolean().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      await loadEpisodeOrThrow(ctx, input.episodeId);

      const shots = await ctx.prisma.shot.findMany({
        where: { episodeId: input.episodeId, deletedAt: null },
        orderBy: { positionIdx: 'asc' },
      });

      if (!input.grouped) return { shots };

      const groups = await ctx.prisma.shotGroup.findMany({
        where: { episodeId: input.episodeId, deletedAt: null },
        orderBy: { positionIdx: 'asc' },
      });

      const byGroup = new Map<string, typeof shots>();
      const ungrouped: typeof shots = [];
      for (const s of shots) {
        if (s.groupId) {
          if (!byGroup.has(s.groupId)) byGroup.set(s.groupId, []);
          byGroup.get(s.groupId)!.push(s);
        } else {
          ungrouped.push(s);
        }
      }

      return {
        groups: groups.map((g) => ({ ...g, shots: byGroup.get(g.id) ?? [] })),
        ungrouped,
      };
    }),

  createShot: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().cuid(),
        sceneId: z.string().cuid().optional(),
        number: z.string(),
        framing: z.string().optional(),
        angle: z.string().optional(),
        // W1-W5 audit P1 followup:W7 4 预设全收
        movement: z.string().max(50).optional(),
        lighting: z.string().max(50).optional(),
        // 六八:音效设计(自由文本)
        sound: z.string().max(120).optional(),
        content: z.string(),
        prompt: z.string().default(''),
        durationS: z.number().positive().default(3),
        priority: z.enum(['S', 'A', 'B', 'C']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId);

      // 自动取末位 positionIdx + 1
      const last = await ctx.prisma.shot.findFirst({
        where: { episodeId: ep.id },
        orderBy: { positionIdx: 'desc' },
      });
      const positionIdx = (last?.positionIdx ?? 0) + 1;

      const shot = await ctx.prisma.shot.create({
        data: {
          episodeId: ep.id,
          sceneId: input.sceneId,
          number: input.number,
          framing: input.framing,
          angle: input.angle,
          movement: input.movement,
          lighting: input.lighting,
          sound: input.sound,
          content: input.content,
          prompt: input.prompt,
          durationS: input.durationS,
          priority: input.priority,
          positionIdx,
        },
      });
      await logOperation(
        ctx,
        'shot.create',
        'shot',
        shot.id,
        null,
        { ...shot, projectId: ep.projectId },
      );
      return shot;
    }),

  updateShot: protectedProcedure
    .input(
      z.object({
        shotId: z.string().cuid(),
        patch: z
          .object({
            framing: z.string().optional(),
            angle: z.string().optional(),
            // W1-W5 audit P1 followup:W7 4 预设全收
            movement: z.string().max(50).nullable().optional(),
            lighting: z.string().max(50).nullable().optional(),
            // 六八:四维电影级 — 音效设计(自由文本)
            sound: z.string().max(120).nullable().optional(),
            content: z.string().optional(),
            prompt: z.string().optional(),
            durationS: z.number().positive().optional(),
            priority: z.enum(['S', 'A', 'B', 'C']).nullable().optional(),
          })
          .strict(),
        diffNote: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.shot.findUnique({
        where: { id: input.shotId },
        include: {
          episode: {
            select: { id: true, projectId: true, status: true, generatingStartedAt: true },
          },
        },
      });
      if (!before || !before.episode) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '分镜不存在' });
      }
      await assertProjectAccess(ctx, before.episode.projectId);
      // W1-W5 audit P1 followup(P1-2):本集 fresh GENERATING 时不允许改 shot,
      // 防 generateForEpisode 跑到一半被人改字段产生跨版本数据
      if (isEpisodeLockedNow(before.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,请等导演侧完成后再编辑(避免数据被覆盖)',
        });
      }

      const after = await ctx.prisma.shot.update({
        where: { id: input.shotId },
        data: input.patch,
      });

      // 关联当前剧本版本(scriptId)到训练数据 — ML pipeline 还原 prompt 上下文必需
      const currentScript = await ctx.prisma.script.findFirst({
        where: { episodeId: before.episodeId, isCurrent: true, deletedAt: null },
        select: { id: true },
      });

      // 把每个变化的字段都写成一条 PromptEdit 训练数据
      // recordPromptEdit 内部过滤：只记 framing/angle/content/prompt 等可训练字段
      for (const [field, newVal] of Object.entries(input.patch)) {
        if (newVal === undefined) continue;
        const oldVal = asRecord(before)?.[field];
        await recordPromptEdit(ctx, {
          targetType: 'SHOT',
          targetId: input.shotId,
          field,
          before: oldVal ?? '',
          after: newVal,
          diffNote: input.diffNote,
          projectId: before.episode.projectId,
          episodeId: before.episodeId,
          scriptId: currentScript?.id,
        });
      }

      // 若改了 durationS 且 shot 在某个 group 里 → 重算组总时长
      if (input.patch.durationS !== undefined && before.groupId) {
        const groupShots = await ctx.prisma.shot.findMany({
          where: { groupId: before.groupId, deletedAt: null },
          select: { durationS: true },
        });
        const total = groupShots.reduce((s, x) => s + x.durationS, 0);
        await ctx.prisma.shotGroup.update({
          where: { id: before.groupId },
          data: { durationS: total },
        });
      }

      await logOperation(
        ctx,
        'shot.update',
        'shot',
        after.id,
        { ...before, projectId: before.episode.projectId },
        { ...after, projectId: before.episode.projectId },
      );
      return after;
    }),

  deleteShot: protectedProcedure
    .input(z.object({ shotId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const shot = await ctx.prisma.shot.findFirst({
        where: { id: input.shotId, deletedAt: null },
        include: {
          episode: {
            select: { projectId: true, status: true, generatingStartedAt: true },
          },
        },
      });
      if (!shot || !shot.episode) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await assertProjectAccess(ctx, shot.episode.projectId);
      // W1-W5 audit P1 followup(P1-2):本集 fresh GENERATING 时不允许删 shot
      if (isEpisodeLockedNow(shot.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,请等导演侧完成后再删除分镜',
        });
      }

      // 联动清理 W4 AssetUsageBinding 指向本 shot 的引用,防止悬空 binding
      const now = new Date();
      await ctx.prisma.$transaction([
        ctx.prisma.shot.update({
          where: { id: input.shotId },
          data: { deletedAt: now },
        }),
        ctx.prisma.assetUsageBinding.updateMany({
          where: { shotId: input.shotId, deletedAt: null },
          data: { deletedAt: now },
        }),
      ]);
      await logOperation(
        ctx,
        'shot.delete',
        'shot',
        input.shotId,
        { ...shot, projectId: shot.episode.projectId },
        null,
      );
      return { ok: true };
    }),
};
