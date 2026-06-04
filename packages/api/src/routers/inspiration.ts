/**
 * Inspiration Router — 导演模块「灵感创作」子模块(四七收工)
 *
 * 想法 → LLM 生成多集短剧(大纲 + 各集),存 InspirationDraft 草稿(独立于 Script,未绑 episode)。
 * 草稿可下载 / 在线保存编辑,经剧本子模块"关联剧本"按钮 → script.upload(source=AI_GENERATED)转正。
 *
 * LLM 链路对齐 storyboard/script.analyze:
 *   - binding.inspiration.generation.modelId(admin/bindings 配)
 *   - prompt slug inspiration_outline / inspiration_episode(admin/prompts 管理,fallback 内置)
 *   - 写 GenerationAttempt(action=TEXT)供成本追溯;provider 内置 ledger 关联 attemptId
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getTextProvider } from '@ss/adapters/provider';
import { Prisma } from '@ss/db';
import { sanitizeErrorMsg } from '@ss/shared';

import { router, protectedProcedure } from '../trpc.js';
import type { Context } from '../context.js';
import { assertProjectAccess } from '../middleware/access.js';
import { logOperation } from '../middleware/audit.js';
import { loadSystemSetting } from '../utils/system-bindings.js';

// ---------------------------------------------------------------------------
// 类型 + fallback prompt(admin 可在 /admin/prompts 覆盖对应 slug)
// ---------------------------------------------------------------------------

interface OutlineEp {
  number: number;
  title: string;
  synopsis: string;
}
interface DraftEp {
  number: number;
  title: string;
  content: string;
}

const OUTLINE_FALLBACK = `你是资深短剧编剧。根据用户提供的"想法/灵感"和可选参数,产出一部多集竖屏短剧的分集大纲。
要求:
- 剧名简洁有钩子;每集标题 + 一句话梗概(冲突/反转/悬念)
- 集数:若用户给了目标集数就严格按它,否则默认 12 集
- 节奏紧凑,每集留钩子,符合短剧"强冲突/快反转"特征
只输出 JSON,不要任何解释或 markdown,格式:
{"title":"剧名","episodes":[{"number":1,"title":"集标题","synopsis":"本集梗概"}]}`;

const EPISODE_FALLBACK = `你是资深短剧编剧。根据剧名、整体想法和"本集大纲",把这一集展开为可直接拍摄的完整剧本。
要求:
- 用"分镜"组织:每个分镜含【画面】(场景+动作描述)、【声音】(台词/旁白/OS)
- 台词口语化、有张力,符合短剧风格;每集 6-12 个分镜
- 只写本集内容,不要写其他集
输出纯文本剧本(不要 JSON),开头用"第N集:集标题"。`;

function buildOutlinePrompt(idea: string, params: Record<string, unknown>): string {
  const lines = [`【想法/灵感】\n${idea}`];
  if (params.genre) lines.push(`【题材类型】${String(params.genre)}`);
  if (params.targetEpisodes) lines.push(`【目标集数】${String(params.targetEpisodes)} 集`);
  if (params.lengthHint) lines.push(`【篇幅基调】${String(params.lengthHint)}`);
  if (params.tone) lines.push(`【整体基调】${String(params.tone)}`);
  lines.push('\n请产出分集大纲 JSON。');
  return lines.join('\n');
}

function buildEpisodePrompt(
  title: string,
  idea: string,
  ep: OutlineEp,
  params: Record<string, unknown>,
): string {
  const lines = [
    `【剧名】${title}`,
    `【整体想法】${idea}`,
    params.tone ? `【整体基调】${String(params.tone)}` : '',
    `\n【本集大纲】第${ep.number}集:${ep.title}\n梗概:${ep.synopsis}`,
    '\n请把这一集展开为完整剧本(纯文本)。',
  ].filter(Boolean);
  return lines.join('\n');
}

// core/shared/load-prompt 未公开 export → 内联同款逻辑(DB 优先,fallback 兜底)
async function loadPrompt(
  prisma: Context['prisma'],
  slug: string,
  fallback: string,
): Promise<string> {
  try {
    const t = await prisma.promptTemplate.findFirst({
      where: { slug, isActive: true },
      orderBy: { updatedAt: 'desc' },
      select: { content: true },
    });
    if (t?.content?.trim()) return t.content;
  } catch {
    /* DB 抖动 → fallback */
  }
  return fallback;
}

