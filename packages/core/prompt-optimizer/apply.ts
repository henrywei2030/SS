/**
 * M6 优化结果落库(api 单组同步路 与 整集后台 job 共用的单一真相源)。
 *
 * 语义对齐 aigc-prompt.updateGroupPrompt:normalizePrompt 归一 + PromptEdit 记
 * before/after(diffNote 带 [AI优化] 标记 — M6c 编辑飞轮据此区分 AI 写入与人工修订,
 * 「AI 原文 → 人改后」配对才是 few-shot 素材)+ CostLedgerEntry(action=prompt.optimize)。
 */
import type { PrismaClient } from '@ss/db';
import { Prisma } from '@ss/db';
import { billingCycle, normalizePrompt } from '@ss/shared';

export interface ApplyOptimizedArgs {
  groupId: string;
  /** 优化前原文(乐观锁:写回时 group.prompt 已变则拒绝覆盖人工编辑) */
  before: string;
  optimized: string;
  userId: string;
  modelId: string;
  projectId: string;
  episodeId: string;
  scriptId?: string | null;
  contributorsUsed: string[];
  inputTokens: number;
  outputTokens: number;
  costCny: number;
}

export type ApplyOptimizedResult =
  | { applied: true; changed: boolean; normalized: string }
  | { applied: false; reason: 'PROMPT_CHANGED' };

export async function applyOptimizedPrompt(
  prisma: PrismaClient,
  args: ApplyOptimizedArgs,
): Promise<ApplyOptimizedResult> {
  const normalizedBefore = normalizePrompt(args.before);
  const normalizedAfter = normalizePrompt(args.optimized);
  const ktok = (args.inputTokens + args.outputTokens) / 1000;

  return prisma.$transaction(async (tx) => {
    // 记账先行:钱已花,即使下面因并发编辑拒绝写回也照记(真实支出)
    await tx.costLedgerEntry.create({
      data: {
        userId: args.userId,
        projectId: args.projectId,
        episodeId: args.episodeId,
        providerId: args.modelId,
        modelId: args.modelId,
        action: 'prompt.optimize',
        inputUnits: args.inputTokens,
        outputUnits: args.outputTokens,
        unitPriceCny: ktok > 0 ? (args.costCny / ktok).toFixed(6) : '0',
        costCny: args.costCny.toFixed(4),
        success: true,
        billingCycle: billingCycle(),
      },
    });

    // 乐观锁:优化期间(LLM 数秒)用户手改了提示词 → 不覆盖人工编辑,优化结果作废
    const claim = await tx.shotGroup.updateMany({
      where: { id: args.groupId, prompt: args.before, deletedAt: null },
      data: { prompt: normalizedAfter },
    });
    if (claim.count === 0) {
      // before 形态可能已是归一文本(UI 保存过):再试归一匹配一次
      const claim2 = await tx.shotGroup.updateMany({
        where: { id: args.groupId, prompt: normalizedBefore, deletedAt: null },
        data: { prompt: normalizedAfter },
      });
      if (claim2.count === 0) return { applied: false, reason: 'PROMPT_CHANGED' as const };
    }

    if (normalizedBefore !== normalizedAfter) {
      // PromptEdit:userId 是触发者;diffNote [AI优化] 前缀 = M6c 飞轮的 AI 写入标记
      await tx.promptEdit.create({
        data: {
          targetType: 'SHOT_GROUP',
          targetId: args.groupId,
          field: 'prompt',
          before: normalizedBefore,
          after: normalizedAfter,
          diffNote: `[AI优化 ${args.modelId}] contributors=${args.contributorsUsed.join('+') || 'none'}`,
          projectId: args.projectId,
          episodeId: args.episodeId,
          scriptId: args.scriptId ?? null,
          userId: args.userId,
        },
      });
    }
    return {
      applied: true as const,
      changed: normalizedBefore !== normalizedAfter,
      normalized: normalizedAfter,
    };
  });
}

/**
 * 文本生成日预算守卫(与 inspiration.checkTextBudget 同池同口径:
 * text.generate + prompt.optimize 合并计入 text.generate.dailyBudgetCny)。
 * 返回 null=放行,字符串=拒绝原因。
 */
export async function checkTextBudgetForOptimize(
  prisma: PrismaClient,
  projectId: string,
): Promise<string | null> {
  const raw = (
    await prisma.systemSetting.findUnique({
      where: { key: 'text.generate.dailyBudgetCny' },
      select: { value: true },
    })
  )?.value;
  const limit = Number(raw ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) return null; // 0/未配/非法 = 不限
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const spent = await prisma.costLedgerEntry.aggregate({
    where: {
      projectId,
      action: { in: ['text.generate', 'prompt.optimize'] },
      success: true,
      createdAt: { gte: todayStart },
    },
    _sum: { costCny: true },
  });
  const spentDec = new Prisma.Decimal(spent._sum.costCny ?? 0);
  if (spentDec.gte(new Prisma.Decimal(limit))) {
    return `今日文本生成预算已用 ${spentDec.toFixed(2)}¥ / 上限 ${limit}¥ — 明日再试或调高 text.generate.dailyBudgetCny`;
  }
  return null;
}
