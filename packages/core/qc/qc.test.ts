/**
 * QC 纯函数层单测(M3c)— verdict 解析 clamp / prompt 构造 / job payload schema。
 * IO 部分(抽帧/判官调用/落库)走真打验收,不在单测范围。
 */
import { describe, expect, it } from 'vitest';

import { buildQcPrompt, parseQcVerdict, QC_PROMPT_MAX_CHARS } from './evaluate.js';
import { QcJobDataSchema } from './process-job.js';

const CUID = 'cjld2cjxh0000qzrmn831i7rn';

describe('parseQcVerdict', () => {
  it('规整路径:分数取整 clamp、notes 透传', () => {
    const v = parseQcVerdict({
      score: 85.6,
      dims: { clarity: 90, promptAdherence: 80.2, faceConsistency: 85 },
      drift: false,
      notes: '可用',
    });
    expect(v).toEqual({
      score: 86,
      dims: { clarity: 90, promptAdherence: 80, faceConsistency: 85 },
      drift: false,
      notes: '可用',
    });
  });

  it('越界 clamp 0-100;faceConsistency null/缺省统一成 null;notes 缺省空串', () => {
    const v = parseQcVerdict({
      score: 130,
      dims: { clarity: -5, promptAdherence: 999 },
      drift: true,
    });
    expect(v.score).toBe(100);
    expect(v.dims.clarity).toBe(0);
    expect(v.dims.promptAdherence).toBe(100);
    expect(v.dims.faceConsistency).toBeNull();
    expect(v.notes).toBe('');
  });

  it('巨数 clamp 上限;超长 notes 截 500(NaN/Infinity 进不了 JSON,zod 层已拒)', () => {
    const v = parseQcVerdict({
      score: 1e9,
      dims: { clarity: 1e9, promptAdherence: 50 },
      drift: false,
      notes: 'x'.repeat(600),
    });
    expect(v.score).toBe(100);
    expect(v.dims.clarity).toBe(100);
    expect(v.notes).toHaveLength(500);
  });

  it('形状不符(缺 dims)直接 throw — 调用方按不可解析处理', () => {
    expect(() => parseQcVerdict({ score: 80, drift: false })).toThrow();
  });
});

describe('buildQcPrompt', () => {
  it('带人物参考图:说明帧顺序 + 人物名单进 prompt', () => {
    const { system, prompt } = buildQcPrompt({
      prompt: '林凡在雨夜奔跑',
      frameCount: 3,
      portraitNames: ['林凡', '陆峰'],
    });
    expect(system).toContain('clarity');
    expect(system).toContain('drift');
    expect(prompt).toContain('前 3 张是视频抽帧');
    expect(prompt).toContain('林凡、陆峰');
    expect(prompt).toContain('林凡在雨夜奔跑');
  });

  it('无人物参考图:明示 faceConsistency 输出 null + drift false', () => {
    const { prompt } = buildQcPrompt({ prompt: 'p', frameCount: 3, portraitNames: [] });
    expect(prompt).toContain('没有人物参考图');
    expect(prompt).toContain('faceConsistency 输出 null');
  });

  it('超长提示词按上限截断(评分不需要全文)', () => {
    const { prompt } = buildQcPrompt({
      prompt: 'a'.repeat(QC_PROMPT_MAX_CHARS + 500),
      frameCount: 3,
      portraitNames: [],
    });
    expect(prompt).toContain('…(截断)');
    expect(prompt.length).toBeLessThan(QC_PROMPT_MAX_CHARS + 400);
  });
});

describe('QcJobDataSchema', () => {
  const base = {
    attemptId: CUID,
    projectId: CUID,
    episodeId: CUID,
    shotGroupId: CUID,
    userId: CUID,
    prompt: '镜头描述',
  };

  it('合法 payload 通过;requestId 可选', () => {
    expect(QcJobDataSchema.parse(base)).toMatchObject({ prompt: '镜头描述' });
    expect(QcJobDataSchema.parse({ ...base, requestId: 'r1' }).requestId).toBe('r1');
  });

  it('缺 prompt / 非 cuid 拒收', () => {
    expect(() => QcJobDataSchema.parse({ ...base, prompt: '' })).toThrow();
    expect(() => QcJobDataSchema.parse({ ...base, attemptId: 'not-cuid' })).toThrow();
  });
});
