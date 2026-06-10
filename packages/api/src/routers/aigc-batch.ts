/**
 * AIGC Router — F4 整集批量生成(蓝图 docs/06 §M4)。
 *   estimateBatchForEpisode / batchGenerateForEpisode / cancelQueuedForEpisode
 *
 * 设计:
 *   - 「待生成」= 有提示词 && 无未拒成功 take && 无 inflight 的组
 *   - 排序:组内最高 Shot.priority(S>A>B>C)→ 回退 ScriptAnalysis.productionPlan
 *     场级优先级 → 同级按首镜剧本顺序(纯函数 core/video-generation/batch.ts,单测覆盖)
 *   - 成本确认强制闭环:estimate 给总额 → 前端弹窗确认 → mutation 带 confirmTotalCny
 *     回传,服务端**重估比对**(±0.01/组容差),报价过期(组集/价格变了)拒绝防陈旧确认
 *   - 提交循环走 submitVideoGeneration 单一真相源(与单点生成完全同链);
 *     BUDGET_EXCEEDED 拒绝时提前止损(后续组必然同拒,省 N 次占位+退款空转)
 *   - 取消:只摘 BullMQ 等待中的 job(waiting/delayed/prioritized)→ CANCELLED + 退
 *     PREPAY;已在跑的不动(RUNNING 取消留 W5-L6)。in-process 驱动无排队窗口,返 0。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getVideoProvider } from '@ss/adapters/provider';
import {
  BATCH_GROUP_PREFIX,
  batchDurationS,
  loadVideoGenBindings,
  orderBatchCandidates,
  parseProductionPlanPriorities,
  refundPrepayForAttempt,
  submitVideoGeneration,
  type BatchGroupCandidate,
  type BatchPriority,
} from '@ss/core/video-generation';
import { getVideoGenQueue } from '@ss/queue/video-gen';
import { getProgressBus } from '@ss/queue/progress-bus';

import { protectedProcedure, rateLimit } from '../trpc.js';
import type { Context } from '../context.js';
import { logOperation } from '../middleware/audit.js';
import { loadEpisodeOrThrow } from '../middleware/access.js';

/** estimate 与 batch 提交间的报价容差(每组 ±1 分,防浮点/价格微调误杀确认) */
const CONFIRM_TOLERANCE_PER_GROUP_CNY = 0.01;

interface BatchPlan {
  projectId: string;
  providerId: string;
  bindings: Awaited<ReturnType<typeof loadVideoGenBindings>>;
  /** 已按优先级排序的待生成组 */
  ordered: Array<BatchGroupCandidate & { estimateCny: number; clampedDurationS: number }>;
  totalCny: number;
}

/**
 * 推导「待生成组 + 优先级排序 + 逐组预估」— estimate 与提交共用同一推导,
 * 保证确认弹窗看到的就是要花的(验收:预估 vs 实扣偏差 <10%)。
 */
