/**
 * H2(docs/07 §2):深度优化编排 — 五段流水线的 3/4/5 段(Composer → 硬门 → 判官 → Repair)。
 *
 * 延迟分档(docs/07 H2 拍板):本编排只跑在后台 job(整集✨ / 单组✨✨深度),
 * 单组✨同步路 = optimizeGroupPrompt(Composer+硬门,秒级)不进这里。
 *
 * 修复纪律:
 *   - iterations ≤ 2(D-F):硬门违规修复与判官维度修复共享轮次预算
 *   - 判官 advisory(D-C):判官修复输出若过不了硬门 → 丢弃修复,保留已过硬门的上一版
 *     (绝不为软门把关过硬门的文本换成过不了的)
 *   - 全程花费汇总,由调用方并入 prompt.optimize 单点记账;阶段明细落 PromptOptimizeRun
 */
import { getTextProvider } from '@ss/adapters/provider';
import type { PrismaClient } from '@ss/db';

import { PROMPT_DIMENSION_LABEL, retrieveFragmentsForDims } from '../prompt-knowledge/index.js';
import { loadPromptTemplate } from '../shared/load-prompt.js';

import {
  PROMPT_OPTIMIZER_FALLBACK,
  PROMPT_OPTIMIZER_SLUG,
} from './fallback-template.js';
import { findLostTokens, stripLlmWrapping } from './guards.js';
import { runJudge, type JudgeVerdict } from './judge.js';
import { optimizeGroupPrompt, runSyncHardGates } from './optimize.js';
import type { OptimizeContext } from './types.js';

/** 修复轮次上限(D-F 拍板) */
export const MAX_REPAIR_ITERATIONS = 2;

export interface OptimizeStage {
  stage: 'composer' | 'judge' | 'repair';
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costCny: number;
  /** repair 轮:本轮目标(违规门 / 维度名) */
  targets?: string[];
}

export interface DeepOptimizeOk {
  ok: true;
  optimized: string;
  /** Composer 模型(写 PromptEdit 标记用,与单组✨口径一致) */
  modelId: string;
  contributorsUsed: string[];
  stages: OptimizeStage[];
  /** 判官八维评分(判官缺席 null) */
  dimScores: JudgeVerdict['dims'] | null;
  /** 知识片段命中 id(composer 注入 ∪ repair 注入,去重) */
  fragmentIds: string[];
  /** repair 轮数 */
  iterations: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCny: number;
}

export interface DeepOptimizeDeny {
  ok: false;
  code: 'NO_BINDING' | 'EMPTY_PROMPT' | 'TOKEN_LOST' | 'EMPTY_OUTPUT' | 'HARD_GATE';
  message: string;
  stages: OptimizeStage[];
  dimScores: JudgeVerdict['dims'] | null;
  fragmentIds: string[];
  iterations: number;
  totalCostCny: number;
}

export type DeepOptimizeOutcome = DeepOptimizeOk | DeepOptimizeDeny;

