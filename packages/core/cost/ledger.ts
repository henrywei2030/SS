/**
 * Cost Ledger 业务封装
 *
 * 已在 @ss/adapters/provider/base.ts 中实现了自动记账中间件。
 * 此文件提供 上层查询 / 聚合 / 预算检查 的便捷函数。
 */
import { prisma } from '@ss/db';
import { BudgetExceededError } from '@ss/shared';

export interface CostBreakdown {
  totalCny: number;
  imageCny: number;
  videoCny: number;
  textCny: number;
  audioCny: number;
  byProvider: Record<string, number>;
}

/** 项目级成本汇总 */
export async function getProjectCostBreakdown(projectId: string): Promise<CostBreakdown> {
  const rows = await prisma.costLedgerEntry.findMany({
    where: { projectId, success: true },
    select: { providerId: true, action: true, costCny: true },
  });

  const out: CostBreakdown = {
    totalCny: 0,
    imageCny: 0,
    videoCny: 0,
    textCny: 0,
    audioCny: 0,
    byProvider: {},
  };

  for (const r of rows) {
    const c = Number(r.costCny);
    out.totalCny += c;
    if (r.action.startsWith('image.')) out.imageCny += c;
    else if (r.action.startsWith('video.')) out.videoCny += c;
    else if (r.action.startsWith('text.')) out.textCny += c;
    else if (r.action.startsWith('audio.')) out.audioCny += c;

    out.byProvider[r.providerId] = (out.byProvider[r.providerId] ?? 0) + c;
  }
  return out;
}

/** 镜头级成本（含失败抽卡的浪费） */
export async function getShotCost(shotId: string): Promise<{
  total: number;
  attempts: number;
  successful: number;
  failed: number;
}> {
  const rows = await prisma.costLedgerEntry.findMany({
    where: { shotId },
    select: { costCny: true, success: true },
  });
  return {
    total: rows.reduce((s, r) => s + Number(r.costCny), 0),
    attempts: rows.length,
    successful: rows.filter((r) => r.success).length,
    failed: rows.filter((r) => !r.success).length,
  };
}

/** 抛错版预算检查 — 业务调用前置 */
export async function assertProjectBudget(
  projectId: string,
  estimatedCny: number,
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { budgetCny: true },
  });
  if (!project?.budgetCny) return;

  const used = await prisma.costLedgerEntry.aggregate({
    where: { projectId, success: true },
    _sum: { costCny: true },
  });

  const usedAmount = Number(used._sum.costCny ?? 0);
  const limit = Number(project.budgetCny);
  if (usedAmount + estimatedCny > limit) {
    throw new BudgetExceededError(`project ${projectId}`, limit, usedAmount + estimatedCny);
  }
}

/** 抽卡率 (gacha ratio) — 全项目 */
export async function getProjectGachaRatio(projectId: string): Promise<{
  ratio: number;
  generatedSeconds: number;
  targetSeconds: number;
}> {
  // 目标时长 = 所有 shots 累加
  const shots = await prisma.shot.findMany({
    where: { episode: { projectId } },
    select: { durationS: true },
  });
  const targetSeconds = shots.reduce((s, x) => s + x.durationS, 0);

  // 生成总时长 = 所有 video 成功 attempt outputUnits 累加
  const attempts = await prisma.generationAttempt.findMany({
    where: {
      projectId,
      action: 'VIDEO',
      status: 'SUCCESS',
    },
    select: { id: true, outputMediaId: true },
  });

  // outputUnits 在 Cost Ledger 里更准
  const ledgers = await prisma.costLedgerEntry.findMany({
    where: { projectId, action: 'video.generate', success: true },
    select: { outputUnits: true },
  });
  const generatedSeconds = ledgers.reduce((s, r) => s + r.outputUnits, 0);

  return {
    ratio: targetSeconds > 0 ? generatedSeconds / targetSeconds : 0,
    generatedSeconds,
    targetSeconds,
  };
}

/** 当月账单（用于 Phase 2 计费） */
export async function getCurrentBillingCycle(userId: string): Promise<{
  cycle: string;
  totalCny: number;
}> {
  const cycle = new Date().toISOString().slice(0, 7);
  const sum = await prisma.costLedgerEntry.aggregate({
    where: { userId, billingCycle: cycle },
    _sum: { costCny: true },
  });
  return { cycle, totalCny: Number(sum._sum.costCny ?? 0) };
}
