/**
 * H0(docs/07):八维知识库检索纯函数单测 — 余弦 / tag 过滤 / 三档降级链。
 */
import { describe, expect, it } from 'vitest';

import {
  cosineSimilarity,
  matchesTagFilter,
  parseKnowledgeTags,
  retrieveTopK,
  type RetrievableKnowledgeEntry,
} from './retrieval.js';

const entry = (
  id: string,
  dimension: string,
  over: Partial<RetrievableKnowledgeEntry> = {},
): RetrievableKnowledgeEntry => ({
  id,
  dimension,
  title: `标题${id}`,
  content: `内容${id}`,
  tags: {},
  ...over,
});

describe('cosineSimilarity', () => {
  it('同向 1 / 正交 0 / 反向 -1', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 3])).toBeCloseTo(0, 10);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it('维数不一致 / 空向量 / 零范数 → 0(不抛,坏向量沉底)', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('matchesTagFilter', () => {
  it('条目无约束 = 通用,任何 filter 都命中', () => {
    expect(matchesTagFilter({}, { family: 'seedance' })).toBe(true);
    expect(matchesTagFilter({ family: [] }, { family: 'kling' })).toBe(true);
  });

  it('条目有约束:包含命中 / 不含拒绝', () => {
    expect(matchesTagFilter({ family: ['seedance', 'kling'] }, { family: 'kling' })).toBe(true);
    expect(matchesTagFilter({ family: ['seedance'] }, { family: 'kling' })).toBe(false);
  });

  it('filter 未指定的键不参与过滤;多键同时给则全须命中', () => {
    const tags = { family: ['seedance'], era: ['民国'] };
    expect(matchesTagFilter(tags, {})).toBe(true);
    expect(matchesTagFilter(tags, undefined)).toBe(true);
    expect(matchesTagFilter(tags, { family: 'seedance', era: '民国' })).toBe(true);
    expect(matchesTagFilter(tags, { family: 'seedance', era: '现代' })).toBe(false);
  });
});

describe('parseKnowledgeTags', () => {
  it('合法形状解析 + 非字符串项过滤', () => {
    expect(
      parseKnowledgeTags({ family: ['seedance', 1, ''], keywords: ['夜'], junk: 'x' }),
    ).toEqual({ family: ['seedance'], keywords: ['夜'] });
  });

  it('null / 数组 / 标量 → 空(通用条目)', () => {
    expect(parseKnowledgeTags(null)).toEqual({});
    expect(parseKnowledgeTags([1, 2])).toEqual({});
    expect(parseKnowledgeTags('x')).toEqual({});
  });
});

describe('retrieveTopK — 降级链', () => {
  it('embedding 模式:余弦降序取 top-k,无向量条目本轮不参赛', () => {
    const entries = [
      entry('a', 'LIGHTING', { embedding: [1, 0] }),
      entry('b', 'LIGHTING', { embedding: [0.9, 0.1] }),
      entry('c', 'LIGHTING', { embedding: [0, 1] }),
      entry('d', 'LIGHTING', { embedding: null }), // 未回填
    ];
    const out = retrieveTopK(entries, { queryEmbedding: [1, 0], k: 2 });
    expect(out.map((r) => r.entry.id)).toEqual(['a', 'b']);
    expect(out[0]?.method).toBe('embedding');
    expect(out[0]?.score).toBeCloseTo(1, 10);
  });

  it('embedding 模式:minSimilarity 剔除低分', () => {
    const entries = [
      entry('a', 'CAMERA', { embedding: [1, 0] }),
      entry('c', 'CAMERA', { embedding: [0, 1] }),
    ];
    const out = retrieveTopK(entries, { queryEmbedding: [1, 0], minSimilarity: 0.5 });
    expect(out.map((r) => r.entry.id)).toEqual(['a']);
  });

  it('keyword 模式:无查询向量 → keywords/title 命中计分', () => {
    const entries = [
      entry('a', 'ACTION', { tags: { keywords: ['紧张', '颤抖'] } }),
      entry('b', 'ACTION', { tags: { keywords: ['愤怒'] } }),
      entry('c', 'ACTION', { tags: { keywords: ['悲伤'] } }),
    ];
    const out = retrieveTopK(entries, { queryText: '林凡紧张地颤抖着回头', k: 3 });
    expect(out[0]?.entry.id).toBe('a');
    expect(out[0]?.score).toBe(2);
    expect(out[0]?.method).toBe('keyword');
    expect(out).toHaveLength(1); // b/c 零命中不返回(留给 tag 档,本例有命中故不降)
  });

  it('全库无向量但给了 queryEmbedding → 自动降级 keyword', () => {
    const entries = [entry('a', 'ACTION', { tags: { keywords: ['夜'] } })];
    const out = retrieveTopK(entries, { queryEmbedding: [1, 0], queryText: '夜里出门' });
    expect(out[0]?.method).toBe('keyword');
  });

  it('tag 模式:keyword 全零命中(通用维)→ 按 hitCount 热度排序', () => {
    const entries = [
      entry('a', 'QUALITY', { hitCount: 2 }),
      entry('b', 'QUALITY', { hitCount: 9 }),
      entry('c', 'QUALITY', { hitCount: 5 }),
    ];
    const out = retrieveTopK(entries, { queryText: '与画质词无关的正文', k: 2 });
    expect(out.map((r) => r.entry.id)).toEqual(['b', 'c']);
    expect(out[0]?.method).toBe('tag');
  });

  it('dimension / enabled / tag filter 预过滤生效', () => {
    const entries = [
      entry('a', 'QUALITY', { tags: { family: ['seedance'] }, hitCount: 1 }),
      entry('b', 'QUALITY', { tags: { family: ['kling'] }, hitCount: 9 }),
      entry('c', 'LIGHTING', { hitCount: 9 }),
      entry('d', 'QUALITY', { enabled: false, hitCount: 99 }),
      entry('e', 'QUALITY', { hitCount: 0 }), // 通用(无 family 约束)
    ];
    const out = retrieveTopK(entries, {
      dimension: 'QUALITY',
      filter: { family: 'seedance' },
      k: 10,
    });
    expect(out.map((r) => r.entry.id).sort()).toEqual(['a', 'e']);
  });

  it('空池 → 空数组;k 默认 3', () => {
    expect(retrieveTopK([], { queryText: 'x' })).toEqual([]);
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry(String(i), 'STYLE', { hitCount: i }),
    );
    expect(retrieveTopK(entries, {})).toHaveLength(3);
  });
});
