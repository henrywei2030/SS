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
 */
import { prisma } from '@ss/db';
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

  /** 记录 Cost Ledger（同步落库） */
  protected async recordLedger(opts: RecordLedgerOpts): Promise<void> {
    if (opts.ctx.skipLedger) return;
    const costCny = opts.outputUnits * opts.unitPriceCny;
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

  /** 预算护栏检查（Phase 1 简单实现：仅项目总预算） */
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

    const usedAmount = Number(used._sum.costCny ?? 0);
    const limit = Number(project.budgetCny);

    if (usedAmount + estimatedCost > limit) {
      throw new BudgetExceededError(
        `project ${projectId}`,
        limit,
        usedAmount + estimatedCost,
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
