/**
 * H0(docs/07 §4.5):懒回填纯函数单测(needsEmbedding 重算判定 / 向量化文本口径)。
 * backfillKnowledgeEmbeddings 主体是 provider+DB 编排,由 H1 接线后的真打验收覆盖。
 */
import { describe, expect, it } from 'vitest';

import { embeddingTextOf, needsEmbedding } from './backfill.js';

const cand = (embedding: unknown, embeddingModel: string | null) => ({
  id: 'x',
  title: 't',
  content: 'c',
  embedding,
  embeddingModel,
});

describe('needsEmbedding', () => {
  it('无向量(null / 空数组 / 非数组 Json)→ 需要', () => {
    expect(needsEmbedding(cand(null, null), 'm1')).toBe(true);
    expect(needsEmbedding(cand([], 'm1'), 'm1')).toBe(true);
    expect(needsEmbedding(cand({ bad: 1 }, 'm1'), 'm1')).toBe(true);
  });

  it('有向量且模型一致 → 不需要', () => {
    expect(needsEmbedding(cand([0.1, 0.2], 'm1'), 'm1')).toBe(false);
  });

  it('有向量但模型换了 → 需要重算(语义空间不可混)', () => {
    expect(needsEmbedding(cand([0.1, 0.2], 'old-model'), 'new-model')).toBe(true);
    expect(needsEmbedding(cand([0.1, 0.2], null), 'm1')).toBe(true);
  });
});

describe('embeddingTextOf', () => {
  it('标题 + 换行 + 正文(检索 query 同一语义空间口径)', () => {
    expect(embeddingTextOf({ title: '暖黄逆光', content: '暖黄逆光、发丝光勾边' })).toBe(
      '暖黄逆光\n暖黄逆光、发丝光勾边',
    );
  });
});