export async function deepOptimizeGroupPrompt(
  prisma: PrismaClient,
  args: { ctx: OptimizeContext; userId: string; projectId: string; episodeId: string },
): Promise<DeepOptimizeOutcome> {
  const { ctx } = args;
  const stages: OptimizeStage[] = [];
  const fragmentIds = new Set<string>();
  let iterations = 0;

  const sum = () => ({
    totalInputTokens: stages.reduce((s, x) => s + x.inputTokens, 0),
    totalOutputTokens: stages.reduce((s, x) => s + x.outputTokens, 0),
    totalCostCny: stages.reduce((s, x) => s + x.costCny, 0),
  });

  // ---- 1. Composer(复用单组✨同一真相源:contributor 装配 + token 守卫 + 硬门) ----
  const composed = await optimizeGroupPrompt(prisma, args);
  for (const id of ctx.usedKnowledgeFragmentIds ?? []) fragmentIds.add(id);

  let current: string;
  let composerModelId: string;
  let contributorsUsed: string[];

  if (composed.ok) {
    stages.push({
      stage: 'composer',
      modelId: composed.modelId,
      inputTokens: composed.inputTokens,
      outputTokens: composed.outputTokens,
      costCny: composed.costCny,
    });
    current = composed.optimized;
    composerModelId = composed.modelId;
    contributorsUsed = composed.contributorsUsed;
  } else if (
    (composed.code === 'HARD_GATE' || composed.code === 'TOKEN_LOST') &&
    composed.rawOutput
  ) {
    // Composer 产物没过门 → 深度路不直接判死,进定向修复(违规清单即修复目标)
    stages.push({
      stage: 'composer',
      modelId: '(composer)',
      inputTokens: 0,
      outputTokens: 0,
      costCny: composed.costCny ?? 0,
    });
    const repaired = await repairRound(prisma, ctx, {
      current: composed.rawOutput,
      violations:
        composed.code === 'TOKEN_LOST'
          ? [{ gate: 'TOKEN', message: composed.message }]
          : (composed.violations ?? [{ gate: 'HARD_GATE', message: composed.message }]),
      judgeIssues: null,
      stages,
      fragmentIds,
    });
    iterations++;
    if (!repaired) {
      return {
        ok: false,
        code: composed.code,
        message: composed.message,
        stages,
        dimScores: null,
        fragmentIds: [...fragmentIds],
        iterations,
        ...sumDeny(sum()),
      };
    }
    current = repaired;
    composerModelId = await readOptimizerModelId(prisma);
    contributorsUsed = [];
    // 修复后再过一遍硬门;仍违规且还有轮次 → 再修一轮
    let violations = await runSyncHardGates(prisma, ctx, current);
    if (violations.length > 0 && iterations < MAX_REPAIR_ITERATIONS) {
      const again = await repairRound(prisma, ctx, {
        current,
        violations,
        judgeIssues: null,
        stages,
        fragmentIds,
      });
      iterations++;
      if (again) {
        current = again;
        violations = await runSyncHardGates(prisma, ctx, current);
      }
    }
    if (violations.length > 0 || findLostTokens(ctx.group.prompt, current).length > 0) {
      return {
        ok: false,
        code: 'HARD_GATE',
        message: `修复 ${iterations} 轮仍未过硬门:${violations.map((v) => v.message).join(';') || 'token 丢失'}`,
        stages,
        dimScores: null,
        fragmentIds: [...fragmentIds],
        iterations,
        ...sumDeny(sum()),
      };
    }
  } else {
    // NO_BINDING / EMPTY_PROMPT / EMPTY_OUTPUT / 无 rawOutput — 无可修对象,原样透传
    return {
      ok: false,
      code: composed.code,
      message: composed.message,
      stages,
      dimScores: null,
      fragmentIds: [...fragmentIds],
      iterations,
      totalCostCny: composed.costCny ?? 0,
    };
  }

  // ---- 2. 判官(软门,advisory — 失败/未配 = 跳过) ----
  let dimScores: JudgeVerdict['dims'] | null = null;
  const judge = await runJudge(prisma, ctx, current);
  if (judge) {
    stages.push({
      stage: 'judge',
      modelId: judge.modelId,
      inputTokens: judge.inputTokens,
      outputTokens: judge.outputTokens,
      costCny: judge.costCny,
    });
    dimScores = judge.verdict.dims;

    // ---- 3. 定向修复(只喂不及格维度 + 对应片段;轮次预算共享) ----
    if (judge.verdict.repairDims.length > 0 && iterations < MAX_REPAIR_ITERATIONS) {
      const issues = judge.verdict.repairDims.map((d) => ({
        dim: d,
        issue: judge.verdict.dims[d as keyof JudgeVerdict['dims']]?.issue ?? '',
        score: judge.verdict.dims[d as keyof JudgeVerdict['dims']]?.score ?? 0,
      }));
      const repaired = await repairRound(prisma, ctx, {
        current,
        violations: [],
        judgeIssues: issues,
        stages,
        fragmentIds,
      });
      iterations++;
      if (repaired) {
        // D-C:软门修复绝不把过了硬门的文本换成过不了的 — 复检失败即丢弃修复
        const vio = await runSyncHardGates(prisma, ctx, repaired);
        const lost = findLostTokens(ctx.group.prompt, repaired);
        if (vio.length === 0 && lost.length === 0) {
          current = repaired;
        } else {
          console.warn(
            `[deep-optimize] 判官修复产物未过硬门(${vio.map((v) => v.gate).join('/') || 'TOKEN'}),保留修复前版本`,
          );
        }
      }
    }
  }

  return {
    ok: true,
    optimized: current,
    modelId: composerModelId,
    contributorsUsed,
    stages,
    dimScores,
    fragmentIds: [...fragmentIds],
    iterations,
    ...sum(),
  };
}

