/**
 * Cost Ledger 业务封装
 *
 * 已在 @ss/adapters/provider/base.ts 中实现了自动记账中间件。
 * 此文件提供 上层查询 / 聚合 / 预算检查 的便捷函数。
 *
 * W1-W5 audit P1 followup(R9):用 Prisma.Decimal 累加替代 Number()
 * 防大额(¥1000+)累加 IEEE-754 误差(0.1 + 0.2 = 0.30000000000000004)。
 * Prisma.Decimal 是 decimal.js 实例,任意精度十进制运算。
 * 出口仍 toNumber() 给前端展示(7 位有效精度对显示足够)。
 */
import { prisma, Prisma } from '@ss/db';
import { BudgetExceededError } from '@ss/shared';

export interface CostBreakdown {
  totalCny: number;
  imageCny: number;
  videoCny: number;
  textCny: number;
  audioCny: number;
  byProvider: Record<string, number>;
}

/** 项目级成本汇总 — Decimal 累加防 IEEE-754 累加误差 */
export async function getProjectCostBreakdown(projectId: string): Promise<CostBreakdown> {
  const rows = await prisma.costLedgerEntry.findMany({
    where: { projectId, success: true },
    select: { providerId: true, action: true, costCny: true },
  });

  let total = new Prisma.Decimal(0);
  let image = new Prisma.Decimal(0);
  let video = new Prisma.Decimal(0);
  let text = new Prisma.Decimal(0);
  let audio = new Prisma.Decimal(0);
  const byProvider = new Map<string, Prisma.Decimal>();

  for (const r of rows) {
    const c = new Prisma.Decimal(r.costCny);
    total = total.plus(c);
    if (r.action.startsWith('image.')) image = image.plus(c);
    else if (r.action.startsWith('video.')) video = video.plus(c);
    else if (r.action.startsWith('text.')) text = text.plus(c);
    else if (r.action.startsWith('audio.')) audio = audio.plus(c);

    const prev = byProvider.get(r.providerId) ?? new Prisma.Decimal(0);
    byProvider.set(r.providerId, prev.plus(c));
  }

  return {
    totalCny: total.toNumber(),
    imageCny: image.toNumber(),
    videoCny: video.toNumber(),
    textCny: text.toNumber(),
    audioCny: audio.toNumber(),
    byProvider: Object.fromEntries(
      Array.from(byProvider.entries()).map(([k, v]) => [k, v.toNumber()]),
    ),
  };
}

/** 镜头级成本（含失败抽卡的浪费）— Decimal 累加 */
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
  const total = rows.reduce(
    (acc, r) => acc.plus(new Prisma.Decimal(r.costCny)),
    new Prisma.Decimal(0),
  );
  return {
    total: total.toNumber(),
    attempts: rows.length,
    successful: rows.filter((r) => r.success).length,
    failed: rows.filter((r) => !r.success).length,
  };
}

/** 抛错版预算检查 — 业务调用前置(Decimal 比较防大额预算精度漂移) */
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

  const usedDec = new Prisma.Decimal(used._sum.costCny ?? 0);
  const limitDec = new Prisma.Decimal(project.budgetCny);
  const projected = usedDec.plus(new Prisma.Decimal(estimatedCny));
  if (projected.gt(limitDec)) {
    throw new BudgetExceededError(
      `project ${projectId}`,
      limitDec.toNumber(),
      projected.toNumber(),
    );
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

  // outputUnits 在 Cost Ledger 里更准 — outputUnits 是 Float(秒)不是 Decimal,
  // 但累加用 Decimal 防大量行(2000+ 抽卡)IEEE-754 漂移
  const ledgers = await prisma.costLedgerEntry.findMany({
    where: { projectId, action: 'video.generate', success: true },
    select: { outputUnits: true },
  });
  const generatedSeconds = ledgers
    .reduce(
      (acc, r) => acc.plus(new Prisma.Decimal(r.outputUnits)),
      new Prisma.Decimal(0),
    )
    .toNumber();

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
  // Prisma _sum 已用 Decimal 内部累加,这里直接 toNumber 给前端
  return { cycle, totalCny: new Prisma.Decimal(sum._sum.costCny ?? 0).toNumber() };
}
