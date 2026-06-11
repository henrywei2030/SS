/**
 * H2(docs/07):判官纯函数单测 — 输出消毒(防注入面)+ repairDims 推导 + user prompt 形状。
 */
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@ss/db';

import { buildJudgeUserPrompt, sanitizeJudgeVerdict } from './judge.js';
import type { OptimizeContext } from './types.js';

describe('sanitizeJudgeVerdict', () => {
  it('合法八维:clamp 0-100 + issue 截断 80 字', () => {
    const v = sanitizeJudgeVerdict({
      dims: {
        SUBJECT: { score: 150, issue: 'x'.repeat(200) },
        ACTION: { score: -5, issue: '抽象词未翻译' },
      },
    });
    expect(v?.dims.SUBJECT?.score).toBe(100);
    expect(v?.dims.SUBJECT?.issue).toHaveLength(80);
    expect(v?.dims.ACTION?.score).toBe(0);
  });

  it('repairDims:按分数 <60 升序取前 3,不信模型自报清单', () => {
    const v = sanitizeJudgeVerdict({
      dims: {
        SUBJECT: { score: 90, issue: '' },
        ACTION: { score: 30, issue: 'a' },
        SCENE: { score: 50, issue: 'b' },
        LIGHTING: { score: 55, issue: 'c' },
        CAMERA: { score: 58, issue: 'd' },
      },
      repair: ['SUBJECT', '__proto__'], // 模型自报清单被忽略
    });
    expect(v?.repairDims).toEqual(['ACTION', 'SCENE', 'LIGHTING']); // 升序前 3,CAMERA 58 被截
  });

  it('未知维度键 / 非数字分数被丢弃;全空 → null', () => {
    const v = sanitizeJudgeVerdict({
      dims: { HACK: { score: 0, issue: '' }, SUBJECT: { score: 'high' } },
    });
    expect(v).toBeNull();
    expect(sanitizeJudgeVerdict(null)).toBeNull();
    expect(sanitizeJudgeVerdict({ dims: 'x' })).toBeNull();
  });

  it('缺维 = 未评(不补零不触发修复)', () => {
    const v = sanitizeJudgeVerdict({ dims: { STYLE: { score: 85, issue: '' } } });
    expect(Object.keys(v?.dims ?? {})).toEqual(['STYLE']);
    expect(v?.repairDims).toEqual([]);
  });
});

describe('buildJudgeUserPrompt', () => {
  it('含镜头参照/资产对照/待检文本三段', () => {
    const ctx = {
      prisma: null as unknown as PrismaClient,
      userId: 'u1',
      group: {
        id: 'g',
        number: '1',
        prompt: 'p',
        durationS: 5,
        episodeId: 'e',
        projectId: 'p1',
      },
      shots: [
        {
          positionIdx: 1,
          framing: '特写',
          angle: null,
          movement: '推',
          lighting: null,
          sound: null,
          content: '陆峰逼近',
          durationS: 3,
          priority: null,
        },
      ],
      assets: [{ name: '陆峰', type: 'CHARACTER', token: '@图片1', promptBrief: '' }],
      style: null,
      prevGroup: null,
      providerFamily: 'seedance',
    } as OptimizeContext;
    const p = buildJudgeUserPrompt(ctx, '待检正文@图片1');
    expect(p).toContain('镜1(特写·推 3s) 陆峰逼近');
    expect(p).toContain('@图片1=陆峰(CHARACTER)');
    expect(p).toContain('【待检提示词】\n待检正文@图片1');
  });
});
