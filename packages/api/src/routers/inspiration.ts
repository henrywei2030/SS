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
import { loadPromptTemplate } from '@ss/core/shared';
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
{"title":"剧名","episodes":[{"number":1,"title":"集标题","synopsis":"本集梗概"}]}
⚠️严格 JSON:所有字符串值(尤其 synopsis)内严禁出现半角双引号 " — 要强调的词改用中文「」《》或不加引号,否则 JSON 解析失败。确保整段可被 JSON.parse 直接解析。`;

// 四九收工:灵感产出"正式剧本"(screenplay),格式严格对齐 parse.ts 解析器
//   场头 "集号-场号 时段 内外 地点" → 分镜模块可直接拆场,不再 fallback 成巨型场
const SCRIPT_FORMAT_SPEC = `【剧本格式】严格按此结构(每场之间空一行):
<集号>-<场号> <时段> <内外> <地点>
人物：本场出场角色(顿号分隔)
△动作/场景描述(以 △ 起头,只写镜头能拍到的画面:动作/神态/环境,不写心理)
角色名（情绪）：台词
角色名（OS）：内心独白 / 旁白
(空一行后继续下一场)

【格式细则】
- 场头:集号-场号 时段(日/夜/晨/黄昏) 内外(内/外) 地点 —— 如第 N 集第 1 场写 "N-1 夜 内 出租屋"
- 一集拆 4-7 个场,每场聚焦一个动作 / 冲突单元
- 台词:角色名（情绪）：内容;旁白 / 内心:角色名（OS）：内容

【竖屏微短剧写法】
- 开篇 3 秒抓人:第 1 场用强冲突画面 + 悬念钩住观众
- 三幕节奏:铺垫 → 冲突升级 → 反转 / 爽点
- 台词短平快(尽量一句 ≤20 字)、有爆发力、贴人设,不堆大段独白
- 结尾留钩子(悬念 / 反转),引导追下一集;竖屏以单 / 双人近景为主,冲突密集`;

const EPISODE_FALLBACK = `你是资深竖屏微短剧编剧。把"本集大纲"展开为一集可直接拍摄的正式剧本。

${SCRIPT_FORMAT_SPEC}

只输出剧本正文,不要任何解释 / markdown / 标题符号,从第一个场头(集号-场号)开始。`;

// 四九收工:"全部展开"批量 —— 多集同样产正式剧本,用 ===第N集=== 分隔便于回灌各集
const EPISODES_BATCH_FALLBACK = `你是资深竖屏微短剧编剧。把【待展开集】全部展开为可直接拍摄的正式剧本。

【输出结构】每集用单独一行 "===第N集===" 开头分隔(N=集号):
===第5集===
<本集剧本(按下方剧本格式)>
===第6集===
<...>

${SCRIPT_FORMAT_SPEC}

【多集统筹】场头集号=该集集号(第 5 集的场头是 5-1、5-2…);前后呼应、伏笔回收、人物弧光连贯。
严格只展开"待展开集"列表里的集。只输出剧本正文 + ===第N集=== 分隔,不要 JSON / markdown / 额外解释。`;

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

// 四九收工:批量展开 prompt —— 给完整大纲(供统筹)+ 只列待展开集
function buildEpisodesBatchPrompt(
  title: string,
  idea: string,
  fullOutline: OutlineEp[],
  pending: OutlineEp[],
  params: Record<string, unknown>,
): string {
  const outlineText = fullOutline
    .map((o) => `第${o.number}集:${o.title} — ${o.synopsis}`)
    .join('\n');
  const pendingNums = pending.map((p) => p.number).join('、');
  const lines = [
    `【剧名】${title}`,
    `【整体想法】${idea}`,
    params.tone ? `【整体基调】${String(params.tone)}` : '',
    `\n【完整大纲】(供前后统筹参考)\n${outlineText}`,
    `\n【待展开集】(只展开这些集,其余已展开请跳过):第 ${pendingNums} 集`,
    '\n请按 "===第N集===" 分隔格式,一次性展开以上待展开集。',
  ].filter(Boolean);
  return lines.join('\n');
}