/** 解析 LLM 大纲 JSON → {title, episodes[]},尽量鲁棒兜底 */
function parseOutline(json: unknown, text: string): { title: string; episodes: OutlineEp[] } {
  let obj: unknown = json;
  if (!obj && text) {
    try {
      obj = JSON.parse(text);
    } catch {
      /* 非 JSON */
    }
  }
  const rec = obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
  const rawEps = Array.isArray(rec.episodes) ? rec.episodes : [];
  const episodes: OutlineEp[] = rawEps
    .map((e, i) => {
      const er = e && typeof e === 'object' ? (e as Record<string, unknown>) : {};
      return {
        number: typeof er.number === 'number' ? er.number : i + 1,
        title: typeof er.title === 'string' ? er.title : `第${i + 1}集`,
        synopsis: typeof er.synopsis === 'string' ? er.synopsis : '',
      };
    })
    .filter((e) => e.title || e.synopsis);
  const title = typeof rec.title === 'string' && rec.title.trim() ? rec.title : '未命名灵感';
  return { title, episodes };
}

const ParamsSchema = z.object({
  genre: z.string().max(50).optional(), // 题材:都市/悬疑/古装/甜宠...
  targetEpisodes: z.number().int().min(1).max(100).optional(),
  lengthHint: z.string().max(50).optional(), // 篇幅:每集 2-3 分钟...
  tone: z.string().max(50).optional(), // 基调:轻松/虐心/爽文...
});

