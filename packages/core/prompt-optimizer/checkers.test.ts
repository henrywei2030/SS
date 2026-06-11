/**
 * H2(docs/07):硬门 checkers 单测 — 五门各自命中/放行 + 违规全收集不短路。
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ABSTRACT_BLACKLIST,
  extractShotLineDurations,
  parseAbstractBlacklist,
  runHardGates,
} from './checkers.js';

const base = {
  original: '陆峰@图片1 在雨夜质问林凡@图片2',
  candidate: '陆峰@图片1 在雨夜质问林凡@图片2,指节抵桌发白',
  groupDurationS: 8,
  forbiddenWords: [] as string[],
  abstractBlacklist: [...DEFAULT_ABSTRACT_BLACKLIST],
};

describe('runHardGates', () => {
  it('干净文本 → 零违规', () => {
    expect(runHardGates(base)).toEqual([]);
  });

  it('TOKEN:丢 @token 即违规(复用 M6 守卫)', () => {
    const v = runHardGates({
      ...base,
      candidate: '陆峰@图片1 在雨夜质问林凡,指节抵着桌面发白,雨水顺着下颌线滴落',
    });
    expect(v.map((x) => x.gate)).toEqual(['TOKEN']);
    expect(v[0]?.message).toContain('@图片2');
  });

  it('LENGTH:过短/过长', () => {
    expect(runHardGates({ ...base, candidate: '@图片1@图片2' }).map((x) => x.gate)).toContain(
      'LENGTH',
    );
    const long = base.candidate + 'x'.repeat(6000);
    expect(runHardGates({ ...base, candidate: long }).map((x) => x.gate)).toContain('LENGTH');
  });

  it('DURATION:≥2 个 [i/N] 时长标记且偏差 >30% → 违规;无标记不管', () => {
    const bad = `[1/2] 全景 7s ${base.candidate}\n[2/2] 特写 7s 推近`;
    const v = runHardGates({ ...base, candidate: bad }); // 14s vs 8s = +75%
    expect(v.map((x) => x.gate)).toEqual(['DURATION']);

    const ok = `[1/2] 全景 3s ${base.candidate}\n[2/2] 特写 5s 推近`;
    expect(runHardGates({ ...base, candidate: ok })).toEqual([]);

    // 正文里的"3秒后"不是行首 [i/N] 标记格式,不触发
    expect(runHardGates({ ...base, candidate: `${base.candidate},3秒后转身` })).toEqual([]);
  });

  it('FORBIDDEN:正文含项目禁用词', () => {
    const v = runHardGates({
      ...base,
      forbiddenWords: ['模糊', ' '],
      candidate: `${base.candidate},画面模糊变形`,
    });
    expect(v.map((x) => x.gate)).toEqual(['FORBIDDEN']);
    expect(v[0]?.message).toContain('模糊');
  });

  it('ABSTRACT:偷懒短语命中;多违规全收集不短路', () => {
    const v = runHardGates({
      ...base,
      forbiddenWords: ['低质量'],
      candidate: '两人激烈打斗,低质量画面美轮美奂', // 丢 token + 禁用词 + 2 偷懒短语 + 过短? 长度够
    });
    const gates = v.map((x) => x.gate);
    expect(gates).toContain('TOKEN');
    expect(gates).toContain('FORBIDDEN');
    expect(gates.filter((g) => g === 'ABSTRACT')).toHaveLength(2);
  });
});

describe('extractShotLineDurations', () => {
  it('行内 [i/N] 头后的首个 Ns;小数支持;非标记行忽略', () => {
    expect(
      extractShotLineDurations('[1/3] 全景 俯视 3s 内容\n[2/3] 中景 2.5s 内容\n普通行 9s'),
    ).toEqual([3, 2.5]);
  });

  it('无 [i/N] 行 → 空', () => {
    expect(extractShotLineDurations('正文 5s 描述')).toEqual([]);
  });
});

describe('parseAbstractBlacklist', () => {
  it('空/缺省回默认;中文逗号可分;off 关门', () => {
    expect(parseAbstractBlacklist(undefined)).toEqual([...DEFAULT_ABSTRACT_BLACKLIST]);
    expect(parseAbstractBlacklist('a，b, c')).toEqual(['a', 'b', 'c']);
    expect(parseAbstractBlacklist('off')).toEqual([]);
  });
});
