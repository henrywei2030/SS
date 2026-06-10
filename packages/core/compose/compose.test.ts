/**
 * 成片核心纯逻辑测试 — M1 验收(时间线排序/取 take/缺口 + SRT 时间轴 + 工具函数)
 */
import { describe, expect, it } from 'vitest';

import { extractDialogueLines } from '../script/parse.js';
import {
  escapeSubtitlesPath,
  extractSceneDialogueTexts,
  targetDimensions,
} from './process-render.js';
import { buildSrtCues, formatSrt, formatSrtTime, sliceLinesByDuration } from './srt.js';
import { assembleTimeline, pickLatestTake } from './timeline.js';

describe('pickLatestTake', () => {
  it('取列表(已按 createdAt desc)里第一个有 outputMediaId 的', () => {
    const take = pickLatestTake([
      { id: 'a3', outputMediaId: null, createdAt: new Date('2026-06-03') },
      { id: 'a2', outputMediaId: 'm2', createdAt: new Date('2026-06-02') },
      { id: 'a1', outputMediaId: 'm1', createdAt: new Date('2026-06-01') },
    ]);
    expect(take).toMatchObject({ attemptId: 'a2', mediaId: 'm2' });
  });

  it('全无可用 → null', () => {
    expect(pickLatestTake([])).toBeNull();
    expect(
      pickLatestTake([{ id: 'a', outputMediaId: null, createdAt: new Date() }]),
    ).toBeNull();
  });
});

describe('assembleTimeline', () => {
  const shots = [
    { groupId: 'g2', positionIdx: 5, content: 'B段第一镜' },
    { groupId: 'g1', positionIdx: 1, content: 'A段第一镜' },
    { groupId: 'g1', positionIdx: 2, content: 'A段第二镜' },
    { groupId: null, positionIdx: 9, content: '未入组' },
  ];

  it('按组内首镜 positionIdx 排序;镜头内容按 positionIdx 升序;空组排除', () => {
    const tl = assembleTimeline(
      [
        { id: 'g2', number: '9-18' },
        { id: 'g1', number: '1-8' },
        { id: 'gEmpty', number: '空组' },
      ],
      shots,
      new Map([['g1', [{ id: 'a1', outputMediaId: 'm1', createdAt: new Date() }]]]),
    );
    expect(tl.entries.map((e) => e.number)).toEqual(['1-8', '9-18']);
    expect(tl.entries[0]!.shotContents).toEqual(['A段第一镜', 'A段第二镜']);
  });

  it('缺 take 的组列入 gaps,有 take 的进 ready', () => {
    const tl = assembleTimeline(
      [
        { id: 'g1', number: '1-8' },
        { id: 'g2', number: '9-18' },
      ],
      shots,
      new Map([['g1', [{ id: 'a1', outputMediaId: 'm1', createdAt: new Date() }]]]),
    );
    expect(tl.ready.map((e) => e.number)).toEqual(['1-8']);
    expect(tl.gaps).toEqual([{ groupId: 'g2', number: '9-18' }]);
  });
});

describe('extractDialogueLines(剧本同款正则)', () => {
  it('提取对白+旁白,丢动作/注释', () => {
    const lines = extractDialogueLines(
      [
        '△陆乘被一阵咳嗽声惊醒。',
        '陆萌萌（害怕）：哥，我……',
        '陆乘（OS）：我重生了！',
        '陆乘：还活着',
        '【注:闪回画面】',
      ].join('\n'),
    );
    expect(lines.map((l) => l.text)).toEqual(['哥，我……', '我重生了！', '还活着']);
    expect(lines[1]!.kind).toBe('voiceover');
  });
});

describe('SRT 时间轴', () => {
  it('段时长累加 + 段内均分;无台词段空窗但占位时长', () => {
    const cues = buildSrtCues([
      { durationS: 10, lines: ['第一句', '第二句'] },
      { durationS: 5, lines: [] }, // 空窗段
      { durationS: 6, lines: ['第三句'] },
    ]);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toMatchObject({ startS: 0, endS: 5, text: '第一句' });
    expect(cues[1]).toMatchObject({ startS: 5, endS: 10, text: '第二句' });
    // 第三句从 10(第一段)+5(空窗段) = 15s 起
    expect(cues[2]).toMatchObject({ startS: 15, endS: 21, text: '第三句' });
  });

  it('formatSrtTime:HH:MM:SS,mmm', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000');
    expect(formatSrtTime(75.5)).toBe('00:01:15,500');
    expect(formatSrtTime(3661.025)).toBe('01:01:01,025');
  });

  it('formatSrt 完整块格式', () => {
    const srt = formatSrt([{ startS: 0, endS: 2.5, text: '你好' }]);
    expect(srt).toBe('1\n00:00:00,000 --> 00:00:02,500\n你好\n');
  });
});

describe('extractSceneDialogueTexts(场原文 → 台词,滤场头元数据)', () => {
  it('「人物：」等场头元数据行不当台词;真台词保留', () => {
    const texts = extractSceneDialogueTexts(
      [
        '9-1 日 内 拍卖行',
        '人物：陆峰、赵万里（仇人之子）、拍卖官',
        '△拍卖槌起落。',
        '拍卖官：浦东001号地块，起拍价十亿！',
        '赵万里（讥讽）：陆峰，这地块要现款结算的。',
      ].join('\n'),
    );
    expect(texts).toEqual(['浦东001号地块，起拍价十亿！', '陆峰，这地块要现款结算的。']);
  });
});

describe('sliceLinesByDuration(场台词按组时长比例切分)', () => {
  it('按时长比例连续切分,累计取整不丢行不重行', () => {
    const lines = ['1', '2', '3', '4', '5', '6'];
    const slices = sliceLinesByDuration(lines, [2, 2, 2]); // 均分 → 2/2/2
    expect(slices).toEqual([
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]);
    const skewed = sliceLinesByDuration(lines, [9, 1]); // 9:1 → 5/1
    expect(skewed.flat()).toEqual(lines); // 全量覆盖
    expect(skewed[0]!.length).toBeGreaterThan(skewed[1]!.length);
  });

  it('无台词 → 各组空数组;无组 → 空', () => {
    expect(sliceLinesByDuration([], [2, 3])).toEqual([[], []]);
    expect(sliceLinesByDuration(['a'], [])).toEqual([]);
  });

  it('行数少于组数时不凭空造行', () => {
    const slices = sliceLinesByDuration(['唯一一句'], [2, 2, 2]);
    expect(slices.flat()).toEqual(['唯一一句']);
    expect(slices).toHaveLength(3);
  });
});

describe('工具函数', () => {
  it('targetDimensions:各比例 → 1080p 档偶数尺寸', () => {
    expect(targetDimensions('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(targetDimensions('16:9')).toEqual({ width: 1920, height: 1080 });
    expect(targetDimensions('1:1')).toEqual({ width: 1080, height: 1080 });
    expect(targetDimensions('未知')).toEqual({ width: 1920, height: 1080 }); // 默认
  });

  it('escapeSubtitlesPath:Windows 盘符/反斜杠/单引号转义', () => {
    expect(escapeSubtitlesPath('C:\\tmp\\a b\\sub.srt')).toBe('C\\:/tmp/a b/sub.srt');
    expect(escapeSubtitlesPath("/tmp/it's.srt")).toBe("/tmp/it\\'s.srt");
  });
});
