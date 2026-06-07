import { describe, it, expect } from 'vitest';

import { buildSceneTag } from './generate.js';

describe('storyboard/generate · buildSceneTag', () => {
  it('场号 + 场地名', () => {
    expect(buildSceneTag('1-1', '苏瑶闺房')).toBe('【场1-1 苏瑶闺房】');
  });

  it('场地为占位「未指定」时只留场号', () => {
    expect(buildSceneTag('1-2', '未指定')).toBe('【场1-2】');
  });

  it('场地为空 / 缺省 / null 时只留场号', () => {
    expect(buildSceneTag('1-3', '')).toBe('【场1-3】');
    expect(buildSceneTag('2-1', null)).toBe('【场2-1】');
    expect(buildSceneTag('2-2')).toBe('【场2-2】');
  });

  it('场地前后空白被裁剪', () => {
    expect(buildSceneTag('3-1', '  宫门外  ')).toBe('【场3-1 宫门外】');
  });

  it('同场号一致、跨场号不同(合并统一标准的前提)', () => {
    expect(buildSceneTag('1-1', '苏瑶闺房')).toBe(buildSceneTag('1-1', '苏瑶闺房'));
    expect(buildSceneTag('1-1')).not.toBe(buildSceneTag('1-2'));
  });

  it('不含 @图片/@音频 token — 不会被 compile 的 token 正则误匹配', () => {
    expect(/@(图片|音频)\d+/.test(buildSceneTag('1-1', '苏瑶闺房'))).toBe(false);
  });
});
