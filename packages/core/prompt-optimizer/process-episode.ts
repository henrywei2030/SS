/**
 * M6 整集提示词优化 job handler(queue kind `optimize-prompts`)。
 *
 * 整集 = N 组 × LLM 数秒,不能同步 mutation — 走 ss-jobs 后台串行跑,完成后
 * 铃铛+webhook 通知(M0 notify)。每组独立:单组失败/被拒不连坐;循环内逐组过
 * 文本日预算,打满即止(剩余组记 skipped)。
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
import { optimizeGroupPrompt } from './optimize.js';

export const OPTIMIZE_EPISODE_JOB_KIND = 'optimize-prompts' as const;

export const OptimizeEpisodeJobDataSchema = z.object({
  episodeId: z.string().cuid(),
  projectId: z.string().cuid(),
  userId: z.string().cuid(),
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
    console.warn(`[optimize-prompts]${reqTag} 整集优化中断:`, msg);
    await notify(prisma, {
      userId: payload.userId,
      type: 'optimize_failed',
      title: '整集提示词优化中断',
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
    where: { episodeId, deletedAt: null },
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
        targetProviderId,
      });
      const outcome = await optimizeGroupPrompt(db, { ctx, userId, projectId, episodeId });
      if (!outcome.ok) {
        // NO_BINDING 是全局配置缺失 — 后续组必然同拒,直接中止
        if (outcome.code === 'NO_BINDING') {
          failed.push(`组 ${g.number}:${outcome.message}`);
          break;
        }
        failed.push(`组 ${g.number}:${outcome.message}`);
        totalCost += outcome.costCny ?? 0;
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
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        costCny: outcome.costCny,
      });
      totalCost += outcome.costCny;
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

  const summary = [
    `优化 ${ok} 组`,
    unchanged > 0 ? `${unchanged} 组无变化` : '',
    failed.length > 0 ? `${failed.length} 组失败` : '',
    skippedBudget > 0 ? `${skippedBudget} 组因预算跳过` : '',
    `合计 ¥${totalCost.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  console.log(`[optimize-prompts]${reqTag} 整集完成:${summary}`);
  await notify(prisma, {
    userId,
    type: failed.length > 0 && ok === 0 && unchanged === 0 ? 'optimize_failed' : 'optimize_done',
    title: `整集提示词优化:${summary}`,
    body: failed.slice(0, 5).join('\n') || undefined,
    payload: { episodeId, projectId, ok, unchanged, failed: failed.length, skippedBudget, totalCost },
  }).catch(() => {});
}
