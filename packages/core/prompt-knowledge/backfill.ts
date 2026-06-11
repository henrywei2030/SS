/**
 * H0(docs/07 §4.5):PromptKnowledge 懒 embedding 回填。
 *
 * seed / db:sync 必须离线、无 API key 可跑 → 条目 embedding=null 入库;
 * 首次检索(H1 knowledge contributor)调本函数批量补算回填。
 *
 * 纪律:
 *   - 需要重算的条目 = embedding 为空 **或** embeddingModel ≠ 当前 provider 模型
 *     (模型换了,旧向量语义空间/维数不可混 — retrieval.cosineSimilarity 对维数不一致返 0)
 *   - 任何失败不抛:返回统计,调用方按退化阶梯降级 tags+关键词检索(docs/07 §5)
 *   - 记账走 provider 内置 'embedding.generate'(独立 action;并入 prompt.optimize
 *     日预算池的收口在 H1/H2 流水线层定 — docs/07 §4.6)
 */
import type { PrismaClient } from '@ss/db';
import { getEmbeddingProvider } from '@ss/adapters/provider';

/** 待回填条目(调用方从 DB 取的行子集) */
export interface BackfillCandidate {
  id: string;
  title: string;
  content: string;
  embedding: unknown; // Prisma Json — number[] 或 null
  embeddingModel: string | null;
}

export interface BackfillResult {
  /** 成功写回的条目数 */
  updated: number;
  /** 本轮需要算但失败的条目数(provider 错误等) */
  failed: number;
  /** 实际使用的 embedding 模型 id;provider 拿不到(未配/坏)时 null */
  modelId: string | null;
}

/** 条目是否需要(重)算向量 */
export function needsEmbedding(e: BackfillCandidate, modelId: string): boolean {
  const hasVec = Array.isArray(e.embedding) && e.embedding.length > 0;
  return !hasVec || e.embeddingModel !== modelId;
}

/** 向量化文本口径:标题 + 正文(检索 query 侧 H1 用组正文,同一语义空间) */
export function embeddingTextOf(e: Pick<BackfillCandidate, 'title' | 'content'>): string {
  return `${e.title}\n${e.content}`;
}

/**
 * 批量懒回填。providerId 来自 binding `binding.prompt.embedding.modelId`(留空 = 调用方
 * 不应调到这里);batch 默认 32 条/次(embedding 输入小,单批秒级)。
 */
export async function backfillKnowledgeEmbeddings(
  prisma: PrismaClient,
  args: {
    providerId: string;
    entries: BackfillCandidate[];
    ctx: { userId: string; projectId?: string };
    batchSize?: number;
  },
): Promise<BackfillResult> {
  let provider;
  try {
    provider = await getEmbeddingProvider(args.providerId);
  } catch (e) {
    // provider 未配/坏 → 全部降级(调用方走 tags 检索),不抛
    console.warn(
      `[prompt-knowledge] embedding provider "${args.providerId}" 不可用,降级 tags 检索:`,
      e instanceof Error ? e.message : e,
    );
    return { updated: 0, failed: 0, modelId: null };
  }
  const modelId = provider.info.id;
  // provider 声明的单请求上限优先于默认 32(通义 v4 经 moyu ≤10,defaultParams.embeddingBatchSize 配)
  const batchSize = Math.max(1, args.batchSize ?? provider.maxBatchSize ?? 32);

  const todo = args.entries.filter((e) => needsEmbedding(e, modelId));
  if (todo.length === 0) return { updated: 0, failed: 0, modelId };

  let updated = 0;
  let failed = 0;
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    try {
      const result = await provider.embed(
        { texts: batch.map(embeddingTextOf) },
        { userId: args.ctx.userId, projectId: args.ctx.projectId },
      );
      // 逐条写回(非事务:部分成功也保留 — 下轮只补剩余;embedding 是派生数据可随时重算)
      for (let j = 0; j < batch.length; j++) {
        const vec = result.embeddings[j];
        if (!vec) {
          failed++;
          continue;
        }
        await prisma.promptKnowledge.update({
          where: { id: batch[j]!.id },
          data: { embedding: vec, embeddingModel: modelId },
        });
        updated++;
      }
    } catch (e) {
      failed += batch.length;
      console.warn(
        `[prompt-knowledge] embedding 批量回填失败(${batch.length} 条,继续下一批):`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return { updated, failed, modelId };
}
