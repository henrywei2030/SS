/**
 * M6 优化器纯函数层单测 — token 保全守卫 / 开关解析 / 输出清理 /
 * contributor 渲染 / user prompt 装配(LLM 调用与落库走真打)。
 */
import { describe, expect, it } from 'vitest';

import type { PrismaClient } from '@ss/db';

import { buildOptimizerUserPrompt } from './optimize.js';
import { detectProviderFamily } from './fallback-template.js';
import {
  DEFAULT_CONTRIBUTORS,
  extractAtTokens,
  findLostTokens,
  parseEnabledContributors,
  stripLlmWrapping,
} from './guards.js';
import type { OptimizeContext } from './types.js';

function fixtureCtx(partial?: Partial<OptimizeContext>): OptimizeContext {
  return {
    prisma: null as unknown as PrismaClient,
    group: {
      id: 'g1',
      number: '1-8',
      prompt: '陆峰@图片1 在雨夜质问林凡@图片2,背景音乐@音频3 渐强',
      durationS: 10,
      episodeId: 'e1',
      projectId: 'p1',
    },
    shots: [
      {
        positionIdx: 1,
        framing: '特写',
        angle: '仰视 15°',
        movement: '固定',
        lighting: '低调',
        sound: '雨声,心跳声起',
        content: '陆峰逼近,雨水顺着下颌线滴落',
        durationS: 4,
        priority: 'S',
      },
      {
        positionIdx: 2,
        framing: '中景',
        angle: '平视',
        movement: '缓推',
        lighting: '低调',
        sound: null,
        content: '林凡后退半步,撞上铁门',
        durationS: 6,
        priority: null,
      },
    ],
    assets: [
      { name: '陆峰', type: 'CHARACTER', token: '@图片1', promptBrief: '三十岁,黑色风衣' },
      { name: '林凡', type: 'CHARACTER', token: '@图片2', promptBrief: '' },
    ],
    style: {
      characterPrompt: '伪真人质感',
      scenePrompt: null,
      propPrompt: null,
      forbiddenWords: ['血腥'],
    },
    prevGroup: {
      number: '1-7',
      prompt: '……陆峰推门而入',
      lastShotContent: '陆峰推开锈蚀的铁门',
      sameScene: true,
    },
    providerFamily: 'seedance',
    ...partial,
  };
}

describe('extractAtTokens / findLostTokens(核心护栏)', () => {
  it('提取中英数 token,去重保序', () => {
    expect(extractAtTokens('a @图片1 b @音频2 c @图片1 @ref-3')).toEqual([
      '@图片1',
      '@音频2',
      '@ref-3',
    ]);
  });

  it('全保留 → 通过;丢失/被改写 → 报缺失清单', () => {
    const orig = '陆峰@图片1 与 @音频3';
    expect(findLostTokens(orig, '优化后 @图片1 …… @音频3 收尾')).toEqual([]);
    expect(findLostTokens(orig, '优化后只剩 @图片1')).toEqual(['@音频3']);
    expect(findLostTokens(orig, '改写成 @图片01 和 @音频3')).toEqual(['@图片1']);
  });

  it('原文无 token 时恒通过(纯文本提示词可自由改写)', () => {
    expect(findLostTokens('没有引用的提示词', '完全重写')).toEqual([]);
  });
});

describe('parseEnabledContributors', () => {
  it('CSV 解析:去空白/去重/小写;空与全非法回默认四件套', () => {
    expect(parseEnabledContributors('shot, Assets ,shot')).toEqual(['shot', 'assets']);
    expect(parseEnabledContributors('')).toEqual([...DEFAULT_CONTRIBUTORS]);
    expect(parseEnabledContributors(undefined)).toEqual([...DEFAULT_CONTRIBUTORS]);
    expect(parseEnabledContributors(' , ,')).toEqual([...DEFAULT_CONTRIBUTORS]);
  });
});

describe('stripLlmWrapping', () => {
  it('剥代码围栏与首尾引号;正文不动', () => {
    expect(stripLlmWrapping('```text\n正文内容\n```')).toBe('正文内容');
    expect(stripLlmWrapping('"正文"')).toBe('正文');
    expect(stripLlmWrapping('  正文  ')).toBe('正文');
    expect(stripLlmWrapping('正文里有 "引号" 不受影响')).toBe('正文里有 "引号" 不受影响');
  });
});

describe('detectProviderFamily', () => {
  it('按子串识别家族,未知回 generic', () => {
    expect(detectProviderFamily('relay-doubao-seedance-2-0')).toBe('seedance');
    expect(detectProviderFamily('relay-kling-v2-6')).toBe('kling');
    expect(detectProviderFamily('happyhorse-r2v')).toBe('happyhorse');
    expect(detectProviderFamily('wan2.6')).toBe('generic');
    expect(detectProviderFamily(null)).toBe('generic');
  });
});

describe('buildOptimizerUserPrompt(装配)', () => {
  it('默认四件套:四段齐 + 风格指令 + 当前提示词压底;contributorsUsed 记实际产出', async () => {
    const { prompt, contributorsUsed } = await buildOptimizerUserPrompt(fixtureCtx(), [
      ...DEFAULT_CONTRIBUTORS,
    ]);
    expect(prompt).toContain('【镜头设计】');
    expect(prompt).toContain('景别:特写');
    expect(prompt).toContain('【绑定资产】');
    expect(prompt).toContain('@图片1 = 陆峰');
    expect(prompt).toContain('【项目风格】');
    expect(prompt).toContain('禁用词');
    expect(prompt).toContain('【上组衔接】');
    expect(prompt).toContain('【目标模型风格】');
    expect(prompt).toContain('叙事段落'); // seedance 家族指令
    expect(prompt).toContain('【当前提示词】');
    // 当前提示词在最后一个 section(优化对象压底,贴近输出指令)
    expect(prompt.indexOf('【当前提示词】')).toBeGreaterThan(prompt.indexOf('【上组衔接】'));
    expect(contributorsUsed).toEqual(['shot', 'assets', 'style', 'continuity']);
  });

  it('开关收窄 + 无内容维度自动消失(style=null 不产段)', async () => {
    const ctx = fixtureCtx({ style: null, prevGroup: null });
    const { prompt, contributorsUsed } = await buildOptimizerUserPrompt(ctx, ['shot', 'style']);
    expect(prompt).toContain('【镜头设计】');
    expect(prompt).not.toContain('【绑定资产】'); // 开关没开
    expect(prompt).not.toContain('【项目风格】'); // 开了但无内容
    expect(contributorsUsed).toEqual(['shot']);
  });

  it('切场时衔接段给"新场景开场"指引而非承接素材', async () => {
    const ctx = fixtureCtx({
      prevGroup: { number: '1-7', prompt: 'x', lastShotContent: 'y', sameScene: false },
    });
    const { prompt } = await buildOptimizerUserPrompt(ctx, ['continuity']);
    expect(prompt).toContain('已切场');
    expect(prompt).not.toContain('据此在开头交代承接');
  });
});