/** 四九收工:解析批量展开输出(按 "===第N集===" 分隔,抗截断 — 只取完整段) */
function parseEpisodesBatch(text: string): Map<number, string> {
  const out = new Map<number, string>();
  if (!text?.trim()) return out;
  // 捕获分隔行的集号;split 含捕获组 → [前言, num1, body1, num2, body2, ...]
  const parts = text.split(/^\s*=+\s*第\s*(\d+)\s*集\s*=+\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const num = Number.parseInt(parts[i] ?? '', 10);
    const body = (parts[i + 1] ?? '').trim();
    if (Number.isFinite(num) && body) out.set(num, body);
  }
  return out;
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

/**
 * 漏洞审查 audit:文本生成每日预算守卫(对齐 video 链路 checkDailyVideoBudget)。
 *   查今日该 project 的 text.generate 累计成本,≥ 上限则拒新请求(返回 null=通过 / 不限)。
 *   setting `text.generate.dailyBudgetCny`(默认 0=不限)各机可在系统设置调整。
 */
async function checkTextBudget(prisma: Context['prisma'], projectId: string): Promise<string | null> {
  const raw = await loadSystemSetting(prisma, 'text.generate.dailyBudgetCny');
  const limit = Number(raw ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) return null; // 0 / 未配 / 非法 = 不限
  // UTC 0 点为"今天"边界,跟 checkDailyVideoBudget / insights 一致(DB createdAt 存 UTC)
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const spent = await prisma.costLedgerEntry.aggregate({
    where: { projectId, action: 'text.generate', success: true, createdAt: { gte: todayStart } },
    _sum: { costCny: true },
  });
  const spentDec = new Prisma.Decimal(spent._sum.costCny ?? 0);
  if (spentDec.gte(new Prisma.Decimal(limit))) {
    return `今日文本生成预算已用 ${spentDec.toFixed(2)}¥ / 上限 ${limit}¥,请明日再试或调高 text.generate.dailyBudgetCny`;
  }
  return null;
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
      const budgetDeny = await checkTextBudget(ctx.prisma, input.projectId);
      if (budgetDeny) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: budgetDeny });
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
      const system = await loadPromptTemplate('inspiration_outline', OUTLINE_FALLBACK);
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
      const budgetDeny = await checkTextBudget(ctx.prisma, draft.projectId);
      if (budgetDeny) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: budgetDeny });

      const outline = (draft.outline as unknown as OutlineEp[]) ?? [];
      const epOutline = outline.find((e) => e.number === input.episodeNumber);
      if (!epOutline) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '该集不在大纲内' });
      }

      const modelId = await resolveModelId(ctx.prisma, draft.modelId);
      const provider = await getTextProvider(modelId);
      const system = await loadPromptTemplate('inspiration_episode', EPISODE_FALLBACK);
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
      // 并发锁收口:LLM 在锁外跑;"读最新 episodes → 合并本集 → 落库"放进 advisory-lock 事务,
      //   锁内重读最新快照(LLM 调用期间别的 generate* 请求可能已写入其它集),避免老快照覆盖丢集
      const updated = await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext('insp_draft:' || $1)::bigint)`,
          draft.id,
        );
        const fresh = await tx.inspirationDraft.findUnique({
          where: { id: draft.id },
          select: { episodes: true },
        });
        const episodes = ((fresh?.episodes as unknown as DraftEp[]) ?? []).filter(
          (e) => e.number !== input.episodeNumber,
        );
        episodes.push({ number: input.episodeNumber, title: epOutline.title, content });
        episodes.sort((a, b) => a.number - b.number);
        const allDone = outline.every((o) => episodes.some((e) => e.number === o.number && e.content));
        return tx.inspirationDraft.update({
          where: { id: draft.id },
          data: {
            episodes: episodes as unknown as Prisma.InputJsonValue,
            status: allDone ? 'DONE' : 'OUTLINE_DONE',
          },
        });
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

  /**
   * 2.5 全部展开 · 生成下一块(四九收工 · 方案 B 分块,前端循环驱动)
   *   - 每次只生成"待展开集"的前 CHUNK_SIZE 集(~115s 慢模型也稳在 headersTimeout 内)
   *   - 前端循环调用本过程直到 remaining=0,每块完成更新进度条 + 刷新出新集(防卡死误判)
   *   - prompt 带【完整大纲】保连贯;跳过已展开;生成后立即落库(失败前面保住)
   *   - 返回 { generated, remaining, total } 供前端进度条 + 续跑判断
   */
  generateAllEpisodes: protectedProcedure
    .input(z.object({ draftId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const draft = await ctx.prisma.inspirationDraft.findFirst({
        where: { id: input.draftId, deletedAt: null },
      });
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: '灵感草稿不存在' });
      await assertProjectAccess(ctx, draft.projectId);
      const budgetDeny = await checkTextBudget(ctx.prisma, draft.projectId);
      if (budgetDeny) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: budgetDeny });

      const outline = (draft.outline as unknown as OutlineEp[]) ?? [];
      const existing = (draft.episodes as unknown as DraftEp[]) ?? [];
      const doneNums = new Set(existing.filter((e) => e.content?.trim()).map((e) => e.number));
      const pending = outline.filter((o) => !doneNums.has(o.number)); // #2:跳过已展开
      if (pending.length === 0) {
        return { generated: 0, remaining: 0, total: outline.length };
      }

      // 每块 2 集(~3-4k tokens)。慢模型(sonnet ~40 tok/s)单块 ~80-120s,稳在
      // headersTimeout 300s 内(四九收工:3 集曾撞 182s,降到 2 集 + 超时提 300s 双保险)
      const CHUNK_SIZE = 2;
      const chunk = pending.slice(0, CHUNK_SIZE); // 只处理本块,前端循环续跑

      const modelId = await resolveModelId(ctx.prisma, draft.modelId);
      const provider = await getTextProvider(modelId);
      const system = await loadPromptTemplate('inspiration_episodes_batch', EPISODES_BATCH_FALLBACK);
      const userPrompt = buildEpisodesBatchPrompt(
        draft.title,
        draft.idea,
        outline, // 完整大纲(连贯统筹)
        chunk, // 仅本块要写的集
        draft.params as Record<string, unknown>,
      );

      const attempt = await ctx.prisma.generationAttempt.create({
        data: {
          projectId: draft.projectId,
          providerId: modelId,
          modelId,
          action: 'TEXT',
          inputJson: {
            kind: 'inspiration.episodes_batch',
            draftId: draft.id,
            episodeNumbers: chunk.map((c) => c.number),
          },
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
          { system, prompt: userPrompt, maxTokens: 16_000, temperature: 0.8 },
          { userId: ctx.user.id, projectId: draft.projectId, attemptId: attempt.id },
        );
      } catch (e) {
        await ctx.prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: { status: 'FAILED', errorMsg: sanitizeErrorMsg(e), finishedAt: new Date() },
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `生成第 ${chunk.map((c) => c.number).join('、')} 集失败:${sanitizeErrorMsg(e)}`,
        });
      }

      // 解析本块 → 锁内重读最新 episodes → 合并 → 落库(并发安全,见 generateEpisode 同款 advisory-lock 注释)
      const parsed = parseEpisodesBatch(result.text ?? '');
      let chunkAdded = 0;
      await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext('insp_draft:' || $1)::bigint)`,
          draft.id,
        );
        const fresh = await tx.inspirationDraft.findUnique({
          where: { id: draft.id },
          select: { episodes: true },
        });
        const byNum = new Map(
          ((fresh?.episodes as unknown as DraftEp[]) ?? []).map((e) => [e.number, e] as const),
        );
        chunkAdded = 0;
        for (const o of chunk) {
          const body = parsed.get(o.number);
          if (body?.trim()) {
            byNum.set(o.number, { number: o.number, title: o.title, content: body.trim() });
            chunkAdded += 1;
          }
        }
        const episodes = [...byNum.values()].sort((a, b) => a.number - b.number);
        const allDone = outline.every((o) => episodes.some((e) => e.number === o.number && e.content));
        await tx.inspirationDraft.update({
          where: { id: draft.id },
          data: {
            episodes: episodes as unknown as Prisma.InputJsonValue,
            status: allDone ? 'DONE' : 'OUTLINE_DONE',
          },
        });
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
      await logOperation(ctx, 'inspiration.episodes_batch', 'inspirationDraft', draft.id, null, {
        chunk: chunk.map((c) => c.number),
        generated: chunkAdded,
      });
      // remaining = 本块后还剩多少未展开(前端据此续跑 + 进度条)
      const remaining = pending.length - chunkAdded;
      return { generated: chunkAdded, remaining, total: outline.length };
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
        // 大纲可人工修改(2026-06):大纲列每集 synopsis 在线编辑保存
        outline: z
          .array(
            z.object({
              number: z.number().int().positive(),
              title: z.string().max(200),
              synopsis: z.string().max(5000),
            }),
          )
          .optional(),
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
          ...(input.outline !== undefined && {
            outline: input.outline as unknown as Prisma.InputJsonValue,
          }),
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
