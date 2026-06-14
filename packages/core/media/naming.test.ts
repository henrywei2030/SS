/**
 * 媒体中文命名规范测试(六八)— 纯函数,锁住「主体_用途」格式与消毒行为。
 */
import { describe, expect, it } from 'vitest';

import {
  assetCategoryFromType,
  assetImageFilename,
  episodeRenderBasename,
  normalizedVoiceFilename,
  sanitizeMediaName,
  shotTakeFilename,
  voiceSampleFilename,
} from './naming.js';

describe('sanitizeMediaName', () => {
  it('中文 / 空格 / 连字符原样保留', () => {
    expect(sanitizeMediaName('陆乘 - 重生初期')).toBe('陆乘 - 重生初期');
  });

  it('文件系统非法字符替换为 _ 并合并连续 _', () => {
    expect(sanitizeMediaName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(sanitizeMediaName('a//**||b')).toBe('a_b');
  });

  it('控制字符替换为 _', () => {
    const raw = `a${String.fromCharCode(1)}b${String.fromCharCode(31)}c`;
    expect(sanitizeMediaName(raw)).toBe('a_b_c');
  });

  it('空白折叠 + 首尾裁剪 + 超长截断', () => {
    expect(sanitizeMediaName('  甲   乙  ')).toBe('甲 乙');
    expect(sanitizeMediaName('长'.repeat(100))).toHaveLength(60);
  });

  it('空输入返回空串(调用方兜底)', () => {
    expect(sanitizeMediaName('')).toBe('');
  });
});

describe('assetCategoryFromType', () => {
  it('三类直通,其余归 OTHER', () => {
    expect(assetCategoryFromType('CHARACTER')).toBe('CHARACTER');
    expect(assetCategoryFromType('SCENE')).toBe('SCENE');
    expect(assetCategoryFromType('PROP')).toBe('PROP');
    expect(assetCategoryFromType('STYLE_REFERENCE')).toBe('OTHER');
  });
});

describe('文件名 builders(主体_用途 格式)', () => {
  it('人物声线样本:名_参考声音.mp3', () => {
    expect(voiceSampleFilename('林小满')).toBe('林小满_参考声音.mp3');
    expect(voiceSampleFilename('')).toBe('角色_参考声音.mp3');
  });

  it('规范化音频:原名去扩展名_规范化.mp3', () => {
    expect(normalizedVoiceFilename('林小满_参考声音.m4a')).toBe('林小满_参考声音_规范化.mp3');
    expect(normalizedVoiceFilename('voice.wav')).toBe('voice_规范化.mp3');
  });

  it('生成图:主体_槽位中文_MMDD-序.png(中文主体保留)', () => {
    const at = new Date(2026, 5, 10); // 2026-06-10
    expect(assetImageFilename('林小满', 'portrait', at, 0)).toBe('林小满_形象_0610-1.png');
    expect(assetImageFilename('天台', 'scene_main', at, 2)).toBe('天台_主视角_0610-3.png');
    expect(assetImageFilename('怀表', 'three_view', at, 0)).toBe('怀表_三视图_0610-1.png');
  });

  it('未知槽位回退原串', () => {
    const at = new Date(2026, 5, 10);
    expect(assetImageFilename('甲', 'unknown_slot', at, 0)).toBe('甲_unknown_slot_0610-1.png');
  });

  it('分镜视频 take:项目_第E集_分镜G_第K次.mp4', () => {
    expect(shotTakeFilename('星垣往事', 2, 'G3', 1)).toBe('星垣往事_第2集_分镜G3_第1次.mp4');
    expect(shotTakeFilename(null, null, null, 1)).toBe('项目_本集_分镜组_第1次.mp4');
  });

  it('整集成片基名:项目_第E集_成片_第K次', () => {
    expect(episodeRenderBasename('星垣往事', 2, 1)).toBe('星垣往事_第2集_成片_第1次');
    expect(episodeRenderBasename(undefined, 1, 3)).toBe('项目_第1集_成片_第3次');
  });
});
