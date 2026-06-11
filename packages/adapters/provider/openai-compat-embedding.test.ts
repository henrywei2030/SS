/**
 * H0(docs/07):embedding 适配器单测 — 纯函数层(响应解析 / 成本估算),不打网络。
 * 解析必须严格:静默缺行/错位会让 PromptKnowledge 懒回填把向量写错条目(检索全错还查不出)。
 */
import { describe, expect, it } from 'vitest';

import {
  OpenAICompatEmbeddingProvider,
  parseEmbeddingsResponse,
} from './openai-compat-embedding.js';

describe('parseEmbeddingsResponse', () => {
  it('happy path:按 index 重排 + usage 透传', () => {
    const { embeddings, inputTokens } = parseEmbeddingsResponse(
      {
        data: [
          { index: 1, embedding: [0.4, 0.5] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
        usage: { prompt_tokens: 12 },
      },
      2,
    );
    expect(embeddings).toEqual([
      [0.1, 0.2],
      [0.4, 0.5],
    ]);
    expect(inputTokens).toBe(12);
  });

  it('index 缺失:按数组位置兜底(部分中转站不回 index)', () => {
    const { embeddings } = parseEmbeddingsResponse(
      { data: [{ embedding: [1] }, { embedding: [2] }] },
      2,
    );
    expect(embeddings).toEqual([[1], [2]]);
  });

  it('数量不符 → 抛错(防静默缺行写错条目)', () => {
    expect(() =>
      parseEmbeddingsResponse({ data: [{ index: 0, embedding: [1] }] }, 2),
    ).toThrow(/数量不符/);
  });

  it('index 越界 / 重复 → 抛错', () => {
    expect(() =>
      parseEmbeddingsResponse({ data: [{ index: 5, embedding: [1] }] }, 1),
    ).toThrow(/index 非法/);
    expect(() =>
      parseEmbeddingsResponse(
        {
          data: [
            { index: 0, embedding: [1] },
            { index: 0, embedding: [2] },
          ],
        },
        2,
      ),
    ).toThrow(/index 非法|重复/);
  });

  it('非法向量(空 / 非数字 / NaN)→ 抛错', () => {
    expect(() => parseEmbeddingsResponse({ data: [{ index: 0, embedding: [] }] }, 1)).toThrow();
    expect(() =>
      parseEmbeddingsResponse({ data: [{ index: 0, embedding: ['a'] }] }, 1),
    ).toThrow();
    expect(() =>
      parseEmbeddingsResponse({ data: [{ index: 0, embedding: [Number.NaN] }] }, 1),
    ).toThrow();
  });

  it('缺 data 数组 → 抛错', () => {
    expect(() => parseEmbeddingsResponse({ error: { message: 'x' } }, 1)).toThrow(/缺 data/);
    expect(() => parseEmbeddingsResponse(null, 1)).toThrow(/缺 data/);
  });

  it('usage 缺失 → inputTokens 0(由调用方按字符估算兜底)', () => {
    const { inputTokens } = parseEmbeddingsResponse(
      { data: [{ index: 0, embedding: [1] }] },
      1,
    );
    expect(inputTokens).toBe(0);
  });
});

describe('OpenAICompatEmbeddingProvider — estimateCost / info', () => {
  const provider = new OpenAICompatEmbeddingProvider({
    apiUrl: 'https://relay.example/v1',
    apiKey: 'sk-test',
    defaultModel: 'text-embedding-v4',
    unitPriceCny: 0.0014, // per 1K tokens
  });

  it('info:kind=embedding / unitName=ktoken', () => {
    expect(provider.info.kind).toBe('embedding');
    expect(provider.info.unitName).toBe('ktoken');
    expect(provider.info.id).toBe('text-embedding-v4');
  });

  it('estimateCost:字符/4 估 token,只算输入侧', () => {
    // 800 字符 → 200 token → 0.2K × 0.0014 = 0.00028
    expect(provider.estimateCost({ texts: ['x'.repeat(400), 'y'.repeat(400)] })).toBeCloseTo(
      0.00028,
      8,
    );
  });

  it('modelRate 倍率优先(embedding 无输出侧,outputRate 不参与)', () => {
    const p2 = new OpenAICompatEmbeddingProvider({
      apiUrl: 'https://relay.example/v1',
      apiKey: 'sk-test',
      defaultModel: 'text-embedding-v4',
      unitPriceCny: 0,
      modelRate: 0.7, // ¥/1M tokens
      outputRate: 5,
    });
    // 4000 字符 → 1000 token → 1000/1M × 0.7 = 0.0007
    expect(p2.estimateCost({ texts: ['z'.repeat(4000)] })).toBeCloseTo(0.0007, 8);
  });
});
