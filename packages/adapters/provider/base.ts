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
 */
import { prisma, Prisma } from '@ss/db';
import { ProviderError, BudgetExceededError } from '@ss/shared';

import type { CallContext, ProviderInfo } from './types.js';

export interface RecordLedgerOpts {
  ctx: CallContext;
  providerId: string;
  modelId: string;
  action: string;
  inputUnits: number;
  outputUnits: number;
  unitPriceCny: number;
  success: boolean;
}

export abstract class BaseProvider {
  abstract readonly info: ProviderInfo;

  /** 记录 Cost Ledger（同步落库,Decimal 算 cost） */
  protected async recordLedger(opts: RecordLedgerOpts): Promise<void> {
    if (opts.ctx.skipLedger) return;
    // R9:Decimal 乘法,Prisma 写库时把 Decimal 序列化为 NUMERIC 不丢精度
    const costCny = new Prisma.Decimal(opts.outputUnits).mul(
      new Prisma.Decimal(opts.unitPriceCny),
    );
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