async function deriveBatchPlan(ctx: Context, episodeId: string): Promise<BatchPlan> {
  // 集锁默认检查:分镜重生成中不许批量抽卡(基于将被覆盖的快照烧钱)
  const ep = await loadEpisodeOrThrow(ctx, episodeId);
  const bindings = await loadVideoGenBindings(ctx.prisma);
  if (!bindings.providerId) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        '视频生成未配置 Video Provider — 请去 /admin/bindings 选择 binding.shot.video.providerId 后再批量生成',
    });
  }

  const groups = await ctx.prisma.shotGroup.findMany({
    where: { episodeId: ep.id, deletedAt: null },
    select: { id: true, number: true, prompt: true, durationS: true },
  });
  const groupIds = groups.map((g) => g.id);

  // 组态聚合:未拒成功 / inflight(口径同 listGroups takeStats)
  const attempts = groupIds.length
    ? await ctx.prisma.generationAttempt.findMany({
        where: {
          shotGroupId: { in: groupIds },
          action: 'VIDEO',
          rejected: false,
          status: { in: ['SUCCESS', 'QUEUED', 'RUNNING'] },
        },
        select: { shotGroupId: true, status: true },
      })
    : [];
  const hasSuccess = new Set<string>();
  const hasInflight = new Set<string>();
  for (const a of attempts) {
    if (!a.shotGroupId) continue;
    if (a.status === 'SUCCESS') hasSuccess.add(a.shotGroupId);
    else hasInflight.add(a.shotGroupId);
  }

  // 组内 shot:首镜顺序 + 最高优先级 + 首镜场(plan 回退用)
  const shots = await ctx.prisma.shot.findMany({
    where: { episodeId: ep.id, deletedAt: null, groupId: { not: null } },
    select: { groupId: true, positionIdx: true, priority: true, sceneId: true },
    orderBy: { positionIdx: 'asc' },
  });
  const PRIO_ORDER: Record<BatchPriority, number> = { S: 0, A: 1, B: 2, C: 3 };
  const firstShotPos = new Map<string, number>();
  const firstShotScene = new Map<string, string>();
  const bestPriority = new Map<string, BatchPriority>();
  for (const s of shots) {
    if (!s.groupId) continue;
    if (!firstShotPos.has(s.groupId)) {
      firstShotPos.set(s.groupId, s.positionIdx);
    }
    // 深审修:场回退锚点取「组内第一个带 sceneId 的镜」— 原实现绑死首镜,首镜无场时
    // 即使后续镜有场也放弃回退
    if (s.sceneId && !firstShotScene.has(s.groupId)) {
      firstShotScene.set(s.groupId, s.sceneId);
    }
    if (s.priority) {
      const cur = bestPriority.get(s.groupId);
      if (!cur || PRIO_ORDER[s.priority] < PRIO_ORDER[cur]) {
        bestPriority.set(s.groupId, s.priority);
      }
    }
  }

  // productionPlan 回退:sceneIdx(1 基)→ priority。
  // 深审修:ordinal 从 Scene.number("1-3" → 3)解析而非数组下标 — number 在剧本解析时
  // 固化、删场不重排,与分析时的 sceneIdx 天然对齐;下标法在 deleteScene 后整体错位。
  const scenes = await ctx.prisma.scene.findMany({
    where: { episodeId: ep.id, deletedAt: null },
    select: { id: true, number: true },
    orderBy: { positionIdx: 'asc' },
  });
  const sceneOrdinal = new Map<string, number>();
  scenes.forEach((s, i) => {
    const m = /-(\d+)\s*$/.exec(s.number);
    const n = m ? Number(m[1]) : NaN;
    sceneOrdinal.set(s.id, Number.isInteger(n) && n > 0 ? n : i + 1);
  });
  const analysis = await ctx.prisma.scriptAnalysis.findFirst({
    where: { episodeId: ep.id, scope: 'EPISODE' },
    orderBy: { createdAt: 'desc' },
    select: { productionPlan: true },
  });
  const planPrio = parseProductionPlanPriorities(analysis?.productionPlan);

  const candidates: BatchGroupCandidate[] = groups
    .filter(
      (g) => g.prompt.trim().length > 0 && !hasSuccess.has(g.id) && !hasInflight.has(g.id),
    )
    .map((g) => {
      const sceneId = firstShotScene.get(g.id);
      const ordinal = sceneId ? sceneOrdinal.get(sceneId) : undefined;
      return {
        groupId: g.id,
        number: g.number,
        durationS: g.durationS,
        firstShotPos: firstShotPos.get(g.id) ?? Number.MAX_SAFE_INTEGER,
        bestShotPriority: bestPriority.get(g.id) ?? null,
        scenePlanPriority: (ordinal !== undefined ? planPrio.get(ordinal) : undefined) ?? null,
      };
    });

  // 逐组预估(与 submit 的 PREPAY 同公式:provider.estimateCost × clamp 后时长)
  const provider = await getVideoProvider(bindings.providerId);
  const ordered = orderBatchCandidates(candidates).map((c) => {
    const clampedDurationS = batchDurationS(c.durationS, bindings.maxDurationS);
    return {
      ...c,
      clampedDurationS,
      estimateCny: provider.estimateCost({
        prompt: '',
        durationS: clampedDurationS,
        aspectRatio: bindings.defaultAspectRatio,
      }),
    };
  });
  const totalCny = ordered.reduce((s, c) => s + c.estimateCny, 0);

  return { projectId: ep.projectId, providerId: bindings.providerId, bindings, ordered, totalCny };
}

