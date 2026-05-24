/**
 * BaseProvider — 所有 Provider 的公共基类
 *
 * 提供：
 *   - Cost Ledger 自动记账（成功 / 失败均记录）
 *   - 统一日志
 *   - GenerationAttempt 状态机更新
 *   - 预算护栏检查 hook（W2 接入）
 *
 * 子类只需实现 callRemote()，记账由本类处理。
 *
 * W1-W5 audit P1 followup(R9):costCny 用 Prisma.Decimal 计算,防 IEEE-754 误差
 *   原 `outputUnits * unitPriceCny` 是 JS 浮点乘法,大额抽卡(5000+ 行)累加会漂。
 *
 * Phase 1.5 P0-1 + P0-2(2026-05-24,主次重审 v2.1):
 *   - 加 entryType / refundReason / parentEntryId 支持视频预扣/退还
 *   - 加 modelRate / outputRate 2 倍率公式(优先);未提供则 fallback 到 unitPriceCny 单价
 *   - 加 costCnyOverride:PREPAY/REFUND/ADJUSTMENT 不算 cost,直接传金额落库
 */
import { prisma, Prisma } from '@ss/db';
import { ProviderError, BudgetExceededError } from '@ss/shared';

import type { CallContext, ProviderInfo } from './types.js';

export type LedgerEntryType = 'NORMAL' | 'PREPAY' | 'REFUND' | 'ADJUSTMENT';

export interface RecordLedgerOpts {
  ctx: CallContext;
  providerId: string;
  modelId: string;
  action: string;
  inputUnits: number;
  outputUnits: number;
  unitPriceCny: number;
  success: boolean;
  // Phase 1.5 P0-1 字段(可选,默认 NORMAL)
  entryType?: LedgerEntryType;
  refundReason?: string;
  parentEntryId?: string;
  /** 直接传 costCny(预扣/退还/手动调整时用),跳过 2 倍率公式 */
  costCnyOverride?: Prisma.Decimal | string | number;
  // Phase 1.5 P0-2 字段(可选,优先于 unitPriceCny)
  modelRate?: number;
  outputRate?: number;
}

/**
 * Phase 1.5 P0-2 计费公式(主次重审 v2.1):
 *   modelRate 非空 → 2 倍率:input/1M × modelRate + output/1M × modelRate × outputRate
 *   modelRate 空 → fallback 旧 unitPriceCny 单价(outputUnits × unitPriceCny)
 */
export function calcCostCnyDecimal(opts: {
  inputUnits: number;
  outputUnits: number;
  unitPriceCny: number;
  modelRate?: number;
  outputRate?: number;
}): Prisma.Decimal {
  const { inputUnits, outputUnits, unitPriceCny, modelRate, outputRate } = opts;
  if (modelRate != null && Number.isFinite(modelRate) && modelRate > 0) {
    const rate = new Prisma.Decimal(modelRate);
    const oRate = new Prisma.Decimal(outputRate ?? 1);
    const inputCost = new Prisma.Decimal(inputUnits).div(1_000_000).mul(rate);
    const outputCost = new Prisma.Decimal(outputUnits).div(1_000_000).mul(rate).mul(oRate);
    return inputCost.plus(outputCost);
  }
  // fallback 旧逻辑:outputUnits × unitPriceCny(向后兼容)
  return new Prisma.Decimal(outputUnits).mul(new Prisma.Decimal(unitPriceCny));
}

export abstract class BaseProvider {
  abstract readonly info: ProviderInfo;

  /** 记录 Cost Ledger（同步落库,Decimal 算 cost） */
  protected async recordLedger(opts: RecordLedgerOpts): Promise<void> {
    if (opts.ctx.skipLedger) return;
    // costCnyOverride 优先(预扣/退还/调整时用),否则按 2 倍率 / 单价公式算
    const costCny =
      opts.costCnyOverride !== undefined
        ? new Prisma.Decimal(opts.costCnyOverride as Prisma.Decimal.Value)
        : calcCostCnyDecimal({
            inputUnits: opts.inputUnits,
            outputUnits: opts.outputUnits,
            unitPriceCny: opts.unitPriceCny,
            modelRate: opts.modelRate,
            outputRate: opts.outputRate,
          });
    try {
      await prisma.costLedgerEntry.create({
        data: {
          userId: opts.ctx.userId,
          projectId: opts.ctx.projectId,
          episodeId: opts.ctx.episodeId,
          shotId: opts.ctx.shotId,
          assetId: opts.ctx.assetId,
          attemptId: opts.ctx.attemptId,
          providerId: opts.providerId,
          modelId: opts.modelId,
          action: opts.action,
          inputUnits: opts.inputUnits,
          outputUnits: opts.outputUnits,
          unitPriceCny: opts.unitPriceCny,
          costCny,
          success: opts.success,
          entryType: opts.entryType ?? 'NORMAL',
          refundReason: opts.refundReason ?? null,
          parentEntryId: opts.parentEntryId ?? null,
          billingCycle: new Date().toISOString().slice(0, 7), // YYYY-MM
        },
      });
    } catch (e) {
      // 记账失败不能阻塞业务 — 仅日志
      console.error('[ledger] failed to record entry:', e);
    }
  }

  /** 预算护栏检查（Phase 1 简单实现：仅项目总预算,Decimal 防累加漂移） */
  protected async checkBudget(projectId: string | undefined, estimatedCost: number): Promise<void> {
    if (!projectId) return;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { budgetCny: true },
    });
    if (!project?.budgetCny) return; // 未设置预算 = 无上限

    const used = await prisma.costLedgerEntry.aggregate({
      where: { projectId, success: true },
      _sum: { costCny: true },
    });

    const usedDec = new Prisma.Decimal(used._sum.costCny ?? 0);
    const limitDec = new Prisma.Decimal(project.budgetCny);
    const projected = usedDec.plus(new Prisma.Decimal(estimatedCost));

    if (projected.gt(limitDec)) {
      throw new BudgetExceededError(
        `project ${projectId}`,
        limitDec.toNumber(),
        projected.toNumber(),
      );
    }
  }

  /** 包装远程调用 — 统一错误转换 */
  protected wrapCallError(e: unknown): never {
    if (e instanceof ProviderError || e instanceof BudgetExceededError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new ProviderError(this.info.id, msg, e);
  }
}
