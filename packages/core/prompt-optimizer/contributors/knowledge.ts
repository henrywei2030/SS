/**
 * H1(docs/07 §2/§4.4):knowledge contributor — 八维知识库检索进 M6 优化器。
 *
 * "八个独立 RAG"的隔离在 dimension 列 + 逐维检索,不在物理拆分;新维度=知识库加条目,
 * 本文件零改动。开关走既有 CSV(prompt.optimizer.contributors 加 'knowledge')。
 *
 * 检索模式(退化阶梯,docs/07 §5):
 *   - binding.prompt.embedding.modelId 配了 → 懒回填缺失向量 + query 语义检索(对症维)
 *   - 未配/失败 → tags+keyword 降级,零成本零外呼
 *   - 通用维(planner allowTagFallback=true:画质/稳定/主体纪律)始终走 keyword→tag 链,
 *     不参与 embedding 排名 — 词包条目与叙事 query 的余弦天然偏低,语义排序不适用
 *
 * 成本:embedding query ≈ ¥0.001/次(仅配了 binding 时);首次懒回填全库一次性 ≈ ¥0.04。
 * 记账:provider 内置 action='embedding.generate'(Retriever 非 LLM 角色,不并入
 * prompt.optimize — docs/07 §4.6 的统一收口针对 planner/composer/judge/repair 四个
 * LLM 阶段,H2 run 表落地时一起核)。
 */
import { getEmbeddingProvider } from '@ss/adapters/provider';

import {
  backfillKnowledgeEmbeddings,
  parseKnowledgeTags,
  planKnowledgeRetrieval,
  PROMPT_DIMENSION_LABEL,
  retrieveTopK,
  type RetrievableKnowledgeEntry,
} from '../../prompt-knowledge/index.js';
import type { OptimizeContext, PromptContextContributor } from '../types.js';

/** 优化器侧知识检索的 embedding binding(seed.ts 已含,留空=降级 tags 检索) */
export const KNOWLEDGE_EMBEDDING_BINDING_KEY = 'binding.prompt.embedding.modelId' as const;

/** 对症维 embedding 模式的余弦下限 — 低于视为不相关,宁缺毋滥(H3 飞轮按数据再调) */
const EMBEDDING_MIN_SIMILARITY = 0.2;

export const knowledgeContributor: PromptContextContributor = {
  key: 'knowledge',
  order: 50,
  async render(ctx: OptimizeContext): Promise<string | null> {
    const plan = planKnowledgeRetrieval({
      groupPrompt: ctx.group.prompt,
      shots: ctx.shots,
      hasCharacterAssets: ctx.assets.some((a) => a.type === 'CHARACTER'),
      providerFamily: ctx.providerFamily,
    });
    if (plan.retrievals.length === 0) return null;

    // 全局 + 本项目私有条目(D-E:世界观=projectId 作用域条目),一次取齐供逐维过滤
    const rows = await ctx.prisma.promptKnowledge.findMany({
      where: {
        enabled: true,
        dimension: { in: plan.retrievals.map((r) => r.dimension) as never },
        OR: [{ projectId: null }, { projectId: ctx.group.projectId }],
      },
      select: {
        id: true,
        dimension: true,
        title: true,
        content: true,
        tagsJson: true,
        embedding: true,
        embeddingModel: true,
        hitCount: true,
        weight: true,
      },
    });
    if (rows.length === 0) return null;

    const entries: Array<
      RetrievableKnowledgeEntry & { embedding: number[] | null; embeddingModel: string | null }
    > = rows.map((r) => ({
        id: r.id,
        dimension: r.dimension as string,
        title: r.title,
        content: r.content,
        tags: parseKnowledgeTags(r.tagsJson),
        embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : null,
        embeddingModel: r.embeddingModel,
        hitCount: r.hitCount,
        weight: r.weight,
        enabled: true,
      }));

    // embedding 路:binding 配了才走;懒回填 + query 向量,任何失败降级 keyword/tag
    let queryEmbedding: number[] | null = null;
    const bindingRow = await ctx.prisma.systemSetting.findUnique({
      where: { key: KNOWLEDGE_EMBEDDING_BINDING_KEY },
      select: { value: true },
    });
    const embeddingProviderId = bindingRow?.value?.trim();
    if (embeddingProviderId) {
      const filled = await backfillKnowledgeEmbeddings(ctx.prisma, {
        providerId: embeddingProviderId,
        entries,
        ctx: { userId: ctx.userId, projectId: ctx.group.projectId },
      });
      try {
        const provider = await getEmbeddingProvider(embeddingProviderId);
        const res = await provider.embed(
          { texts: [plan.queryText] },
          { userId: ctx.userId, projectId: ctx.group.projectId },
        );
        queryEmbedding = res.embeddings[0] ?? null;
      } catch (e) {
        console.warn(
          '[knowledge-contributor] query embedding 失败,降级 keyword/tag 检索:',
          e instanceof Error ? e.message : e,
        );
      }
      // 本轮回填成功的条目向量在 DB 已新,内存 entries 还是旧的 — 重读一次保持一致
      if (filled.updated > 0 && queryEmbedding) {
        const refreshed = await ctx.prisma.promptKnowledge.findMany({
          where: { id: { in: entries.map((e) => e.id) } },
          select: { id: true, embedding: true },
        });
        const vecMap = new Map(refreshed.map((r) => [r.id, r.embedding]));
        for (const e of entries) {
          const v = vecMap.get(e.id);
          if (Array.isArray(v)) e.embedding = v as number[];
        }
      }
    }

    // 逐维检索(docs/07 §2 Retriever:八维逐维 top-k≤3)
    const lines: string[] = [];
    const usedIds: string[] = [];
    for (const r of plan.retrievals) {
      const out = retrieveTopK(entries, {
        dimension: r.dimension,
        k: r.k,
        filter: plan.filter,
        // 通用维不参与语义排名(词包 vs 叙事 query 余弦天然低),走 keyword→tag 链
        queryEmbedding: r.allowTagFallback ? null : queryEmbedding,
        queryText: plan.queryText,
        minSimilarity: EMBEDDING_MIN_SIMILARITY,
        allowTagFallback: r.allowTagFallback,
      });
      for (const hit of out) {
        const label = PROMPT_DIMENSION_LABEL[hit.entry.dimension] ?? hit.entry.dimension;
        lines.push(`- [${label}] ${hit.entry.title}:${hit.entry.content}`);
        usedIds.push(hit.entry.id);
      }
    }
    if (lines.length === 0) return null;

    // H2:回填命中片段 id 给装配方(run.fragmentIds 飞轮数据源)
    ctx.usedKnowledgeFragmentIds = [...usedIds];

    // 飞轮数据(H3):命中计数 + 最近使用(失败不阻塞渲染)
    try {
      await ctx.prisma.promptKnowledge.updateMany({
        where: { id: { in: usedIds } },
        data: { hitCount: { increment: 1 }, lastUsedAt: new Date() },
      });
    } catch (e) {
      console.warn('[knowledge-contributor] hitCount 更新失败(不影响本次优化):', e);
    }

    return `【创作知识】(检索自八维知识库,按需吸收进正文 — 与 @token 指向、剧情事实或上文冲突时,以上文为准)\n${lines.join('\n')}`;
  },
};
