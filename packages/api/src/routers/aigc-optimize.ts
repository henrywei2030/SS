/**
 * AIGC Router — M6 动态 Prompt 优化(蓝图 docs/06 §5)。
 *   optimizeGroupPrompt(单组同步,编辑区即点即得)/ optimizeEpisodePrompts(整集后台 job)
 *
 * 分层:core optimizeGroupPrompt 返判别(NO_BINDING/EMPTY_PROMPT/TOKEN_LOST/EMPTY_OUTPUT),
 * 本层映射 TRPCError + 单点写回(applyOptimizedPrompt:normalize + PromptEdit [AI优化]
 * 标记 + prompt.optimize 记账)。binding 留空 = 功能关闭,静态编译链零影响。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  applyOptimizedPrompt,
  checkTextBudgetForOptimize,
  loadOptimizeContext,
  optimizeGroupPrompt as coreOptimize,
  recordOptimizeRun,
  OPTIMIZE_EPISODE_JOB_KIND,
  type OptimizeEpisodeJobData,
} from '@ss/core/prompt-optimizer';
import { enqueueJob } from '@ss/queue/job-queue';

import { protectedProcedure, rateLimit } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';
import { loadEpisodeOrThrow } from '../middleware/access.js';
import { loadSystemSetting } from '../utils/system-bindings.js';

import { loadGroupOrThrow } from './aigc-shared.js';

export const optimizeProcedures = {
  /**
   * 单组优化(同步)— 即点即得,写回 ShotGroup.prompt(人可审可改,可再编辑)。
   * 乐观锁:优化期间用户手改提示词 → 保留人工版本,优化结果作废(CONFLICT 提示)。
   */
  optimizeGroupPrompt: protectedProcedure
    .meta({
      agentTool: {
        description: '用 LLM 优化一个分镜组的视频提示词(按目标视频模型风格自适应,写回组提示词)',
        sideEffects: ['db.update:ShotGroup.prompt', 'cost.deduct', 'extern.api:LLM'],
        costEstimateCny: 0.1,
        requireConfirm: false,
      },
    })
    .use(
      rateLimit({
        key: (ctx) => `aigc.optimizePrompt:${ctx.user?.id ?? 'anon'}`,
        max: 10,
        windowMs: 60_000,
        message: '提示词优化过快(每分钟最多 10 次)— 请等等再试',
      }),
    )
    .input(z.object({ groupId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);
      const budgetDeny = await checkTextBudgetForOptimize(ctx.prisma, grp.episode.projectId);
      if (budgetDeny) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: budgetDeny });
      }
      const targetProviderId = await loadSystemSetting(
        ctx.prisma,
        'binding.shot.video.providerId',
      );

      const optimizeCtx = await loadOptimizeContext(ctx.prisma, {
        group: {
          id: grp.id,
          number: grp.number,
          prompt: grp.prompt,
          durationS: grp.durationS,
          episodeId: grp.episodeId,
          projectId: grp.episode.projectId,
          positionIdx: grp.positionIdx,
        },
        userId: ctx.user.id,
        targetProviderId,
      });
      const outcome = await coreOptimize(ctx.prisma, {
        ctx: optimizeCtx,
        userId: ctx.user.id,
        projectId: grp.episode.projectId,
        episodeId: grp.episodeId,
      });
      // H2:体检报告落库口径 — 同步路 stages 只有 composer(判官/修复在后台深度路)
      const runBase = {
        groupId: grp.id,
        episodeId: grp.episodeId,
        projectId: grp.episode.projectId,
        userId: ctx.user.id,
        fragmentIds: optimizeCtx.usedKnowledgeFragmentIds ?? [],
        dimScores: null,
        iterations: 0,
      };
      if (!outcome.ok) {
        await recordOptimizeRun(ctx.prisma, {
          ...runBase,
          stages:
            (outcome.costCny ?? 0) > 0
              ? [{ stage: 'composer', modelId: '', inputTokens: 0, outputTokens: 0, costCny: outcome.costCny ?? 0 }]
              : [],
          applied: false,
          denyCode: outcome.code,
          totalCostCny: outcome.costCny ?? 0,
        });
        if (outcome.code === 'NO_BINDING') {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: outcome.message });
        }
        if (outcome.code === 'EMPTY_PROMPT') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: outcome.message });
        }
        // TOKEN_LOST / EMPTY_OUTPUT / HARD_GATE:钱已花(provider 已调),rawOutput 留服务端日志查
        console.warn(
          `[aigc.optimizeGroupPrompt] ${outcome.code} group=${grp.number}:`,
          outcome.code === 'TOKEN_LOST' || outcome.code === 'HARD_GATE'
            ? outcome.rawOutput?.slice(0, 500)
            : outcome.message,
        );
        throw new TRPCError({ code: 'UNPROCESSABLE_CONTENT', message: outcome.message });
      }

      const applied = await applyOptimizedPrompt(ctx.prisma, {
        groupId: grp.id,
        before: grp.prompt,
        optimized: outcome.optimized,
        userId: ctx.user.id,
        modelId: outcome.modelId,
        projectId: grp.episode.projectId,
        episodeId: grp.episodeId,
        contributorsUsed: outcome.contributorsUsed,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        costCny: outcome.costCny,
      });
      await recordOptimizeRun(ctx.prisma, {
        ...runBase,
        stages: [
          {
            stage: 'composer',
            modelId: outcome.modelId,
            inputTokens: outcome.inputTokens,
            outputTokens: outcome.outputTokens,
            costCny: outcome.costCny,
          },
        ],
        applied: applied.applied,
        denyCode: applied.applied ? null : 'PROMPT_CHANGED',
        totalCostCny: outcome.costCny,
      });
      if (!applied.applied) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '优化期间提示词被修改 — 已保留你的人工版本(本次优化费用已计,结果作废)',
        });
      }

      await logOperation(ctx, 'aigc.optimizeGroupPrompt', 'shotGroup', grp.id, null, {
        groupNumber: grp.number,
        episodeId: grp.episodeId,
        projectId: grp.episode.projectId,
        modelId: outcome.modelId,
        contributorsUsed: outcome.contributorsUsed,
        changed: applied.changed,
        cost: outcome.costCny,
      });

      return {
        prompt: applied.normalized,
        changed: applied.changed,
        modelId: outcome.modelId,
        contributorsUsed: outcome.contributorsUsed,
        costCny: outcome.costCny,
      };
    }),

  /**
   * 整集优化(后台 job)— N 组 × LLM 数秒不占 HTTP,完成后铃铛+webhook 通知。
   */
  optimizeEpisodePrompts: protectedProcedure
    .use(
      rateLimit({
        key: (ctx) => `aigc.optimizeEpisode:${ctx.user?.id ?? 'anon'}`,
        max: 2,
        windowMs: 60_000,
        message: '整集优化请求过快(每分钟 2 次)— 上一单完成会有铃铛通知',
      }),
    )
    .input(z.object({ episodeId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId);
      // 前置三查:binding 配了 / 预算没打满 / 有可优化组 — 都不过就别入队空跑
      const binding = await loadSystemSetting(ctx.prisma, 'binding.storyboard.prompt.modelId');
      if (!binding?.trim()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            '提示词优化未配置 LLM — 去 /admin/bindings 选 binding.storyboard.prompt.modelId',
        });
      }
      const budgetDeny = await checkTextBudgetForOptimize(ctx.prisma, ep.projectId);
      if (budgetDeny) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: budgetDeny });
      }
      const candidates = await ctx.prisma.shotGroup.count({
        where: { episodeId: ep.id, deletedAt: null, prompt: { not: '' } },
      });
      if (candidates === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '本集没有带提示词的分镜组,先去导演工作台生成分镜',
        });
      }

      const jobData: OptimizeEpisodeJobData = {
        episodeId: ep.id,
        projectId: ep.projectId,
        userId: ctx.user.id,
        ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
      };
      try {
        await enqueueJob(OPTIMIZE_EPISODE_JOB_KIND, jobData, {
          // 幂等键:同集同时只跑一单(bullmq jobId 去重;in-process 无队列态不去重)
          jobId: `optimize-prompts:${ep.id}`,
        });
      } catch (e) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '整集优化任务入队失败,请稍后重试',
          cause: e,
        });
      }

      await logOperation(ctx, 'aigc.optimizeEpisodePrompts', 'episode', ep.id, null, {
        projectId: ep.projectId,
        candidates,
      });
      return { enqueued: true, candidates };
    }),

  /**
   * H2「✨✨深度优化」(单组后台 job)— Composer→硬门→判官→定向 Repair≤2,完成铃铛通知。
   * 与整集共用 kind optimize-prompts(payload.groupId 锁定单组),jobId 按组去重。
   */
  deepOptimizeGroupPrompt: protectedProcedure
    .use(
      rateLimit({
        key: (ctx) => `aigc.deepOptimize:${ctx.user?.id ?? 'anon'}`,
        max: 6,
        windowMs: 60_000,
        message: '深度优化请求过快(每分钟 6 次)— 完成会有铃铛通知',
      }),
    )
    .input(z.object({ groupId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);
      const binding = await loadSystemSetting(ctx.prisma, 'binding.storyboard.prompt.modelId');
      if (!binding?.trim()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            '提示词优化未配置 LLM — 去 /admin/bindings 选 binding.storyboard.prompt.modelId',
        });
      }
      if (!grp.prompt.trim()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '提示词为空 — 先生成或手编再优化' });
      }
      const budgetDeny = await checkTextBudgetForOptimize(ctx.prisma, grp.episode.projectId);
      if (budgetDeny) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: budgetDeny });
      }
      const jobData: OptimizeEpisodeJobData = {
        episodeId: grp.episodeId,
        projectId: grp.episode.projectId,
        userId: ctx.user.id,
        groupId: grp.id,
        ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
      };
      try {
        await enqueueJob(OPTIMIZE_EPISODE_JOB_KIND, jobData, {
          jobId: `optimize-prompts:group:${grp.id}`,
        });
      } catch (e) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '深度优化任务入队失败,请稍后重试',
          cause: e,
        });
      }
      await logOperation(ctx, 'aigc.deepOptimizeGroupPrompt', 'shotGroup', grp.id, null, {
        groupNumber: grp.number,
        episodeId: grp.episodeId,
        projectId: grp.episode.projectId,
      });
      return { enqueued: true };
    }),

  /**
   * H2 八维体检卡:本组最近一次优化 run(评分/阶段/轮数/费用)。
   */
  getLatestOptimizeRun: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await loadGroupOrThrow(ctx, input.groupId, { skipLockCheck: true });
      const run = await ctx.prisma.promptOptimizeRun.findFirst({
        where: { groupId: input.groupId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          stagesJson: true,
          dimScoresJson: true,
          fragmentIds: true,
          iterations: true,
          applied: true,
          denyCode: true,
          totalCostCny: true,
          createdAt: true,
        },
      });
      if (!run) return null;
      return { ...run, totalCostCny: Number(run.totalCostCny) };
    }),
};
