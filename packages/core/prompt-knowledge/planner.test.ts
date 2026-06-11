/**
 * H1(docs/07 §2):确定性 Planner 单测 — 结构化字段推维度的规则锁定。
 */
import { describe, expect, it } from 'vitest';

import { planKnowledgeRetrieval } from './planner.js';
import { retrieveTopK, type RetrievableKnowledgeEntry } from './retrieval.js';

const baseInput = {
  groupPrompt: '',
  shots: [] as Array<{ content?: string | null; lighting?: string | null; movement?: string | null }>,
  hasCharacterAssets: false,
  providerFamily: 'seedance',
};

const dims = (plan: ReturnType<typeof planKnowledgeRetrieval>) =>
  plan.retrievals.map((r) => r.dimension);

describe('planKnowledgeRetrieval — 维度规则', () => {
  it('空组也保底:QUALITY/CONSTRAINT 永远在(八要素 #7/#8 全缺是 H0 动机)', () => {
    const plan = planKnowledgeRetrieval(baseInput);
    expect(dims(plan)).toEqual(['QUALITY', 'CONSTRAINT']);
    expect(plan.retrievals.every((r) => r.allowTagFallback)).toBe(true);
  });

  it('有正文 → ACTION/SCENE/STYLE 进场,且都是对症维(不许 tag 兜底)', () => {
    const plan = planKnowledgeRetrieval({ ...baseInput, groupPrompt: '林凡紧张地回头' });
    expect(dims(plan)).toEqual(
      expect.arrayContaining(['ACTION', 'SCENE', 'STYLE']),
    );
    for (const d of ['ACTION', 'SCENE', 'STYLE']) {
      expect(plan.retrievals.find((r) => r.dimension === d)?.allowTagFallback).toBe(false);
    }
  });

  it('夜戏信号(文本时段词)→ LIGHTING;无信号不进', () => {
    expect(dims(planKnowledgeRetrieval({ ...baseInput, groupPrompt: '深夜的天台' }))).toContain(
      'LIGHTING',
    );
    expect(dims(planKnowledgeRetrieval({ ...baseInput, groupPrompt: '白天的院子' }))).not.toContain(
      'LIGHTING',
    );
  });

  it('lighting 字段有值同样触发 LIGHTING(夜戏→光影的字段路径)', () => {
    const plan = planKnowledgeRetrieval({
      ...baseInput,
      shots: [{ content: 'x', lighting: '低调' }],
    });
    expect(dims(plan)).toContain('LIGHTING');
  });

  it('≥2 镜或有运镜 → CAMERA', () => {
    expect(
      dims(planKnowledgeRetrieval({ ...baseInput, shots: [{ content: 'a' }, { content: 'b' }] })),
    ).toContain('CAMERA');
    expect(
      dims(planKnowledgeRetrieval({ ...baseInput, shots: [{ content: 'a', movement: '推' }] })),
    ).toContain('CAMERA');
    expect(
      dims(planKnowledgeRetrieval({ ...baseInput, shots: [{ content: 'a' }] })),
    ).not.toContain('CAMERA');
  });

  it('绑定人物 → SUBJECT(通用纪律,tag 兜底放行)', () => {
    const plan = planKnowledgeRetrieval({ ...baseInput, hasCharacterAssets: true });
    const subject = plan.retrievals.find((r) => r.dimension === 'SUBJECT');
    expect(subject).toBeDefined();
    expect(subject?.allowTagFallback).toBe(true);
  });

  it('queryText = 组正文 + 逐镜内容/音效拼接;filter 带模型家族', () => {
    const plan = planKnowledgeRetrieval({
      ...baseInput,
      groupPrompt: '正文',
      shots: [{ content: '镜1内容', lighting: null }, { content: '镜2', movement: null }],
      providerFamily: 'kling',
    });
    expect(plan.queryText).toContain('正文');
    expect(plan.queryText).toContain('镜1内容');
    expect(plan.filter).toEqual({ family: 'kling' });
  });
});

describe('planner × retrieveTopK 协同(对症维宁缺毋滥)', () => {
  const entry = (
    id: string,
    dimension: string,
    over: Partial<RetrievableKnowledgeEntry> = {},
  ): RetrievableKnowledgeEntry => ({
    id,
    dimension,
    title: id,
    content: id,
    tags: {},
    ...over,
  });

  it('SCENE 对症维:keyword 零命中 → 空(不把治愈塞进紧张戏);QUALITY 通用维仍有 tag 兜底', () => {
    const entries = [
      entry('治愈清新', 'SCENE', { tags: { mood: ['治愈'], keywords: ['花田'] } }),
      entry('画质三件套', 'QUALITY'),
    ];
    const plan = planKnowledgeRetrieval({ ...baseInput, groupPrompt: '陆峰攥紧拳头对峙' });
    const scenePlan = plan.retrievals.find((r) => r.dimension === 'SCENE')!;
    const qualityPlan = plan.retrievals.find((r) => r.dimension === 'QUALITY')!;

    const sceneOut = retrieveTopK(entries, {
      dimension: 'SCENE',
      k: scenePlan.k,
      queryText: plan.queryText,
      allowTagFallback: scenePlan.allowTagFallback,
    });
    expect(sceneOut).toEqual([]);

    const qualityOut = retrieveTopK(entries, {
      dimension: 'QUALITY',
      k: qualityPlan.k,
      queryText: plan.queryText,
      allowTagFallback: qualityPlan.allowTagFallback,
    });
    expect(qualityOut.map((r) => r.entry.id)).toEqual(['画质三件套']);
  });
});
