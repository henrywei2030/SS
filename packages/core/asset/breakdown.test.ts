import { describe, expect, it } from 'vitest';

import { extractAssets } from './breakdown.js';

describe('extractAssets', () => {
  it('完整 JSON 三类资产正确分组', () => {
    const json = {
      characters: [
        {
          name: '陆乘',
          alias: ['阿乘', '哥'],
          description: '20-25 岁男性',
          prompt: '20-25 岁中国男性,身材消瘦',
          characterRole: '主演-男主',
          tags: ['坚毅'],
        },
      ],
      scenes: [
        {
          name: '陆乘家破土屋',
          alias: ['土屋'],
          description: '1983 年农村破土屋',
          prompt: '1983 年中国农村破败土屋内景',
          tags: ['1980s'],
        },
      ],
      props: [
        {
          name: '1983 年挂历',
          alias: ['挂历'],
          description: '墙上挂历',
          prompt: '1983 年挂历红色 12 数字',
          tags: ['关键道具'],
        },
      ],
    };
    const r = extractAssets(json, 20);
    expect(r.characters).toHaveLength(1);
    expect(r.scenes).toHaveLength(1);
    expect(r.props).toHaveLength(1);
    expect(r.characters[0]).toMatchObject({
      name: '陆乘',
      characterRole: '主演-男主',
      alias: ['阿乘', '哥'],
    });
  });

  it('characters 超过 max 数被截断', () => {
    const characters = Array.from({ length: 30 }, (_, i) => ({
      name: `人物${i}`,
      prompt: `prompt${i}`,
      alias: [],
      tags: [],
    }));
    const r = extractAssets({ characters }, 5);
    expect(r.characters).toHaveLength(5);
  });

  it('scenes 和 props 不接受 characterRole 字段(只 characters 有)', () => {
    const json = {
      scenes: [
        {
          name: '场景 A',
          prompt: 'p',
          characterRole: '主演-男主', // 应被忽略
          alias: [],
          tags: [],
        },
      ],
    };
    const r = extractAssets(json, 20);
    expect(r.scenes[0]).not.toHaveProperty('characterRole');
  });

  it('缺 name 或 prompt 的项被丢弃', () => {
    const json = {
      characters: [
        { name: '', prompt: 'p', alias: [], tags: [] },
        { name: 'A', prompt: '', alias: [], tags: [] },
        { name: 'B', prompt: 'p', alias: [], tags: [] }, // 唯一保留
      ],
    };
    const r = extractAssets(json, 20);
    expect(r.characters).toHaveLength(1);
    expect(r.characters[0]?.name).toBe('B');
  });

  it('alias 上限 5 个', () => {
    const json = {
      characters: [
        {
          name: 'A',
          prompt: 'p',
          alias: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'],
          tags: [],
        },
      ],
    };
    const r = extractAssets(json, 20);
    expect(r.characters[0]?.alias).toHaveLength(5);
  });

  it('alias 非字符串元素被过滤', () => {
    const json = {
      characters: [
        {
          name: 'A',
          prompt: 'p',
          alias: ['ok', 123, null, 'fine', undefined],
          tags: [],
        },
      ],
    };
    const r = extractAssets(json, 20);
    expect(r.characters[0]?.alias).toEqual(['ok', 'fine']);
  });

  it('完全无效 JSON 返回空结构', () => {
    expect(extractAssets(null, 20)).toEqual({ characters: [], scenes: [], props: [] });
    expect(extractAssets('not json', 20)).toEqual({ characters: [], scenes: [], props: [] });
    expect(extractAssets({}, 20)).toEqual({ characters: [], scenes: [], props: [] });
  });

  it('characters 字段不是数组时返回空', () => {
    const r = extractAssets({ characters: 'oops' }, 20);
    expect(r.characters).toEqual([]);
  });
});
