/**
 * M6/H2 提示词优化 job handler(queue kind `optimize-prompts`)。
 *
 * H2 升级(docs/07 延迟分档):后台 job 一律走**深度管线**(Composer→硬门→判官→Repair≤2)—
 *   - 整集✨:全部候选组逐组深度优化
 *   - 单组✨✨深度优化:payload.groupId 锁定一组(同 kind 复用,入队侧 jobId 区分)
 * 判官 binding 未配时深度管线自动降级 = Composer+硬门(advisory 语义,行为兼容 M6)。
 * 每组落 PromptOptimizeRun 体检报告(八维分/阶段明细/片段命中 — H3 飞轮数据源)。
 *
 * 失败语义(增强项纪律,同 cache-video/qc):handler 不抛 — 全部结果进通知正文。
 */
import type { PrismaClient } from '@ss/db';
import { prisma } from '@ss/db';
import { sanitizeErrorMsg } from '@ss/shared';
import { z } from 'zod';

import { notify } from '../notify/index.js';

import { applyOptimizedPrompt, checkTextBudgetForOptimize } from './apply.js';
import { loadOptimizeContext } from './context.js';
import { deepOptimizeGroupPrompt } from './deep-optimize.js';
import { recordOptimizeRun } from './run-record.js';

export const OPTIMIZE_EPISODE_JOB_KIND = 'optimize-prompts' as const;

export const OptimizeEpisodeJobDataSchema = z.object({
  episodeId: z.string().cuid(),
  projectId: z.string().cuid(),
  userId: z.string().cuid(),
  /** H2:✨✨单组深度优化 — 只跑这一组(缺省 = 整集) */
  groupId: z.string().cuid().optional(),
  requestId: z.string().optional(),
});
export type OptimizeEpisodeJobData = z.infer<typeof OptimizeEpisodeJobDataSchema>;

export async function processOptimizeEpisodeJob(data: unknown): Promise<void> {
  const payload = OptimizeEpisodeJobDataSchema.parse(data);
  const reqTag = payload.requestId ? `[req=${payload.requestId}]` : '';
  try {
    await runEpisodeOptimize(prisma, payload, reqTag);
  } catch (e) {
    // 兜底:整集级意外(DB 不可达等)— 落通知让用户知道这单没跑完
    const msg = sanitizeErrorMsg(e, 300);
    console.warn(`[optimize-prompts]${reqTag} 优化中断:`, msg);
    await notify(prisma, {
      userId: payload.userId,
      type: 'optimize_failed',
      title: payload.groupId ? '单组深度优化中断' : '整集提示词优化中断',
      body: msg,
      payload: { episodeId: payload.episodeId, projectId: payload.projectId },
    }).catch(() => {});
  }
}

async function runEpisodeOptimize(
  db: PrismaClient,
  payload: OptimizeEpisodeJobData,
  reqTag: string,
): Promise<void> {
  const { episodeId, projectId, userId } = payload;
  const targetProviderId = (
    await db.systemSetting.findUnique({
      where: { key: 'binding.shot.video.providerId' },
      select: { value: true },
    })
  )?.value;

  const groups = await db.shotGroup.findMany({
    where: {
      episodeId,
      deletedAt: null,
      ...(payload.groupId ? { id: payload.groupId } : {}),
    },
    orderBy: { positionIdx: 'asc' },
    select: {
      id: true,
      number: true,
      prompt: true,
      durationS: true,
      positionIdx: true,
    },
  });
  const candidates = groups.filter((g) => g.prompt.trim().length > 0);

  let ok = 0;
  let unchanged = 0;
  const failed: string[] = [];
  let skippedBudget = 0;
  let totalCost = 0;

  for (const g of candidates) {
    // 逐组预算门:优化本身花钱,打满即止(后续组下次再跑)
    const budgetDeny = await checkTextBudgetForOptimize(db, projectId);
    if (budgetDeny) {
      skippedBudget = candidates.length - ok - unchanged - failed.length;
      console.warn(`[optimize-prompts]${reqTag} 预算打满,剩余 ${skippedBudget} 组跳过:${budgetDeny}`);
      break;
    }
    try {
      const ctx = await loadOptimizeContext(db, {
        group: {
          id: g.id,
          number: g.number,
          prompt: g.prompt,
          durationS: g.durationS,
          episodeId,
          projectId,
          positionIdx: g.positionIdx,
        },
        userId,
        targetProviderId,
      });
      // H2:深度管线(判官未配自动降级 Composer+硬门)
      const outcome = await deepOptimizeGroupPrompt(db, { ctx, userId, projectId, episodeId });
      if (!outcome.ok) {
        totalCost += outcome.totalCostCny;
        await recordOptimizeRun(db, {
          groupId: g.id,
          episodeId,
          projectId,
          userId,
          stages: outcome.stages,
          dimScores: outcome.dimScores,
          fragmentIds: outcome.fragmentIds,
          iterations: outcome.iterations,
          applied: false,
          denyCode: outcome.code,
          totalCostCny: outcome.totalCostCny,
        });
        failed.push(`组 ${g.number}:${outcome.message}`);
        // NO_BINDING 是全局配置缺失 — 后续组必然同拒,直接中止
        if (outcome.code === 'NO_BINDING') break;
        continue;
      }
      const applied = await applyOptimizedPrompt(db, {
        groupId: g.id,
        before: g.prompt,
        optimized: outcome.optimized,
        userId,
        modelId: outcome.modelId,
        projectId,
        episodeId,
        contributorsUsed: outcome.contributorsUsed,
        // §4.6 收口:composer/judge/repair 全阶段 tokens/费用并入同一条 prompt.optimize 记账
        inputTokens: outcome.totalInputTokens,
        outputTokens: outcome.totalOutputTokens,
        costCny: outcome.totalCostCny,
      });
      totalCost += outcome.totalCostCny;
      await recordOptimizeRun(db, {
        groupId: g.id,
        episodeId,
        projectId,
        userId,
        stages: outcome.stages,
        dimScores: outcome.dimScores,
        fragmentIds: outcome.fragmentIds,
        iterations: outcome.iterations,
        applied: applied.applied,
        denyCode: applied.applied ? null : 'PROMPT_CHANGED',
        totalCostCny: outcome.totalCostCny,
      });
      if (!applied.applied) {
        failed.push(`组 ${g.number}:优化期间提示词被人工修改,已保留人工版本`);
      } else if (applied.changed) {
        ok++;
      } else {
        unchanged++;
      }
    } catch (e) {
      failed.push(`组 ${g.number}:${sanitizeErrorMsg(e, 160)}`);
    }
  }

  const label = payload.groupId ? '单组深度优化' : '整集提示词优化';
  const summary = [
    `优化 ${ok} 组`,
    unchanged > 0 ? `${unchanged} 组无变化` : '',
    failed.length > 0 ? `${failed.length} 组失败` : '',
    skippedBudget > 0 ? `${skippedBudget} 组因预算跳过` : '',
    `合计 ¥${totalCost.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  console.log(`[optimize-prompts]${reqTag} ${label}完成:${summary}`);
  await notify(prisma, {
    userId,
    type: failed.length > 0 && ok === 0 && unchanged === 0 ? 'optimize_failed' : 'optimize_done',
    title: `${label}:${summary}`,
    body: failed.slice(0, 5).join('\n') || undefined,
    payload: { episodeId, projectId, ok, unchanged, failed: failed.length, skippedBudget, totalCost },
  }).catch(() => {});
}