export const batchProcedures = {
  /**
   * 批量预估(确认弹窗数据源)— 只读不占位不扣费。
   */
  estimateBatchForEpisode: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const plan = await deriveBatchPlan(ctx, input.episodeId);
      return {
        providerId: plan.providerId,
        aspectRatio: plan.bindings.defaultAspectRatio,
        generateAudio: plan.bindings.defaultGenerateAudio,
        dailyBudgetCny: plan.bindings.dailyBudgetCny,
        totalCny: plan.totalCny,
        groups: plan.ordered.map((c) => ({
          groupId: c.groupId,
          number: c.number,
          durationS: c.clampedDurationS,
          priority: c.bestShotPriority ?? c.scenePlanPriority,
          estimateCny: c.estimateCny,
        })),
      };
    }),

  /**
   * 整集批量生成 — 按优先级逐组走 submitVideoGeneration(单一真相源)。
   * confirmTotalCny 强制确认闭环:与服务端重估差超容差(组数×0.01)= 报价过期,拒。
   */
  batchGenerateForEpisode: protectedProcedure
    .meta({
      agentTool: {
        description: '整集批量抽卡:把本集所有待生成分镜组按优先级依次入队生成视频(真实扣费,量大)',
        sideEffects: [
          'queue.enqueue:VideoGenJob*N',
          'db.create:GenerationAttempt*N',
          'cost.deduct',
          'extern.api:VideoProvider',
        ],
        costEstimateCny: 50,
        requireConfirm: true,
      },
    })
    // 批量本身限频(单点 generateVideo 另有 10/min;批量一次就是整集,2/min 足够)
    .use(
      rateLimit({
        key: (ctx) => `aigc.batchGenerate:${ctx.user?.id ?? 'anon'}`,
        max: 2,
        windowMs: 60_000,
        // 深审修(P2):原文案"等上一批入队完成"在 CONFLICT 重试场景误导(没有批在跑)
        message: '批量生成确认过于频繁(每分钟 2 次)— 稍候再试',
      }),
    )
    .input(
      z.object({
        episodeId: z.string().cuid(),
        /** 确认弹窗看到的总额 — 服务端重估比对,防陈旧报价被确认 */
        confirmTotalCny: z.number().min(0),
        /** 深审修(P2):弹窗里看到的组集 — 总额比对挡不住「等额换组」,组集必须逐一致 */
        confirmGroupIds: z.array(z.string().cuid()).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = await deriveBatchPlan(ctx, input.episodeId);
      if (plan.ordered.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '本集没有待生成的分镜组(有提示词且无成功 take / 无进行中任务)',
        });
      }
      // 确认闭环双比对:组集(防等额换组) + 总额(防同组集价格变化)
      const planIdsKey = plan.ordered.map((c) => c.groupId).sort().join(',');
      const confirmIdsKey = Array.from(new Set(input.confirmGroupIds)).sort().join(',');
      if (planIdsKey !== confirmIdsKey) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '待生成组集已变化(有组刚出片/新增/删除)— 请重新打开确认弹窗',
        });
      }
      const tolerance = CONFIRM_TOLERANCE_PER_GROUP_CNY * plan.ordered.length;
      if (Math.abs(plan.totalCny - input.confirmTotalCny) > tolerance) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `报价已变化(确认 ¥${input.confirmTotalCny.toFixed(2)} ≠ 当前 ¥${plan.totalCny.toFixed(2)})— 待生成组或价格有更新,请重新打开确认弹窗`,
        });
      }

      const batchId = `batch_${crypto.randomUUID()}`;
      const submitted: Array<{ groupId: string; number: string; attemptId: string }> = [];
      const denied: Array<{ groupId: string; number: string; code: string; message: string }> = [];
      const skipped: Array<{ groupId: string; number: string }> = [];

      for (let i = 0; i < plan.ordered.length; i++) {
        const c = plan.ordered[i]!;
        const grp = await ctx.prisma.shotGroup.findFirst({
          where: { id: c.groupId, deletedAt: null },
          select: {
            id: true,
            number: true,
            prompt: true,
            durationS: true,
            episodeId: true,
            episode: { select: { projectId: true } },
          },
        });
        if (!grp) {
          denied.push({ groupId: c.groupId, number: c.number, code: 'NOT_FOUND', message: '组已删除' });
          continue;
        }
        const result = await submitVideoGeneration(ctx.prisma, {
          group: {
            id: grp.id,
            number: grp.number,
            prompt: grp.prompt,
            durationS: grp.durationS,
            episodeId: grp.episodeId,
            projectId: grp.episode.projectId,
          },
          userId: ctx.user.id,
          providerId: plan.providerId,
          durationS: c.clampedDurationS,
          aspectRatio: plan.bindings.defaultAspectRatio,
          wantAudio: plan.bindings.defaultGenerateAudio,
          dailyBudgetCny: plan.bindings.dailyBudgetCny,
          requireComplianceForVideo: plan.bindings.requireComplianceForVideo,
          requestId: ctx.requestId,
          attemptGroupId: batchId,
        });
        if (result.ok) {
          submitted.push({ groupId: grp.id, number: grp.number, attemptId: result.attemptId });
        } else {
          denied.push({ groupId: grp.id, number: grp.number, code: result.code, message: result.message });
          // 预算打满提前止损(省 N 次占位+退款空转)。保守取舍(深审 F-6 记账):各组估价
          // 不等时,剩余预算可能仍装得下更小的组 — 但被 skip 的组在预算恢复后重跑批量
          // 自然拾起,方向只少花不多花
          if (result.denyReason === 'BUDGET_EXCEEDED') {
            for (const rest of plan.ordered.slice(i + 1)) {
              skipped.push({ groupId: rest.groupId, number: rest.number });
            }
            break;
          }
        }
      }

      await logOperation(ctx, 'aigc.batchGenerate', 'episode', input.episodeId, null, {
        batchId,
        projectId: plan.projectId,
        submitted: submitted.length,
        denied: denied.length,
        skipped: skipped.length,
        totalEstimateCny: plan.totalCny,
      });

      return {
        batchId,
        submitted,
        denied,
        skipped,
        totalEstimateCny: plan.totalCny,
      };
    }),

  /**
   * 取消本集排队中的批量任务 — 只摘 BullMQ 等待中的 job(已在跑的不动)。
   * 每摘掉一个:attempt → CANCELLED + REFUND 退净 + SSE 通知前端停转。
   */
  cancelQueuedForEpisode: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId, { skipLockCheck: true });
      const driver = (process.env.QUEUE_DRIVER ?? 'bullmq').toLowerCase();
      if (driver === 'in-process') {
        // 桌面单进程档:enqueue 即开跑,无排队窗口可取消
        return { cancelled: 0, skippedActive: 0, note: 'in-process 驱动无排队窗口(任务已直接开跑)' };
      }

      const inflight = await ctx.prisma.generationAttempt.findMany({
        where: {
          episodeId: ep.id,
          action: 'VIDEO',
          status: 'RUNNING', // DB RUNNING = 已入队(QUEUED 是占位中间态,ms 级,不碰防竞态)
          // 深审修(F-5/P2-3):只取消批量任务(batch_ 标签)— 单点排队任务不在「取消批量」语义内
          groupId: { startsWith: BATCH_GROUP_PREFIX },
        },
        // createdBy:退款归属原提交者(深审修 P2-3:取消者 ≠ 提交者时 per-user 花费归因不能错位)
        select: { id: true, providerId: true, createdBy: true },
      });

      const queue = getVideoGenQueue();
      const progressBus = getProgressBus();
      let cancelled = 0;
      let skippedActive = 0;
      for (const a of inflight) {
        try {
          const job = await queue.getJob(`videogen:attempt:${a.id}`);
          if (!job) {
            skippedActive++; // 已被 worker 取走清理 / 不在队列
            continue;
          }
          const state = await job.getState();
          if (state !== 'waiting' && state !== 'delayed' && state !== 'prioritized') {
            skippedActive++; // active/completed:已开跑,不取消(RUNNING 取消留 W5-L6)
            continue;
          }
          // 深审修(F-1/F-5.2):**先落库后摘 job** —
          //   ① RUNNING→CANCELLED 命中(count=1)才退款:getState 窗口内 worker 已完成时
          //     count=0 直接放行,杜绝「SUCCESS + 全额退款」白嫖序列;
          //   ② 摘 job 失败也安全:worker 入口 CANCELLED 幂等门跳过、不调 provider 不双退
          //     (原先「先 remove 后落库」若落库失败,job 已没了而 attempt 滞留 RUNNING,
          //     批量重跑被 hasInflight 过滤永不自愈)
          let claimed = false;
          await ctx.prisma.$transaction(async (tx) => {
            const r = await tx.generationAttempt.updateMany({
              where: { id: a.id, status: 'RUNNING' },
              data: {
                status: 'CANCELLED',
                errorMsg: '用户取消批量排队',
                finishedAt: new Date(),
              },
            });
            if (r.count === 0) return;
            claimed = true;
            await refundPrepayForAttempt(tx, {
              attemptId: a.id,
              userId: a.createdBy,
              projectId: ep.projectId,
              episodeId: ep.id,
              providerId: a.providerId,
              reason: 'video_task_cancelled_queued',
            });
          });
          if (!claimed) {
            skippedActive++; // 窗口内已成终态(完成/失败),不取消不退款
            continue;
          }
          await job.remove().catch(() => {}); // best-effort:失败由 CANCELLED 幂等门兜底
          cancelled++;
          // SSE 通知前端该 attempt 终态(停 spinner);失败不影响取消本身
          await progressBus
            .publish(a.id, {
              type: 'failed',
              attemptId: a.id,
              errorMsg: '已取消批量排队(费用已退还)',
              retryable: false,
            })
            .catch(() => {});
        } catch {
          skippedActive++; // 队列异常 / 事务失败(已回滚):这单不取消,留给 worker 正常跑
        }
      }

      await logOperation(ctx, 'aigc.cancelQueuedForEpisode', 'episode', ep.id, null, {
        projectId: ep.projectId,
        cancelled,
        skippedActive,
      });

      return { cancelled, skippedActive, note: null };
    }),
};
