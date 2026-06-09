import { describe, expect, it } from 'vitest';

import { parseEpisodeBoundaries, parseScriptText } from './parse.js';

describe('parseScriptText', () => {
  it('解析单场 + 标题 + 人物列表 + 动作 + 对白 + 旁白', () => {
    const text = `1-1 日 内 陆乘家破土屋
《重生1983我用灵泉搞创业》
人物：陆乘、陆萌萌、王大富、小弟（两人）
△陆乘被一阵轻微的咳嗽声惊醒，猛然睁开眼。
△墙角处，一个少女正盖着破被子躺在地上。
陆萌萌（害怕）：对不起，哥，我，我不是故意的。
陆乘（瞳孔地震 OS）：我重生了！回到了萌萌出事那天！
陆乘：萌萌！`;

    const result = parseScriptText(text);

    expect(result.title).toBe('重生1983我用灵泉搞创业');
    expect(result.scenes).toHaveLength(1);

    const scene = result.scenes[0]!;
    expect(scene.number).toBe('1-1');
    expect(scene.episodeNumber).toBe(1);
    expect(scene.sceneNumber).toBe(1);
    expect(scene.timeOfDay).toBe('DAY');
    expect(scene.location).toBe('INDOOR');
    expect(scene.place).toBe('陆乘家破土屋');
    expect(scene.characters).toEqual(['陆乘', '陆萌萌', '王大富', '小弟']);

    expect(scene.lines).toHaveLength(5);
    expect(scene.lines[0]).toMatchObject({
      kind: 'action',
      text: '陆乘被一阵轻微的咳嗽声惊醒，猛然睁开眼。',
    });
    expect(scene.lines[2]).toMatchObject({
      kind: 'dialog',
      speaker: '陆萌萌',
      emotion: '害怕',
      text: '对不起，哥，我，我不是故意的。',
    });
    expect(scene.lines[3]).toMatchObject({
      kind: 'voiceover',
      speaker: '陆乘',
      emotion: '瞳孔地震 OS',
    });
    expect(scene.lines[4]).toMatchObject({
      kind: 'dialog',
      speaker: '陆乘',
      text: '萌萌！',
    });
  });

  it('解析多场，每场独立累积 rawContent', () => {
    const text = `1-1 日 内 房间
△角色 A 进入。
A：你好。

1-2 夜 外 街道
△角色 B 走过。
B：晚上好。`;

    const result = parseScriptText(text);
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0]!.number).toBe('1-1');
    expect(result.scenes[1]!.number).toBe('1-2');
    expect(result.scenes[1]!.timeOfDay).toBe('NIGHT');
    expect(result.scenes[1]!.location).toBe('OUTDOOR');
    expect(result.scenes[0]!.rawContent).toContain('角色 A 进入');
    expect(result.scenes[1]!.rawContent).toContain('角色 B 走过');
  });

  it('支持时段：晨/日/昏/夜', () => {
    const cases: Array<[string, 'DAWN' | 'DAY' | 'DUSK' | 'NIGHT']> = [
      ['1-1 晨 内 X', 'DAWN'],
      ['1-2 早 内 X', 'DAWN'],
      ['1-3 日 内 X', 'DAY'],
      ['1-4 昏 内 X', 'DUSK'],
      ['1-5 晚 内 X', 'DUSK'],
      ['1-6 夜 内 X', 'NIGHT'],
    ];
    for (const [head, expected] of cases) {
      const r = parseScriptText(`${head}\n△test`);
      expect(r.scenes[0]?.timeOfDay).toBe(expected);
    }
  });

  it('支持内外 / 混合', () => {
    const a = parseScriptText('1-1 日 内 X\n△t');
    expect(a.scenes[0]?.location).toBe('INDOOR');

    const b = parseScriptText('1-2 日 外 X\n△t');
    expect(b.scenes[0]?.location).toBe('OUTDOOR');

    const c = parseScriptText('1-3 日 内外 X\n△t');
    expect(c.scenes[0]?.location).toBe('MIXED');
  });

  it('全角 / 半角 标点都接受', () => {
    const fullwidth = `1-1 日 内 房间
人物：A、B
A（紧张）：你好。`;
    const halfwidth = `1-1 日 内 房间
人物:A、B
A(紧张):你好。`;

    const fw = parseScriptText(fullwidth);
    const hw = parseScriptText(halfwidth);

    expect(fw.scenes[0]?.characters).toEqual(['A', 'B']);
    expect(hw.scenes[0]?.characters).toEqual(['A', 'B']);
    expect(fw.scenes[0]?.lines[0]?.kind).toBe('dialog');
    expect(hw.scenes[0]?.lines[0]?.kind).toBe('dialog');
  });

  it('OS / 旁白 / 画外音 / VO 都识别为 voiceover', () => {
    const text = `1-1 日 内 X
A（OS）：1
A（旁白）：2
A（画外音）：3
A（vo）：4`;
    const r = parseScriptText(text);
    const kinds = r.scenes[0]?.lines.map((l) => l.kind);
    expect(kinds).toEqual(['voiceover', 'voiceover', 'voiceover', 'voiceover']);
  });

  it('场头之前的内容入 preamble，不丢失', () => {
    const text = `《超牛剧本》
作者：某某
2026 春

1-1 日 内 X
△t`;
    const r = parseScriptText(text);
    expect(r.title).toBe('超牛剧本');
    expect(r.preamble).toEqual(['作者：某某', '2026 春']);
    expect(r.scenes).toHaveLength(1);
  });

  it('未识别的行降级为 note，不丢失原文', () => {
    const text = `1-1 日 内 X
某种奇怪格式的行
另一种奇怪格式`;
    const r = parseScriptText(text);
    const notes = r.scenes[0]?.lines.filter((l) => l.kind === 'note') ?? [];
    expect(notes).toHaveLength(2);
    expect(notes[0]?.text).toBe('某种奇怪格式的行');
  });

  it('空文本返回空结构', () => {
    const r = parseScriptText('');
    expect(r.scenes).toHaveLength(0);
    expect(r.preamble).toEqual([]);
  });

  it('"挂历：1983年4月12日"等含冒号的注释行不被误识为对白', () => {
    const text = `1-1 日 内 房间
△挂历：1983年4月12日。(特写)
陆乘：我重生了！`;
    const r = parseScriptText(text);
    const lines = r.scenes[0]?.lines ?? [];
    expect(lines).toHaveLength(2);
    expect(lines[0]?.kind).toBe('action');
    expect(lines[1]).toMatchObject({ kind: 'dialog', speaker: '陆乘' });
  });

  it('日期或含数字的长前缀不会被误识为 speaker', () => {
    const text = `1-1 日 内 房间
2026年5月22日：今天发生了一件事
陆乘：你好`;
    const r = parseScriptText(text);
    const lines = r.scenes[0]?.lines ?? [];
    // "2026年5月22日" 超过 12 字限制 → 不识别为 speaker，降级为 note
    expect(lines[0]?.kind).toBe('note');
    expect(lines[1]).toMatchObject({ kind: 'dialog', speaker: '陆乘' });
  });

  it('场头 "内外" 识别为 MIXED', () => {
    const r = parseScriptText('1-1 日 内外 走廊→院子\n△转场');
    expect(r.scenes[0]?.location).toBe('MIXED');
  });
});

