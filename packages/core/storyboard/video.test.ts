/**
 * compileShotVideoPrompt 单测 — W5.0.2
 *
 * 覆盖:
 *   - happy path 全段拼接
 *   - 缺风格 / 缺角色 / 缺场景 / 缺道具 各自跳过
 *   - 多角色拼接顺序
 *   - description 优先于 prompt
 *   - cinematography 缺 framing 或 angle 部分降级
 *   - aspectRatio 默认 9:16
 *   - durationS clamp(0/负/超过 10s)
 *   - forbiddenWords + extraNegative 合并去重
 */
import { describe, expect, it } from 'vitest';

import { compileShotVideoPrompt } from './video.js';

describe('compileShotVideoPrompt', () => {
  it('happy path:9 段全段拼接,顺序固定', () => {
    const result = compileShotVideoPrompt({
      shot: {
        content: '陆乘走进咖啡馆,看到李婉',
        prompt: '镜头慢慢推进,跟随陆乘脚步',
        framing: '中景',
        angle: '过肩',
        durationS: 5,
      },
      characters: [
        { name: '陆乘', description: '男主,30岁,西装', prompt: '完整描述' },
        { name: '李婉', description: '女主,28岁,白裙', prompt: '完整描述' },
      ],
      scene: {
        name: '咖啡馆',
        description: '复古工业风,暖色灯光',
        prompt: '完整场景描述',
      },
      props: [
        { name: '咖啡杯', description: '白瓷', prompt: '' },
      ],
      style: {
        characterPrompt: '写实风格',
        scenePrompt: '电影感',
        forbiddenWords: ['模糊', '低质量'],
      },
      aspectRatio: '9:16',
      extraInstruction: '使用浅景深',
    });

    expect(result.positive).toContain('【风格】写实风格 · 电影感');
    expect(result.positive).toContain('【角色】陆乘:男主,30岁,西装;李婉:女主,28岁,白裙');
    expect(result.positive).toContain('【场景】咖啡馆:复古工业风,暖色灯光');
    expect(result.positive).toContain('【道具】咖啡杯:白瓷');
    expect(result.positive).toContain('【镜头内容】陆乘走进咖啡馆,看到李婉');
    expect(result.positive).toContain('【视频描述】镜头慢慢推进,跟随陆乘脚步');
    expect(result.positive).toContain('【镜头语言】中景 · 过肩');
    expect(result.positive).toContain('【参数】时长 5s · 宽高比 9:16');
    expect(result.negative).toBe('模糊、低质量');

    // 9 段完整顺序:风格 → 角色 → 场景 → 道具 → 镜头内容 → 视频描述 → 镜头语言 → 参数 → 额外指令
    const lines = result.positive.split('\n');
    expect(lines).toHaveLength(9);
    expect(lines[0]).toMatch(/^【风格】/);
    expect(lines[1]).toMatch(/^【角色】/);
    expect(lines[2]).toMatch(/^【场景】/);
    expect(lines[3]).toMatch(/^【道具】/);
    expect(lines[4]).toMatch(/^【镜头内容】/);
    expect(lines[5]).toMatch(/^【视频描述】/);
    expect(lines[6]).toMatch(/^【镜头语言】/);
    expect(lines[7]).toMatch(/^【参数】/);
    expect(lines[8]).toBe('使用浅景深');
  });

  it('无风格 → stylePart 为空,不留空行', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 5 },
    });
    expect(result.parts.stylePart).toBe('');
    expect(result.positive.startsWith('【风格】')).toBe(false);
    expect(result.positive).not.toMatch(/\n\n/);
  });

  it('风格只有 character 没有 scene → 拼一段', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 5 },
      style: { characterPrompt: '写实风格', scenePrompt: null },
    });
    expect(result.parts.stylePart).toBe('【风格】写实风格');
  });

  it('风格 forbiddenWords 没有但有 prompts → 不抛错', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 5 },
      style: { characterPrompt: '写实', scenePrompt: '电影感', forbiddenWords: null },
    });
    expect(result.negative).toBe('');
    expect(result.parts.stylePart).toBe('【风格】写实 · 电影感');
  });

  it('无角色 → charactersPart 为空', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 5 },
      characters: [],
    });
    expect(result.parts.charactersPart).toBe('');
    expect(result.positive).not.toContain('【角色】');
  });

  it('资产 description 缺失 → 降级用 prompt', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 5 },
      characters: [{ name: '陆乘', prompt: '完整描述,没有 description' }],
    });
    expect(result.parts.charactersPart).toBe('【角色】陆乘:完整描述,没有 description');
  });

  it('资产 description 和 prompt 都空 → 该资产被跳过', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 5 },
      characters: [
        { name: '陆乘', description: '男主', prompt: '主描述' },
        { name: '路人甲', description: '', prompt: '' }, // 空,跳过
      ],
    });
    expect(result.parts.charactersPart).toBe('【角色】陆乘:男主');
  });

  it('多个道具 → 拼接成单段', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 5 },
      props: [
        { name: '咖啡杯', description: '白瓷', prompt: '' },
        { name: '笔记本', description: '黑色皮面', prompt: '' },
      ],
    });
    expect(result.parts.propsPart).toBe('【道具】咖啡杯:白瓷;笔记本:黑色皮面');
  });

  it('cinematography 只有 framing 没有 angle', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', framing: '大特写', durationS: 5 },
    });
    expect(result.parts.cinematographyPart).toBe('【镜头语言】大特写');
  });

  it('cinematography 两个都缺 → 段为空', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 5 },
    });
    expect(result.parts.cinematographyPart).toBe('');
  });

  it('aspectRatio 不传 → 默认 9:16', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 5 },
    });
    expect(result.aspectRatio).toBe('9:16');
    expect(result.positive).toContain('宽高比 9:16');
  });

  it('aspectRatio 可覆盖为 16:9', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 5 },
      aspectRatio: '16:9',
    });
    expect(result.aspectRatio).toBe('16:9');
  });

  it('aspectRatio 纯空白 → fallback 到默认 9:16', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 5 },
      aspectRatio: '   ',
    });
    expect(result.aspectRatio).toBe('9:16');
    expect(result.positive).toContain('宽高比 9:16');
  });

  it('durationS=0 → clamp 到默认 5s', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 0 },
    });
    expect(result.durationS).toBe(5);
  });

  it('durationS=-3 → clamp 到 5', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: -3 },
    });
    expect(result.durationS).toBe(5);
  });

  it('durationS=15 → clamp 到 10(上限)', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 15 },
    });
    expect(result.durationS).toBe(10);
  });

  it('durationS=7.456 → 保留 1 位小数 7.5', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 7.456 },
    });
    expect(result.durationS).toBe(7.5);
  });

  it('forbiddenWords + extraNegative 合并去重', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 5 },
      style: { forbiddenWords: ['模糊', '低质量'] },
      extraNegative: ['模糊', '畸形'], // "模糊" 重复
    });
    expect(result.negative).toBe('模糊、低质量、畸形');
  });

  it('extraInstruction 拼到最尾', () => {
    const result = compileShotVideoPrompt({
      shot: { content: '内容', prompt: '描述', durationS: 5 },
      extraInstruction: '使用浅景深',
    });
    const lines = result.positive.split('\n');
    expect(lines[lines.length - 1]).toBe('使用浅景深');
  });
});
