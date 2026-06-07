/**
 * Script Router — 分析组(latestAnalysis / latestProjectAnalysis / analyzeProject /
 *   analyze)。
 *
 * 机械重构(ADR-31):从 script.ts 按逻辑组拆出,纯搬运无行为变化。
 *   跨组共用 helper 见 script-shared.ts。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

// 第 18 轮 audit P1:LLM 失败错误信息脱敏入库
import { sanitizeErrorMsg } from '@ss/shared';

import { protectedProcedure } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';
// 三十一收工 S3:SystemSetting 单 key 读 helper
import { loadSystemSetting } from '../utils/system-bindings.js';

// W7+ audit R10:assertProjectAccess 抽到 middleware/access.ts
import { assertProjectAccess } from '../middleware/access.js';

import { loadScriptWithAccess } from './script-shared.js';

export const analyzeProcedures = {
  /** 取最新单集分析结果 */
  latestAnalysis: protectedProcedure
    .input(z.object({ scriptId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const script = await loadScriptWithAccess(ctx, input.scriptId);
      return ctx.prisma.scriptAnalysis.findFirst({
        where: { scriptId: script.id, scope: 'EPISODE' },
        orderBy: { createdAt: 'desc' },
      });
    }),

  /**
   * [W6 预留] 取本项目最新整剧批量分析
   *
   * 返回 ScriptAnalysis(scope=PROJECT) 最新一条,含 8 维均值 + perEpisodeStats + comparisonJson。
   * 当前 W3 阶段没有数据,UI 拿到 null 即可显示"尚未做过整剧分析"。
   */
  latestProjectAnalysis: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      return ctx.prisma.scriptAnalysis.findFirst({
        where: { projectId: input.projectId, scope: 'PROJECT' },
        orderBy: { createdAt: 'desc' },
      });
    }),

  /**
   * [W6 预留] 整剧批量分析 — 占位实现
   *
   * 真实实现需要异步 worker(BullMQ / pg-boss):
   *   1. 取本项目所有 isCurrent=true 的 Script
   *   2. 并发跑 LLM(限流 3)生成每集 analysis(scope=EPISODE)
   *   3. 聚合各集分数 + 写 ScriptAnalysis(scope=PROJECT,带 perEpisodeStats + comparisonJson)
   *   4. 触发 EVENTS.SCRIPT_BATCH_ANALYSIS_DONE(尚未定义)
   *
   * 现在直接返回 NOT_IMPLEMENTED + 占位 jobId,等 W6 worker 落地。
   * Schema 已就位(scope/projectId/episodeIds/perEpisodeStats/comparisonJson)。
   */
  analyzeProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        episodeIds: z.array(z.string().cuid()).optional(),
        modelId: z.string().default('claude-sonnet-4-5'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      // [W6] 这里要 enqueue 一个异步任务。当前返回 placeholder。
      void input.episodeIds;
      void input.modelId;
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: '整剧批量分析(W6)尚未上线 — 后端 worker + LLM 并发限流待实现',
      });
    }),

  /**
   * 发起分析 — 对指定 scriptId 调 Claude（W2.7 逻辑保留）
   *
   * W1-W5 audit P1 followup(P1-4):modelId 优先级
   *   1. input.modelId(前端显式传)
   *   2. SystemSetting `binding.script.analysis.modelId`(admin 后台可改)
   *   3. 'claude-sonnet-4-5' 兜底
   *  原版直接默认 'claude-sonnet-4-5',绕过 binding,admin 改 binding 不生效。
   */
  analyze: protectedProcedure
    // 第 20 轮 audit / ADR-27:剧本分析 LLM 调用(8 维评分),Mastra agent 需看预算
    .meta({
      agentTool: {
        description: '调 LLM 对剧本做 8 维分析(剧情/角色/节奏/对白/...)+ overallScore',
        sideEffects: [
          'extern.api:TextProvider',
          'cost.deduct',
          'db.create:GenerationAttempt',
          'db.create:ScriptAnalysis',
        ],
        costEstimateCny: 0.5,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        scriptId: z.string().cuid(),
        modelId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const script = await ctx.prisma.script.findFirst({
        where: { id: input.scriptId, deletedAt: null },
        include: { episode: true },
      });
      if (!script) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertProjectAccess(ctx, script.projectId);

      // P1-4:从 binding 读 modelId(input 优先 > binding,无硬编码兜底)
      // 二十收工后用户反馈:不 hardcode 任何默认 provider,binding 空时显式拒绝
      let modelId = input.modelId;
      if (!modelId) {
        modelId = (await loadSystemSetting(ctx.prisma, 'binding.script.analysis.modelId')) ?? '';
      }
      if (!modelId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '剧本分析未配置 LLM Provider — 请去 /admin/bindings 选择 binding.script.analysis.modelId(或在调用时传 input.modelId 显式指定)',
        });
      }

      const { analyzeScript } = await import('@ss/core/script');

      // W1-W5 audit P0(B1):写 GenerationAttempt(action=ANALYSIS),回溯 ROI / PromptEdit 用
      const attemptStartedAt = new Date();
      const attempt = await ctx.prisma.generationAttempt.create({
        data: {
          projectId: script.projectId,
          episodeId: script.episodeId,
          providerId: modelId,
          modelId: modelId,
          action: 'ANALYSIS',
          inputJson: {
            kind: 'script.analyze',
            scriptId: input.scriptId,
            episodeNumber: script.episode?.number ?? 1,
            textLength: script.content.length,
          },
          outputMediaIds: [],
          inputUnits: 0,
          outputUnits: 0,
          unitPriceCny: '0',
          costCny: '0',
          status: 'RUNNING',
          startedAt: attemptStartedAt,
          createdBy: ctx.user.id,
        },
      });

      try {
        const result = await analyzeScript({
          scriptText: script.content,
          episodeNumber: script.episode?.number ?? 1,
          modelId,
          ctx: {
            userId: ctx.user.id,
            projectId: script.projectId,
            episodeId: script.episodeId ?? undefined,
            attemptId: attempt.id,
          },
        });

        const toJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

        const analysis = await ctx.prisma.scriptAnalysis.create({
          data: {
            scriptId: input.scriptId,
            episodeId: script.episodeId,
            modelId,
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

        const finishedAt = new Date();
        await ctx.prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'SUCCESS',
            costCny: result.cost.toFixed(4),
            finishedAt,
            durationMs: finishedAt.getTime() - attemptStartedAt.getTime(),
          },
        });

        await logOperation(ctx, 'script.analyze.complete', 'script', script.id, null, {
          analysisId: analysis.id,
          overallScore: result.scores.overallScore,
          cost: result.cost,
          projectId: script.projectId,
        });

        return { analysis, status: 'done' };
      } catch (e) {
        const finishedAt = new Date();
        // 第 18 轮 audit P1:errMsg 入 attempt.errorMsg 前脱敏
        console.error('[script.analyze] LLM failed (raw):', e);
        const errMsg = sanitizeErrorMsg(e);
        await ctx.prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'FAILED',
            errorMsg: errMsg,
            finishedAt,
            durationMs: finishedAt.getTime() - attemptStartedAt.getTime(),
          },
        });
        await logOperation(ctx, 'script.analyze.failed', 'script', script.id, null, {
          error: errMsg,
          projectId: script.projectId,
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: errMsg || '剧本分析失败',
          cause: e, // W7 audit R9
        });
      }
    }),
};
