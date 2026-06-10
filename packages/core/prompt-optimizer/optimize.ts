/**
 * M6 优化器编排 — 收集启用 contributor → 拼 meta-prompt → 调 LLM → 守卫校验。
 *
 * 分层(同 submit 纪律):core 返判别 OptimizeOutcome,不写库不抛 TRPCError —
 * 写回 ShotGroup.prompt / PromptEdit / 记账由 api 层做(单点写,人可审可改)。
 * 回退零风险:binding 空 → NO_BINDING deny,调用方提示去 /admin/bindings 配,
 * 不配 = 功能关闭,现有静态编译链完全不受影响(蓝图 §5.1 开关语义)。
 */
import { getTextProvider } from '@ss/adapters/provider';
import type { PrismaClient } from '@ss/db';

import { loadPromptTemplate } from '../shared/load-prompt.js';

import { ALL_CONTRIBUTORS } from './contributors/index.js';
import {
  buildFamilyDirective,
  PROMPT_OPTIMIZER_FALLBACK,
  PROMPT_OPTIMIZER_SLUG,
} from './fallback-template.js';
import { findLostTokens, parseEnabledContributors, stripLlmWrapping } from './guards.js';
import type { OptimizeContext, OptimizeOutcome } from './types.js';

/** 优化器 binding(复用既有预留 KEY,seed.ts 描述已更新为 M6 启用) */
export const OPTIMIZER_BINDING_KEY = 'binding.storyboard.prompt.modelId' as const;
/** contributor 开关(CSV,默认 shot,assets,style,continuity) */
export const OPTIMIZER_CONTRIBUTORS_KEY = 'prompt.optimizer.contributors' as const;

export interface OptimizeGroupArgs {
  ctx: OptimizeContext;
  userId: string;
  /** 透传记账归属(api 层写 ledger 用;core 只调用不记账) */
  projectId: string;
  episodeId: string;
}

/** 装配 user prompt(导出供单测锁段落顺序/必备段) */
export async function buildOptimizerUserPrompt(
  ctx: OptimizeContext,
  enabledKeys: string[],
): Promise<{ prompt: string; contributorsUsed: string[] }> {
  const sections: string[] = [];
  const used: string[] = [];
  const enabled = new Set(enabledKeys);
  for (const c of [...ALL_CONTRIBUTORS].sort((a, b) => a.order - b.order)) {
    if (!enabled.has(c.key)) continue;
    const rendered = await c.render(ctx);
    if (rendered) {
      sections.push(rendered);
      used.push(c.key);
    }
  }
  sections.push(`【目标模型风格】\n${buildFamilyDirective(ctx.providerFamily)}`);
  sections.push(
    `【当前提示词】(优化对象;其中 @token 逐字保留)\n${ctx.group.prompt}`,
  );
  sections.push('请输出优化后的提示词正文(只输出正文)。');
  return { prompt: sections.join('\n\n'), contributorsUsed: used };
}

export async function optimizeGroupPrompt(
  prisma: PrismaClient,
  args: OptimizeGroupArgs,
): Promise<OptimizeOutcome> {
  const { ctx } = args;
  if (!ctx.group.prompt.trim()) {
    return { ok: false, code: 'EMPTY_PROMPT', message: '提示词为空 — 先在导演工作台生成或手编再优化' };
  }

  const bindingRow = await prisma.systemSetting.findUnique({
    where: { key: OPTIMIZER_BINDING_KEY },
    select: { value: true },
  });
  const modelId = bindingRow?.value?.trim();
  if (!modelId) {
    return {
      ok: false,
      code: 'NO_BINDING',
      message:
        '提示词优化未配置 LLM — 去 /admin/bindings 选 binding.storyboard.prompt.modelId(留空 = 功能关闭,静态编译不受影响)',
    };
  }

  const contributorsRow = await prisma.systemSetting.findUnique({
    where: { key: OPTIMIZER_CONTRIBUTORS_KEY },
    select: { value: true },
  });
  const enabledKeys = parseEnabledContributors(contributorsRow?.value);

  const [system, { prompt: userPrompt, contributorsUsed }] = await Promise.all([
    loadPromptTemplate(PROMPT_OPTIMIZER_SLUG, PROMPT_OPTIMIZER_FALLBACK),
    buildOptimizerUserPrompt(ctx, enabledKeys),
  ]);

  const provider = await getTextProvider(modelId);
  const result = await provider.generate(
    {
      system,
      prompt: userPrompt,
      temperature: 0.4,
      maxTokens: 4000,
    },
    {
      userId: args.userId,
      projectId: args.projectId,
      episodeId: args.episodeId,
      // ADR-25 口径:api 层单点写 ledger(action=prompt.optimize),provider 内置记账跳过
      skipLedger: true,
    },
  );

  const optimized = stripLlmWrapping(result.text);
  if (!optimized) {
    return {
      ok: false,
      code: 'EMPTY_OUTPUT',
      message: `优化器输出为空${result.truncated ? '(maxTokens 截断)' : ''} — 换模型或重试`,
      costCny: result.costCny,
    };
  }
  // 核心护栏:@token 保全 — 缺一即拒,绝不让坏提示词进库(编译期会 unknownTokens 拒生成)
  const lost = findLostTokens(ctx.group.prompt, optimized);
  if (lost.length > 0) {
    return {
      ok: false,
      code: 'TOKEN_LOST',
      message: `优化输出丢失了引用 token:${lost.join('、')} — 已拒绝写回(原提示词未动),重试或换模型`,
      rawOutput: optimized.slice(0, 2000),
      costCny: result.costCny,
    };
  }

  return {
    ok: true,
    optimized,
    modelId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costCny: result.costCny,
    contributorsUsed,
  };
}
