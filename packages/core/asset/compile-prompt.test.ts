import { describe, expect, it } from 'vitest';

import { compileAssetPrompt } from './compile-prompt.js';

describe('compileAssetPrompt', () => {
  it('人物 + 风格 + 槽位 portrait — 拼出 4 段', () => {
    const r = compileAssetPrompt({
      asset: {
        type: 'CHARACTER',
        name: '陆乘',
        description: '20-25 岁男性',
        prompt: '清瘦,黑色短发,粗布衣',
      },
      style: {
        characterPrompt: '核心风格:照片级写实,真实人类,电影级摄影',
        forbiddenWords: ['动漫', '卡通', '变形'],
      },
      slot: 'portrait',
    });
    expect(r.positive).toContain('照片级写实');
    expect(r.positive).toContain('20-25 岁男性');
    expect(r.positive).toContain('清瘦,黑色短发');
    expect(r.positive).toContain('9:16 竖版正面');
    expect(r.negative).toBe('动漫、卡通、变形');
  });

  it('场景 + scene_front 槽位 — 用 scenePrompt + 正面构图', () => {
    const r = compileAssetPrompt({
      asset: { type: 'SCENE', name: '土屋', prompt: '破败土屋,土墙开裂' },
      style: {
        scenePrompt: '核心风格:照片级写实,8K 超清',
        characterPrompt: '不应被用',
      },
      slot: 'scene_front',
    });
    expect(r.parts.stylePart).toBe('核心风格:照片级写实,8K 超清');
    expect(r.parts.stylePart).not.toContain('不应被用');
    expect(r.parts.slotPart).toContain('正面视角');
  });

  it('道具 + main 槽位 — 用 propPrompt + 产品图构图', () => {
    const r = compileAssetPrompt({
      asset: { type: 'PROP', name: '玉瓶', prompt: '冰种玉质瓶' },
      style: { propPrompt: '高质量道具图,PBR 渲染' },
      slot: 'main',
    });
    expect(r.parts.stylePart).toContain('高质量道具图');
    expect(r.parts.slotPart).toContain('产品图');
  });

  it('无 style 时跳过风格段(不抛错)', () => {
    const r = compileAssetPrompt({
      asset: { type: 'CHARACTER', name: 'X', prompt: 'p' },
    });
    expect(r.parts.stylePart).toBe('');
    expect(r.positive).toContain('p');
    expect(r.negative).toBe('');
  });

  it('description 为 null 时跳过描述段', () => {
    const r = compileAssetPrompt({
      asset: { type: 'CHARACTER', name: 'X', description: null, prompt: 'p' },
    });
    expect(r.parts.descriptionPart).toBe('');
  });

  it('extraNegative 与 style.forbiddenWords 合并', () => {
    const r = compileAssetPrompt({
      asset: { type: 'CHARACTER', name: 'X', prompt: 'p' },
      style: { forbiddenWords: ['模糊', '低多边形'] },
      extraNegative: ['现代手表', '塑料感'],
    });
    expect(r.negative).toBe('模糊、低多边形、现代手表、塑料感');
  });

  it('extraInstruction 追加到末尾(用户额外指令)', () => {
    const r = compileAssetPrompt({
      asset: { type: 'CHARACTER', name: 'X', prompt: 'p' },
      extraInstruction: '增加雨天氛围',
    });
    expect(r.positive.endsWith('增加雨天氛围')).toBe(true);
  });

  it('STYLE_REFERENCE 不附加风格段(它本身就是风格)', () => {
    const r = compileAssetPrompt({
      asset: { type: 'STYLE_REFERENCE', name: '80s 乡村', prompt: '风格定义' },
      style: { characterPrompt: '不应被附加', propPrompt: '不应被附加' },
    });
    expect(r.parts.stylePart).toBe('');
  });

  it('three_view 槽位用 16:9 三视图描述', () => {
    const r = compileAssetPrompt({
      asset: { type: 'CHARACTER', name: '陆乘', prompt: 'p' },
      slot: 'three_view',
    });
    expect(r.parts.slotPart).toContain('16:9');
    expect(r.parts.slotPart).toContain('正面、侧面、背面');
  });

  it('panorama 槽位用 2:1 等距圆柱', () => {
    const r = compileAssetPrompt({
      asset: { type: 'SCENE', name: 'X', prompt: 'p' },
      slot: 'panorama',
    });
    expect(r.parts.slotPart).toContain('等距圆柱');
    expect(r.parts.slotPart).toContain('2:1');
  });

  it('reference 槽位不附加构图(纯参考)', () => {
    const r = compileAssetPrompt({
      asset: { type: 'CHARACTER', name: 'X', prompt: 'p' },
      slot: 'reference',
    });
    expect(r.parts.slotPart).toBe('');
  });
});
