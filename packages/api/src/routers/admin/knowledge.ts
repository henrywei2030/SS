/**
 * admin.knowledge — H3(docs/07):八维提示词知识库管理。
 *
 * 职责:
 *   - 浏览/筛选(维度/来源/启停/项目私有)
 *   - MINED 候选审核(飞轮回路①③产出 enabled=false,这里人工启用 — D-D 纪律)
 *   - 编辑/新建/删除(编辑过的条目 db:sync 不覆盖 — upsert ADDITIVE 语义)
 *   - 手动触发「人改蒸馏」(PromptEdit AI→人改对 → LLM 提炼候选)
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { Prisma } from '@ss/db';
import { minePromptEditCandidates } from '@ss/core/prompt-knowledge';

import { router, adminProcedure } from '../../trpc.js';
import { logOperation } from '../../middleware/audit.js';

const DIMENSIONS = [
  'SUBJECT',
  'ACTION',
  'SCENE',
  'LIGHTING',
  'CAMERA',
  'STYLE',
  'QUALITY',
  'CONSTRAINT',
] as const;
const SOURCES = ['SEED', 'MANUAL', 'MINED'] as const;

const dimensionSchema = z.enum(DIMENSIONS);
const sourceSchema = z.enum(SOURCES);

/** keywords CSV → tagsJson(只开放 keywords 编辑;family/style/mood/era 留 seed/手编 DB) */
function keywordsToTags(
  existing: unknown,
  keywordsCsv: string | undefined,
): Record<string, unknown> | undefined {
  if (keywordsCsv === undefined) return undefined;
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const keywords = keywordsCsv
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (keywords.length > 0) base.keywords = keywords;
  else delete base.keywords;
  return base;
}

export const knowledgeRouter = router({
  list: adminProcedure
    .input(
      z
        .object({
          dimension: dimensionSchema.optional(),
          source: sourceSchema.optional(),
          /** true=只看待审核候选(enabled=false 的 MINED) */
          candidatesOnly: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        ...(input?.dimension ? { dimension: input.dimension } : {}),
        ...(input?.source ? { source: input.source } : {}),
        ...(input?.candidatesOnly ? { enabled: false, source: 'MINED' as const } : {}),
      };
      const [entries, total, enabledCount, candidates] = await Promise.all([
        ctx.prisma.promptKnowledge.findMany({
          where,
          orderBy: [{ enabled: 'asc' }, { dimension: 'asc' }, { createdAt: 'desc' }],
          take: 300,
          select: {
            id: true,
            dimension: true,
            slug: true,
            title: true,
            content: true,
            tagsJson: true,
            projectId: true,
            source: true,
            enabled: true,
            hitCount: true,
            weight: true,
            lastUsedAt: true,
            createdAt: true,
          },
        }),
        ctx.prisma.promptKnowledge.count(),
        ctx.prisma.promptKnowledge.count({ where: { enabled: true } }),
        ctx.prisma.promptKnowledge.count({ where: { enabled: false, source: 'MINED' } }),
      ]);
      return { entries, summary: { total, enabled: enabledCount, candidates } };
    }),

  create: adminProcedure
    .input(
      z.object({
        dimension: dimensionSchema,
        title: z.string().min(1).max(40),
        content: z.string().min(1).max(500),
        keywordsCsv: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const created = await ctx.prisma.promptKnowledge.create({
        data: {
          dimension: input.dimension,
          title: input.title.trim(),
          content: input.content.trim(),
          tagsJson: (keywordsToTags({}, input.keywordsCsv) ?? {}) as Prisma.InputJsonValue,
          source: 'MANUAL',
          enabled: true,
          createdBy: ctx.user.id,
        },
      });
      await logOperation(ctx, 'admin.knowledge.create', 'promptKnowledge', created.id, null, {
        dimension: input.dimension,
        title: input.title,
      });
      return created;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        dimension: dimensionSchema.optional(),
        title: z.string().min(1).max(40).optional(),
        content: z.string().min(1).max(500).optional(),
        keywordsCsv: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.promptKnowledge.findUnique({
        where: { id: input.id },
        select: { id: true, tagsJson: true },
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: '知识条目不存在' });
      const tags = keywordsToTags(row.tagsJson, input.keywordsCsv);
      const updated = await ctx.prisma.promptKnowledge.update({
        where: { id: input.id },
        data: {
          ...(input.dimension ? { dimension: input.dimension } : {}),
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.content !== undefined
            ? {
                content: input.content.trim(),
                // 正文变了 → 旧向量失真,清掉等懒回填重算(与 seed 全量刷同口径)
                embedding: Prisma.DbNull,
                embeddingModel: null,
              }
            : {}),
          ...(tags !== undefined ? { tagsJson: tags as Prisma.InputJsonValue } : {}),
        },
      });
      await logOperation(ctx, 'admin.knowledge.update', 'promptKnowledge', input.id, null, {
        fields: Object.keys(input).filter((k) => k !== 'id'),
      });
      return updated;
    }),

  setEnabled: adminProcedure
    .input(z.object({ id: z.string().cuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.prisma.promptKnowledge.update({
        where: { id: input.id },
        data: { enabled: input.enabled },
      });
      await logOperation(ctx, 'admin.knowledge.setEnabled', 'promptKnowledge', input.id, null, {
        enabled: input.enabled,
        title: updated.title,
      });
      return { id: updated.id, enabled: updated.enabled };
    }),

  remove: adminProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.promptKnowledge.findUnique({
        where: { id: input.id },
        select: { title: true, slug: true, source: true },
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: '知识条目不存在' });
      await ctx.prisma.promptKnowledge.delete({ where: { id: input.id } });
      await logOperation(ctx, 'admin.knowledge.remove', 'promptKnowledge', input.id, null, {
        title: row.title,
        slug: row.slug,
        source: row.source,
      });
      // 提醒:带 slug 的 SEED 条目删除后,db:sync 会按 slug 补回 — 不想要请改用停用
      return { removed: true, willReseedOnSync: !!row.slug && row.source === 'SEED' };
    }),

  /** H3 回路①:手动触发「AI→人改」蒸馏(LLM 一次调用,产出 enabled=false 候选) */
  mine: adminProcedure
    .input(z.object({ projectId: z.string().cuid().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await minePromptEditCandidates(ctx.prisma, {
          userId: ctx.user.id,
          projectId: input?.projectId,
        });
        await logOperation(ctx, 'admin.knowledge.mine', 'promptKnowledge', 'batch', null, {
          ...result,
        });
        return result;
      } catch (e) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: e instanceof Error ? e.message : '蒸馏失败',
        });
      }
    }),
});