/** 解析 binding modelId,空则抛引导错误 */
async function resolveModelId(prisma: Context['prisma'], override?: string | null): Promise<string> {
  const modelId =
    override || (await loadSystemSetting(prisma, 'binding.inspiration.generation.modelId')) || '';
  if (!modelId) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        '灵感创作未配置 LLM Provider — 请去 /admin/bindings 选择 binding.inspiration.generation.modelId',
    });
  }
  return modelId;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const inspirationRouter = router({
  /** 1. 生成分集大纲 → 创建 InspirationDraft 草稿 */
  generateOutline: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        idea: z.string().min(1, '请输入想法/灵感').max(10_000),
        params: ParamsSchema.default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      // 需求1b:灵感草稿上限 50
      const draftCount = await ctx.prisma.inspirationDraft.count({
        where: { projectId: input.projectId, deletedAt: null },
      });
      if (draftCount >= 50) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '灵感草稿已达上限 50 个 — 请先删除一些再新建',
        });
      }
      const modelId = await resolveModelId(ctx.prisma);
      const provider = await getTextProvider(modelId);
      const system = await loadPrompt(ctx.prisma, 'inspiration_outline', OUTLINE_FALLBACK);
      const userPrompt = buildOutlinePrompt(input.idea, input.params);

      const attempt = await ctx.prisma.generationAttempt.create({
        data: {
          projectId: input.projectId,
          providerId: modelId,
          modelId,
          action: 'TEXT',
          inputJson: { kind: 'inspiration.outline', params: input.params },
          outputMediaIds: [],
          inputUnits: 0,
          outputUnits: 0,
          unitPriceCny: '0',
          costCny: '0',
          status: 'RUNNING',
          startedAt: new Date(),
          createdBy: ctx.user.id,
        },
      });

      let result;
      try {
        result = await provider.generate(
          { system, prompt: userPrompt, maxTokens: 4096, temperature: 0.8, jsonSchema: {} },
          { userId: ctx.user.id, projectId: input.projectId, attemptId: attempt.id },
        );
      } catch (e) {
        await ctx.prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: { status: 'FAILED', errorMsg: sanitizeErrorMsg(e), finishedAt: new Date() },
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `生成大纲失败:${sanitizeErrorMsg(e)}`,
        });
      }

      const parsed = parseOutline(result.json, result.text);
      if (parsed.episodes.length === 0) {
        await ctx.prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: { status: 'FAILED', errorMsg: 'LLM 未产出可解析大纲', finishedAt: new Date() },
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'LLM 未产出可解析的分集大纲,请调整想法或重试',
        });
      }

      const draft = await ctx.prisma.inspirationDraft.create({
        data: {
          projectId: input.projectId,
          title: parsed.title,
          idea: input.idea,
          params: input.params,
          outline: parsed.episodes as unknown as Prisma.InputJsonValue,
          episodes: [],
          status: 'OUTLINE_DONE',
          modelId,
          createdBy: ctx.user.id,
        },
      });

      await ctx.prisma.generationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'SUCCESS',
          costCny: result.costCny.toFixed(4),
          inputUnits: result.inputTokens,
          outputUnits: result.outputTokens,
          finishedAt: new Date(),
        },
      });
      await logOperation(ctx, 'inspiration.outline', 'inspirationDraft', draft.id, null, {
        title: parsed.title,
        episodes: parsed.episodes.length,
      });
      return draft;
    }),

  /** 2. 展开某一集大纲为完整剧本 */
  generateEpisode: protectedProcedure
    .input(z.object({ draftId: z.string().cuid(), episodeNumber: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const draft = await ctx.prisma.inspirationDraft.findFirst({
        where: { id: input.draftId, deletedAt: null },
      });
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: '灵感草稿不存在' });
      await assertProjectAccess(ctx, draft.projectId);

      const outline = (draft.outline as unknown as OutlineEp[]) ?? [];
      const epOutline = outline.find((e) => e.number === input.episodeNumber);
      if (!epOutline) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '该集不在大纲内' });
      }

      const modelId = await resolveModelId(ctx.prisma, draft.modelId);
      const provider = await getTextProvider(modelId);
      const system = await loadPrompt(ctx.prisma, 'inspiration_episode', EPISODE_FALLBACK);
      const userPrompt = buildEpisodePrompt(
        draft.title,
        draft.idea,
        epOutline,
        draft.params as Record<string, unknown>,
      );

      const attempt = await ctx.prisma.generationAttempt.create({
        data: {
          projectId: draft.projectId,
          providerId: modelId,
          modelId,
          action: 'TEXT',
          inputJson: { kind: 'inspiration.episode', draftId: draft.id, episodeNumber: input.episodeNumber },
          outputMediaIds: [],
          inputUnits: 0,
          outputUnits: 0,
          unitPriceCny: '0',
          costCny: '0',
          status: 'RUNNING',
          startedAt: new Date(),
          createdBy: ctx.user.id,
        },
      });

      let result;
      try {
        result = await provider.generate(
          { system, prompt: userPrompt, maxTokens: 8192, temperature: 0.8 },
          { userId: ctx.user.id, projectId: draft.projectId, attemptId: attempt.id },
        );
      } catch (e) {
        await ctx.prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: { status: 'FAILED', errorMsg: sanitizeErrorMsg(e), finishedAt: new Date() },
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `生成第${input.episodeNumber}集失败:${sanitizeErrorMsg(e)}`,
        });
      }

      const content = result.text?.trim() || '';
      const episodes = ((draft.episodes as unknown as DraftEp[]) ?? []).filter(
        (e) => e.number !== input.episodeNumber,
      );
      episodes.push({ number: input.episodeNumber, title: epOutline.title, content });
      episodes.sort((a, b) => a.number - b.number);
      const allDone = outline.every((o) => episodes.some((e) => e.number === o.number && e.content));

      const updated = await ctx.prisma.inspirationDraft.update({
        where: { id: draft.id },
        data: {
          episodes: episodes as unknown as Prisma.InputJsonValue,
          status: allDone ? 'DONE' : 'OUTLINE_DONE',
        },
      });
      await ctx.prisma.generationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'SUCCESS',
          costCny: result.costCny.toFixed(4),
          inputUnits: result.inputTokens,
          outputUnits: result.outputTokens,
          finishedAt: new Date(),
        },
      });
      await logOperation(ctx, 'inspiration.episode', 'inspirationDraft', draft.id, null, {
        episodeNumber: input.episodeNumber,
      });
      return updated;
    }),

  /** 3. 列出项目的灵感草稿 */
  listDrafts: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        // 需求1e:剧本「关联剧本」只列顶置草稿
        pinnedOnly: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      return ctx.prisma.inspirationDraft.findMany({
        where: {
          projectId: input.projectId,
          deletedAt: null,
          ...(input.pinnedOnly ? { pinned: true } : {}),
        },
        // 需求1d:顶置优先,其次按更新时间
        orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          title: true,
          idea: true,
          status: true,
          pinned: true,
          outline: true,
          episodes: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }),

  /** 需求1d:切换顶置(最满意标记)— 只有顶置草稿能在剧本「关联剧本」选用 */
  togglePin: protectedProcedure
    .input(z.object({ draftId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const draft = await ctx.prisma.inspirationDraft.findFirst({
        where: { id: input.draftId, deletedAt: null },
        select: { id: true, projectId: true, pinned: true },
      });
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: '灵感草稿不存在' });
      await assertProjectAccess(ctx, draft.projectId);
      const updated = await ctx.prisma.inspirationDraft.update({
        where: { id: draft.id },
        data: { pinned: !draft.pinned },
        select: { id: true, pinned: true },
      });
      return updated;
    }),

  /** 4. 单个草稿详情(含各集内容) */
  getDraft: protectedProcedure
    .input(z.object({ draftId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const draft = await ctx.prisma.inspirationDraft.findFirst({
        where: { id: input.draftId, deletedAt: null },
      });
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: '灵感草稿不存在' });
      await assertProjectAccess(ctx, draft.projectId);
      return draft;
    }),

  /** 5. 在线保存编辑(改剧名 / 手动改某集内容) */
  updateDraft: protectedProcedure
    .input(
      z.object({
        draftId: z.string().cuid(),
        title: z.string().min(1).max(200).optional(),
        episodes: z
          .array(
            z.object({
              number: z.number().int().positive(),
              title: z.string().max(200),
              content: z.string().max(200_000),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const draft = await ctx.prisma.inspirationDraft.findFirst({
        where: { id: input.draftId, deletedAt: null },
        select: { id: true, projectId: true },
      });
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: '灵感草稿不存在' });
      await assertProjectAccess(ctx, draft.projectId);
      const updated = await ctx.prisma.inspirationDraft.update({
        where: { id: draft.id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.episodes !== undefined && {
            episodes: input.episodes as unknown as Prisma.InputJsonValue,
          }),
        },
      });
      return updated;
    }),

  /** 6. 软删草稿 */
  deleteDraft: protectedProcedure
    .input(z.object({ draftId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const draft = await ctx.prisma.inspirationDraft.findFirst({
        where: { id: input.draftId, deletedAt: null },
        select: { id: true, projectId: true, title: true },
      });
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: '灵感草稿不存在' });
      await assertProjectAccess(ctx, draft.projectId);
      await ctx.prisma.inspirationDraft.update({
        where: { id: draft.id },
        data: { deletedAt: new Date() },
      });
      await logOperation(ctx, 'inspiration.delete', 'inspirationDraft', draft.id, {
        title: draft.title,
      }, null);
      return { id: draft.id, success: true };
    }),
});
