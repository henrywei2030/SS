/**
 * 多模态 content 构造单测(M3c)— 锁两家 API 的 part 形状与"无图零变化"承诺。
 */
import { describe, expect, it } from 'vitest';

import {
  buildAnthropicUserContent,
  buildOpenAIUserContent,
  parseAnthropicImageSource,
} from './multimodal.js';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

describe('buildOpenAIUserContent', () => {
  it('无图返回原字符串(存量纯文本路径零行为变化)', () => {
    expect(buildOpenAIUserContent('hello')).toBe('hello');
    expect(buildOpenAIUserContent('hello', [])).toBe('hello');
  });

  it('有图转 parts:图在前文在后,image_url 形状符合 chat/completions 规范', () => {
    const out = buildOpenAIUserContent('评分这段视频', ['https://a/1.jpg', PNG_DATA_URL]);
    expect(out).toEqual([
      { type: 'image_url', image_url: { url: 'https://a/1.jpg' } },
      { type: 'image_url', image_url: { url: PNG_DATA_URL } },
      { type: 'text', text: '评分这段视频' },
    ]);
  });
});

describe('parseAnthropicImageSource', () => {
  it('base64 data URL 解析成 base64 source(media_type 提取正确)', () => {
    expect(parseAnthropicImageSource(PNG_DATA_URL)).toEqual({
      type: 'base64',
      media_type: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUg==',
    });
  });

  it('http URL 透传成 url source', () => {
    expect(parseAnthropicImageSource('https://a/1.jpg')).toEqual({
      type: 'url',
      url: 'https://a/1.jpg',
    });
  });

  it('非 base64 编码的 data URL 不硬解,回退 url source', () => {
    const odd = 'data:text/plain,hello';
    expect(parseAnthropicImageSource(odd)).toEqual({ type: 'url', url: odd });
  });
});

describe('buildAnthropicUserContent', () => {
  it('无图返回原字符串', () => {
    expect(buildAnthropicUserContent('hello')).toBe('hello');
  });

  it('有图转 parts:data URL 走 base64 source,http 走 url source,文本压尾', () => {
    const out = buildAnthropicUserContent('评分', [PNG_DATA_URL, 'https://a/2.jpg']);
    expect(out).toEqual([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg==' },
      },
      { type: 'image', source: { type: 'url', url: 'https://a/2.jpg' } },
      { type: 'text', text: '评分' },
    ]);
  });
});
