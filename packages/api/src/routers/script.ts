/**
 * Script Router — 剧本上传 / 单集分析
 *
 * W2 仅实现 upload + 触发 analyze（异步）；
 * analyze worker 在 W2.7 实现。
 */
import { TRPCError } from '@trpc/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { router, protectedProcedure } from '../trpc.js';
import type { Context } from '../context.js';
import { logOperation } from '../middleware/audit.js';

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

export const scriptRouter = router({
  /** 上传/更新剧本（按集） */
  upload: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        episodeNumber: z.number().int().positive(),
        title: z.string().optional(),
        content: z.string().min(1, '剧本内容不能为空'),
        language: z.string().default('zh-CN'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, ctx.user.id);

      // 1. upsert Episode
      const episode = await ctx.prisma.episode.upsert({
        where: {
          projectId_number: {
            projectId: input.projectId,
            number: input.episodeNumber,
          },
        },
        create: {
          projectId: input.projectId,
          number: input.episodeNumber,
          title: input.title,
        },
        update: {
          ...(input.title && { title: input.title }),
        },
      });

      // 2. upsert Script（同 contentHash 不重复存）
      const contentHash = createHash('sha256').update(input.content).digest('hex');
      const existing = await ctx.prisma.script.findUnique({
        where: { episodeId: episode.id },
      });

      let script;
      if (existing) {
        if (existing.contentHash === contentHash) {
          return { episode, script: existing, changed: false };
        }
        script = await ctx.prisma.script.update({
          where: { id: existing.id },
          data: {
            content: input.content,
            contentHash,
            language: input.language,
            title: input.title,
            version: existing.version + 1,
          },
        });
      } else {
        script = await ctx.prisma.script.create({
          data: {
            projectId: input.projectId,
            episodeId: episode.id,
            content: input.content,
            contentHash,
            language: input.language,
            title: input.title,
          },
        });
      }

      await logOperation(
        ctx,
        existing ? 'script.update' : 'script.create',
        'script',
        script.id,
        existing,
        script,
      );

      return { episode, script, changed: true };
    }),

  /** 列出某项目所有剧本 */
  list: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, ctx.user.id);
      return ctx.prisma.script.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        orderBy: { episode: { number: 'asc' } },
        include: {
          episode: { select: { id: true, number: true, title: true } },
          analyses: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              overallScore: true,
              createdAt: true,
            },
          },
        },
      });
    }),

  /** 取最新分析结果 */
  latestAnalysis: protectedProcedure
    .input(z.object({ scriptId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const script = await ctx.prisma.script.findUnique({
        where: { id: input.scriptId },
      });
      if (!script) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertProjectAccess(ctx, script.projectId, ctx.user.id);

      return ctx.prisma.scriptAnalysis.findFirst({
        where: { scriptId: input.scriptId },
        orderBy: { createdAt: 'desc' },
      });
    }),

  /**
   * 发起分析 — Phase 1：同步调用 LLM（W3 起改异步 worker + 多 Agent 对抗）
   */
  analyze: protectedProcedure
    .input(
      z.object({
        scriptId: z.string().cuid(),
        modelId: z.string().default('claude-sonnet-4-5'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const script = await ctx.prisma.script.findUnique({
        where: { id: input.scriptId },
        include: { episode: true },
      });
      if (!script) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertProjectAccess(ctx, script.projectId, ctx.user.id);

      // 动态加载以避免 router 顶层依赖 LLM 包
      const { analyzeScript } = await import('@ss/core/script');

      try {
        const result = await analyzeScript({
          scriptText: script.content,
          episodeNumber: script.episode?.number ?? 1,
          modelId: input.modelId,
          ctx: {
            userId: ctx.user.id,
            projectId: script.projectId,
            episodeId: script.episodeId ?? undefined,
          },
        });

        // Prisma 的 Json 字段需要纯 JSON 值 — 序列化往返一次避免类型紧固
        const toJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

        const analysis = await ctx.prisma.scriptAnalysis.create({
          data: {
            scriptId: input.scriptId,
            episodeId: script.episodeId,
            modelId: input.modelId,
            hookScore: result.scores.hookScore,
            suspenseScore: result.scores.suspenseScore,
            twistScore: result.scores.twistScore,
            climaxScore: result.scores.climaxScore,
            conflictScore: result.scores.conflictScore,
            dialogueScore: result.scores.dialogueScore,
            paceScore: result.scores.paceScore,
            urgencyScore: result.scores.urgencyScore,
            overallScore: result.scores.overallScore,
            summary: result.summary,
            highlights: toJson(result.highlights) as never,
            issues: toJson(result.issues) as never,
            curveJson: toJson(result.curve) as never,
            productionPlan: toJson(result.productionPlan) as never,
            costCny: result.cost,
            createdBy: ctx.user.id,
          },
        });

        await logOperation(ctx, 'script.analyze.complete', 'script', script.id, null, {
          analysisId: analysis.id,
          overallScore: result.scores.overallScore,
          cost: result.cost,
        });

        return { analysis, status: 'done' };
      } catch (e) {
        await logOperation(ctx, 'script.analyze.failed', 'script', script.id, null, {
          error: e instanceof Error ? e.message : String(e),
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: e instanceof Error ? e.message : '剧本分析失败',
        });
      }
    }),
});