// 12 维深审 D10 补强:多集切分此前零覆盖(剧本上传「集数识别」的核心,六五修复区)
describe('parseEpisodeBoundaries', () => {
  it('无集标 → 单集 fallback(episodeNumber=1,content=全文)', () => {
    const text = '1-1 日 内 房间\n△陆乘醒来。\n陆乘:这是哪?';
    const r = parseEpisodeBoundaries(text);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ episodeNumber: 1, title: '' });
    expect(r[0]!.content).toBe(text);
    expect(r[0]!.sceneCount).toBe(1);
  });

  it('「第N集」多集切分:边界正确 + 各集内容含集标行 + 标题捕获', () => {
    const text = [
      '第1集:重生',
      '1-1 日 内 房间',
      '△第一集内容。',
      '第2集 复仇',
      '2-1 夜 外 街道',
      '△第二集内容。',
    ].join('\n');
    const r = parseEpisodeBoundaries(text);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ episodeNumber: 1, title: '重生' });
    expect(r[0]!.content).toContain('第一集内容');
    expect(r[0]!.content).not.toContain('第二集内容');
    expect(r[1]).toMatchObject({ episodeNumber: 2, title: '复仇' });
    expect(r[1]!.content).toContain('2-1 夜 外 街道');
  });

  it('混合写法:第N集 / Episode N / EP N 都识别(大小写不敏感)', () => {
    const text = ['第 1 集', 'A', 'Episode 2', 'B', 'ep3', 'C'].join('\n');
    const r = parseEpisodeBoundaries(text);
    expect(r.map((e) => e.episodeNumber)).toEqual([1, 2, 3]);
    expect(r[1]!.content).toContain('B');
    expect(r[2]!.content).toContain('C');
  });

  it('首个集标前的封面/前言被丢弃(设计行为)', () => {
    const text = ['《剧名》封面页', '作者:某某', '第1集', '正文'].join('\n');
    const r = parseEpisodeBoundaries(text);
    expect(r).toHaveLength(1);
    expect(r[0]!.content).not.toContain('封面页');
    expect(r[0]!.content).toContain('正文');
  });

  it('「第0集」非法集号不当集标(行首命中正则但 n>0 校验拒),归入上文内容', () => {
    const text = ['第1集', '第0集 这种写法', '继续'].join('\n');
    const r = parseEpisodeBoundaries(text);
    expect(r).toHaveLength(1);
    expect(r[0]!.content).toContain('第0集 这种写法');
  });

  it('集号乱序/重复按出现顺序保留(上游负责去重)', () => {
    const text = ['第3集', 'C', '第1集', 'A'].join('\n');
    const r = parseEpisodeBoundaries(text);
    expect(r.map((e) => e.episodeNumber)).toEqual([3, 1]);
  });
});
