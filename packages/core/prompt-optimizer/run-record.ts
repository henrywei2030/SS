/**
 * H2(docs/07 §3):PromptOptimizeRun 落库 — 八维体检报告 / 审计 / H3 飞轮数据源。
 * 单组✨同步路与深度路共用;审计行写失败只告警,绝不阻塞优化主流程。
 */
import type { PrismaClient } from '@ss/db';

import type { OptimizeStage } from './deep-optimize.js';
import type { JudgeVerdict } from './judge.js';

export interface RecordOptimizeRunArgs {
  groupId: string;
  episodeId: string;
  projectId: string;
  userId: string;
  stages: OptimizeStage[];
  dimScores?: JudgeVerdict['dims'] | null;
  fragmentIds: string[];
  iterations: number;
  applied: boolean;
  denyCode?: string | null;
  totalCostCny: number;
}

export async function recordOptimizeRun(
  prisma: PrismaClient,
  args: RecordOptimizeRunArgs,
): Promise<void> {
  try {
    await prisma.promptOptimizeRun.create({
      data: {
        groupId: args.groupId,
        episodeId: args.episodeId,
        projectId: args.projectId,
        userId: args.userId,
        stagesJson: args.stages as never,
        dimScoresJson: (args.dimScores ?? undefined) as never,
        fragmentIds: args.fragmentIds,
        iterations: args.iterations,
        applied: args.applied,
        denyCode: args.denyCode ?? null,
        totalCostCny: args.totalCostCny.toFixed(4),
      },
    });
  } catch (e) {
    console.warn('[optimize-run] 体检报告落库失败(不影响优化结果):', e instanceof Error ? e.message : e);
  }
}