function sumDeny(s: { totalCostCny: number }): { totalCostCny: number } {
  return { totalCostCny: s.totalCostCny };
}

/** 修复一轮:目标(硬门违规 / 判官维度+意见)+ 对应知识片段 → Composer 同款模型重写 */
async function repairRound(
  prisma: PrismaClient,
  ctx: OptimizeContext,
  args: {
    current: string;
    violations: Array<{ gate: string; message: string }>;
    judgeIssues: Array<{ dim: string; issue: string; score: number }> | null;
    stages: OptimizeStage[];
    fragmentIds: Set<string>;
  },
): Promise<string | null> {
  const modelId = await readOptimizerModelId(prisma);
  if (!modelId) return null;

  // 不及格维度的知识片段(判官维度;硬门违规无维度映射 — ABSTRACT 给 ACTION 维素材)
  const dims = new Set<string>(args.judgeIssues?.map((i) => i.dim) ?? []);
  if (args.violations.some((v) => v.gate === 'ABSTRACT')) dims.add('ACTION');
  const fragments = await retrieveFragmentsForDims(prisma, {
    dims: [...dims],
    queryText: ctx.group.prompt,
    projectId: ctx.group.projectId,
    family: ctx.providerFamily,
  });
  for (const f of fragments) args.fragmentIds.add(f.id);

  const targetLines = [
    ...args.violations.map((v) => `- [硬门 ${v.gate}] ${v.message}`),
    ...(args.judgeIssues ?? []).map(
      (i) => `- [${PROMPT_DIMENSION_LABEL[i.dim] ?? i.dim}维 ${i.score} 分] ${i.issue || '该维欠缺,按知识片段补强'}`,
    ),
  ];

  const userPrompt = [
    `【待修复提示词】\n${args.current}`,
    `【必须修复的问题】(只修这些,其余句子与所有 @图片N/@音频N token 逐字保留)\n${targetLines.join('\n')}`,
    fragments.length > 0 ? `【可用知识片段】(按需吸收)\n${fragments.map((f) => f.line).join('\n')}` : '',
    '输出修复后的完整提示词正文(只输出正文,不解释)。',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const [system, provider] = await Promise.all([
      loadPromptTemplate(PROMPT_OPTIMIZER_SLUG, PROMPT_OPTIMIZER_FALLBACK),
      getTextProvider(modelId),
    ]);
    const result = await provider.generate(
      { system, prompt: userPrompt, temperature: 0.3, maxTokens: 4000 },
      {
        userId: ctx.userId,
        projectId: ctx.group.projectId,
        episodeId: ctx.group.episodeId,
        skipLedger: true, // §4.6:并入 prompt.optimize 单点记账
      },
    );
    args.stages.push({
      stage: 'repair',
      modelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costCny: result.costCny,
      targets: [
        ...args.violations.map((v) => v.gate),
        ...(args.judgeIssues ?? []).map((i) => i.dim),
      ],
    });
    const text = stripLlmWrapping(result.text);
    return text || null;
  } catch (e) {
    console.warn('[deep-optimize] 修复轮调用失败:', e instanceof Error ? e.message : e);
    return null;
  }
}

async function readOptimizerModelId(prisma: PrismaClient): Promise<string> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: 'binding.storyboard.prompt.modelId' },
    select: { value: true },
  });
  return row?.value?.trim() ?? '';
}
