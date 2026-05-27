/**
 * W5.1 视频 prompt 编译器单测
 *
 * 覆盖三类公开 API:
 *   1. helper:tokenFor / isAudioUsage / kindFromUsage
 *   2. autoTagPromptWithReferences — 自动 @ 按钮的逻辑
 *   3. compileShotGroupVideoPrompt — 最终编译送 Seedance
 *
 * 设计原则:
 *   - 不依赖 LLM / DB,纯函数测试
 *   - 测试覆盖空输入 / 边界 / 警告路径 / 排序稳定
 */
import { describe, expect, it } from 'vitest';

import {
  autoTagPromptWithReferences,
  compileShotGroupVideoPrompt,
  isAudioUsage,
  kindFromUsage,
  tokenFor,
} from './video.js';

// ===========================================================================
// helpers
// ===========================================================================

describe('tokenFor', () => {
  it('IMAGE 类返回 @图片N', () => {
    expect(tokenFor('IMAGE', 1)).toBe('@图片1');
    expect(tokenFor('IMAGE', 42)).toBe('@图片42');
  });

  it('AUDIO 类返回 @音频N', () => {
    expect(tokenFor('AUDIO', 1)).toBe('@音频1');
    expect(tokenFor('AUDIO', 99)).toBe('@音频99');
  });
});

describe('isAudioUsage', () => {
  it('SOUND_BG / SOUND_VOICE / THEME 为音频', () => {
    expect(isAudioUsage('SOUND_BG')).toBe(true);
    expect(isAudioUsage('SOUND_VOICE')).toBe(true);
    expect(isAudioUsage('THEME')).toBe(true);
  });

  it('其他 usageType 不是音频', () => {
    expect(isAudioUsage('APPEAR')).toBe(false);
    expect(isAudioUsage('SPEAK')).toBe(false);
    expect(isAudioUsage('HOLD')).toBe(false);
    expect(isAudioUsage('ENVIRONMENT')).toBe(false);
    expect(isAudioUsage('REFERENCE')).toBe(false);
    expect(isAudioUsage('')).toBe(false);
  });
});

describe('kindFromUsage', () => {
  it('音频 usageType 返回 AUDIO,其他返回 IMAGE', () => {
    expect(kindFromUsage('SOUND_VOICE')).toBe('AUDIO');
    expect(kindFromUsage('APPEAR')).toBe('IMAGE');
    expect(kindFromUsage('ENVIRONMENT')).toBe('IMAGE');
  });
});

// ===========================================================================
// autoTagPromptWithReferences
// ===========================================================================

describe('autoTagPromptWithReferences', () => {
  it('空 text → 返回空', () => {
    expect(autoTagPromptWithReferences('', [])).toBe('');
    expect(
      autoTagPromptWithReferences('', [
        { refSlotIdx: 1, kind: 'IMAGE', name: '陆乘' },
      ]),
    ).toBe('');
  });

  it('空 bindings → 原文不变', () => {
    expect(autoTagPromptWithReferences('陆乘走进咖啡馆', [])).toBe(
      '陆乘走进咖啡馆',
    );
  });

  it('单 binding 找到 name → 紧跟其后插入 @图片N', () => {
    const result = autoTagPromptWithReferences('陆乘走进咖啡馆', [
      { refSlotIdx: 2, kind: 'IMAGE', name: '陆乘' },
    ]);
    expect(result).toBe('陆乘@图片2走进咖啡馆');
  });

  it('AUDIO binding → @音频N', () => {
    const result = autoTagPromptWithReferences('背景响起轻柔音乐', [
      { refSlotIdx: 1, kind: 'AUDIO', name: '轻柔音乐' },
    ]);
    expect(result).toBe('背景响起轻柔音乐@音频1');
  });

  it('name 在 text 中出现多次 → 全部标(W5 audit T1)', () => {
    // 产品截图证实:同一段提示词里 "陆萌萌@图片2" 重复多次(中景/特写/俯拍 都有)
    const result = autoTagPromptWithReferences(
      '陆乘走进咖啡馆,陆乘看到李婉,陆乘笑了',
      [{ refSlotIdx: 2, kind: 'IMAGE', name: '陆乘' }],
    );
    expect(result).toBe('陆乘@图片2走进咖啡馆,陆乘@图片2看到李婉,陆乘@图片2笑了');
  });

  it('已有正确 token 紧跟 name 后 → 不重复插入', () => {
    const result = autoTagPromptWithReferences('陆乘@图片2走进咖啡馆', [
      { refSlotIdx: 2, kind: 'IMAGE', name: '陆乘' },
    ]);
    expect(result).toBe('陆乘@图片2走进咖啡馆');
  });

  it('已有错 token 跟在 name 后 → 也不再插(留给 compile 报 warning)', () => {
    // 已有 @图片5,但实际 binding 是 refSlotIdx=2,函数仍然不动 text(避免覆盖用户手编)
    const result = autoTagPromptWithReferences('陆乘@图片5走进咖啡馆', [
      { refSlotIdx: 2, kind: 'IMAGE', name: '陆乘' },
    ]);
    expect(result).toBe('陆乘@图片5走进咖啡馆');
  });

  it('多 binding 各自标 → 互不冲突', () => {
    const result = autoTagPromptWithReferences('陆乘走进咖啡馆看到李婉', [
      { refSlotIdx: 2, kind: 'IMAGE', name: '陆乘' },
      { refSlotIdx: 3, kind: 'IMAGE', name: '李婉' },
    ]);
    expect(result).toBe('陆乘@图片2走进咖啡馆看到李婉@图片3');
  });

  it('alias 匹配(name 没找到时回退)', () => {
    const result = autoTagPromptWithReferences('萌萌坐在床边', [
      { refSlotIdx: 4, kind: 'IMAGE', name: '陆萌萌', aliases: ['萌萌', '小陆'] },
    ]);
    expect(result).toBe('萌萌@图片4坐在床边');
  });

  it('找不到任何 name / alias → text 不变', () => {
    const result = autoTagPromptWithReferences('一个陌生人走过', [
      { refSlotIdx: 2, kind: 'IMAGE', name: '陆乘', aliases: ['阿乘'] },
    ]);
    expect(result).toBe('一个陌生人走过');
  });

  it('混合图片和音频 → 各取所需', () => {
    const result = autoTagPromptWithReferences(
      '陆乘走进咖啡馆,背景音乐响起',
      [
        { refSlotIdx: 2, kind: 'IMAGE', name: '陆乘' },
        { refSlotIdx: 1, kind: 'AUDIO', name: '背景音乐' },
      ],
    );
    expect(result).toBe('陆乘@图片2走进咖啡馆,背景音乐@音频1响起');
  });

  it('同 name 两个 binding(变体)→ 第一个 binding 标全部,第二个 binding 跳过(W5 audit T1)', () => {
    // 同名变体场景:只能用 alias 区分,否则两个 binding 都用 name 时,
    // 第一个 binding 已经把所有 "陆乘" 都标了,第二个 binding 来时全部已 tagged 跳过
    const result = autoTagPromptWithReferences('陆乘问陆乘:你是谁?', [
      { refSlotIdx: 2, kind: 'IMAGE', name: '陆乘' },
      { refSlotIdx: 3, kind: 'IMAGE', name: '陆乘' },
    ]);
    expect(result).toBe('陆乘@图片2问陆乘@图片2:你是谁?');
  });

  it('两个 binding 用不同 alias 区分变体 → 各自标各自的出现', () => {
    const result = autoTagPromptWithReferences('阿乘问乘哥:你是谁?', [
      { refSlotIdx: 2, kind: 'IMAGE', name: '陆乘', aliases: ['阿乘'] },
      { refSlotIdx: 3, kind: 'IMAGE', name: '陆乘-成年', aliases: ['乘哥'] },
    ]);
    expect(result).toBe('阿乘@图片2问乘哥@图片3:你是谁?');
  });

  it('已有正确 token 跟在某次出现后 → 该次跳过,其他次仍补标', () => {
    // text 里第二次 "陆乘" 后已经有 @图片2(用户手编),其他两次未标
    const result = autoTagPromptWithReferences(
      '陆乘走进咖啡馆,陆乘@图片2看到李婉,陆乘笑了',
      [{ refSlotIdx: 2, kind: 'IMAGE', name: '陆乘' }],
    );
    expect(result).toBe('陆乘@图片2走进咖啡馆,陆乘@图片2看到李婉,陆乘@图片2笑了');
  });
});

// ===========================================================================
// compileShotGroupVideoPrompt
// ===========================================================================

describe('compileShotGroupVideoPrompt — happy path', () => {
  it('完整 4 段 + references 全部被引用', () => {
    const result = compileShotGroupVideoPrompt({
      text: '陆乘@图片2 走进咖啡馆@图片1,看到李婉@图片3。背景音乐@音频1 响起。',
      durationS: 5,
      references: [
        {
          refSlotIdx: 1,
          kind: 'IMAGE',
          assetId: 'a_scene',
          name: '咖啡馆',
          mediaUrl: 'https://cdn/scene.png',
        },
        {
          refSlotIdx: 2,
          kind: 'IMAGE',
          assetId: 'a_lucheng',
          name: '陆乘',
          mediaUrl: 'https://cdn/lucheng.png',
        },
        {
          refSlotIdx: 3,
          kind: 'IMAGE',
          assetId: 'a_liwan',
          name: '李婉',
          mediaUrl: 'https://cdn/liwan.png',
        },
        {
          refSlotIdx: 1,
          kind: 'AUDIO',
          assetId: 'a_bgm',
          name: '背景音乐',
          mediaUrl: 'https://cdn/bgm.mp3',
        },
      ],
      style: {
        characterPrompt: '写实风格',
        scenePrompt: '电影感',
        propPrompt: '复古道具',
        forbiddenWords: ['模糊', '低质量'],
      },
      aspectRatio: '9:16',
    });

    // 风格 3 段全拼
    expect(result.positive).toContain('【风格】写实风格 · 电影感 · 复古道具');
    // text 原样
    expect(result.positive).toContain('陆乘@图片2 走进咖啡馆@图片1');
    // 参数
    expect(result.positive).toContain('【参数】时长 5s · 宽高比 9:16');
    // negative 去重合并
    expect(result.negative).toBe('模糊、低质量');
    // 4 个 references 全被用
    expect(result.references).toHaveLength(4);
    expect(result.warnings.unusedReferences).toEqual([]);
    expect(result.warnings.unknownTokens).toEqual([]);
  });

  it('references 排序:IMAGE 先于 AUDIO,各自按 refSlotIdx 升序', () => {
    const result = compileShotGroupVideoPrompt({
      text: '@图片3 @图片1 @音频2 @音频1 @图片2',
      durationS: 5,
      references: [
        { refSlotIdx: 3, kind: 'IMAGE', assetId: 'c', name: 'C', mediaUrl: 'c' },
        { refSlotIdx: 1, kind: 'AUDIO', assetId: 'd', name: 'D', mediaUrl: 'd' },
        { refSlotIdx: 1, kind: 'IMAGE', assetId: 'a', name: 'A', mediaUrl: 'a' },
        { refSlotIdx: 2, kind: 'AUDIO', assetId: 'e', name: 'E', mediaUrl: 'e' },
        { refSlotIdx: 2, kind: 'IMAGE', assetId: 'b', name: 'B', mediaUrl: 'b' },
      ],
    });

    expect(result.references.map((r) => r.token)).toEqual([
      '@图片1',
      '@图片2',
      '@图片3',
      '@音频1',
      '@音频2',
    ]);
  });
});

describe('compileShotGroupVideoPrompt — warnings', () => {
  it('references 有但 text 不引用 → unusedReferences', () => {
    const result = compileShotGroupVideoPrompt({
      text: '只有 @图片1 在文里',
      durationS: 5,
      references: [
        { refSlotIdx: 1, kind: 'IMAGE', assetId: 'a', name: 'A', mediaUrl: 'a' },
        { refSlotIdx: 2, kind: 'IMAGE', assetId: 'b', name: 'B', mediaUrl: 'b' },
        { refSlotIdx: 3, kind: 'IMAGE', assetId: 'c', name: 'C', mediaUrl: 'c' },
      ],
    });

    expect(result.references.map((r) => r.refSlotIdx)).toEqual([1]);
    expect(result.warnings.unusedReferences.sort()).toEqual([2, 3]);
    expect(result.warnings.unknownTokens).toEqual([]);
  });

  it('text 引用了但 references 没提供 → unknownTokens', () => {
    const result = compileShotGroupVideoPrompt({
      text: '@图片1 @图片2 @音频1',
      durationS: 5,
      references: [
        { refSlotIdx: 1, kind: 'IMAGE', assetId: 'a', name: 'A', mediaUrl: 'a' },
      ],
    });

    expect(result.references).toHaveLength(1);
    expect(result.warnings.unusedReferences).toEqual([]);
    expect(result.warnings.unknownTokens.sort()).toEqual(['@图片2', '@音频1']);
  });

  it('text 多次引用同 token → 只算一次 unknown', () => {
    const result = compileShotGroupVideoPrompt({
      text: '@图片5 又 @图片5 还是 @图片5',
      durationS: 5,
      references: [],
    });

    expect(result.warnings.unknownTokens).toEqual(['@图片5']);
  });

  it('reference 缺图(mediaUrl=null)被 text 引用 → 进 missingMedia,不进 outputRefs(W5 audit W1)', () => {
    const result = compileShotGroupVideoPrompt({
      text: '陆乘@图片2 走进咖啡馆@图片1',
      durationS: 5,
      references: [
        { refSlotIdx: 1, kind: 'IMAGE', assetId: 's', name: '咖啡馆', mediaUrl: 'https://cdn/s.png' },
        { refSlotIdx: 2, kind: 'IMAGE', assetId: 'l', name: '陆乘', mediaUrl: null },
      ],
    });
    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.refSlotIdx).toBe(1);
    expect(result.warnings.missingMedia).toEqual([
      { refSlotIdx: 2, kind: 'IMAGE', assetName: '陆乘' },
    ]);
    expect(result.warnings.unknownTokens).toEqual([]);
  });

  it('reference 缺图 AND text 没用 → missingMedia + unusedReferences 都报', () => {
    const result = compileShotGroupVideoPrompt({
      text: '只有 @图片1',
      durationS: 5,
      references: [
        { refSlotIdx: 1, kind: 'IMAGE', assetId: 'a', name: 'A', mediaUrl: 'a' },
        { refSlotIdx: 2, kind: 'IMAGE', assetId: 'b', name: 'B', mediaUrl: null },
      ],
    });
    expect(result.warnings.missingMedia.map((m) => m.refSlotIdx)).toEqual([2]);
    expect(result.warnings.unusedReferences).toEqual([2]);
  });
});

describe('compileShotGroupVideoPrompt — 风格', () => {
  it('无风格 → stylePart 空,positive 不留空行', () => {
    const result = compileShotGroupVideoPrompt({
      text: '陆乘走进咖啡馆',
      durationS: 5,
      references: [],
    });
    expect(result.parts.stylePart).toBe('');
    expect(result.positive.startsWith('【风格】')).toBe(false);
    expect(result.positive).not.toMatch(/\n\n/);
  });

  it('风格只有 character → 一段', () => {
    const result = compileShotGroupVideoPrompt({
      text: '内容',
      durationS: 5,
      references: [],
      style: { characterPrompt: '写实', scenePrompt: null, propPrompt: null },
    });
    expect(result.parts.stylePart).toBe('【风格】写实');
  });

  it('风格 propPrompt 单独存在 → 一段(W4 audit P1 修)', () => {
    const result = compileShotGroupVideoPrompt({
      text: '内容',
      durationS: 5,
      references: [],
      style: {
        characterPrompt: null,
        scenePrompt: null,
        propPrompt: '复古道具',
      },
    });
    expect(result.parts.stylePart).toBe('【风格】复古道具');
  });

  it('风格三段都有 → 用 · 分隔', () => {
    const result = compileShotGroupVideoPrompt({
      text: '内容',
      durationS: 5,
      references: [],
      style: {
        characterPrompt: '写实',
        scenePrompt: '电影感',
        propPrompt: '复古',
      },
    });
    expect(result.parts.stylePart).toBe('【风格】写实 · 电影感 · 复古');
  });
});

describe('compileShotGroupVideoPrompt — negative', () => {
  it('forbiddenWords + extraNegative 合并去重', () => {
    const result = compileShotGroupVideoPrompt({
      text: '内容',
      durationS: 5,
      references: [],
      style: { forbiddenWords: ['模糊', '低质量'] },
      extraNegative: ['模糊', '畸形'],
    });
    expect(result.negative).toBe('模糊、低质量、畸形');
  });

  it('全空 → negative 空串', () => {
    const result = compileShotGroupVideoPrompt({
      text: '内容',
      durationS: 5,
      references: [],
    });
    expect(result.negative).toBe('');
  });
});

describe('compileShotGroupVideoPrompt — 时长/比例', () => {
  it('aspectRatio 不传 → 默认 9:16', () => {
    const result = compileShotGroupVideoPrompt({
      text: '内容',
      durationS: 5,
      references: [],
    });
    expect(result.aspectRatio).toBe('9:16');
    expect(result.positive).toContain('宽高比 9:16');
  });

  it('aspectRatio 可覆盖为 16:9', () => {
    const result = compileShotGroupVideoPrompt({
      text: '内容',
      durationS: 5,
      references: [],
      aspectRatio: '16:9',
    });
    expect(result.aspectRatio).toBe('16:9');
  });

  it('aspectRatio 纯空白 → fallback 9:16', () => {
    const result = compileShotGroupVideoPrompt({
      text: '内容',
      durationS: 5,
      references: [],
      aspectRatio: '   ',
    });
    expect(result.aspectRatio).toBe('9:16');
  });

  it('durationS=0 → clamp 默认 5', () => {
    const result = compileShotGroupVideoPrompt({
      text: '内容',
      durationS: 0,
      references: [],
    });
    expect(result.durationS).toBe(5);
  });

  it('durationS=-3 → clamp 5', () => {
    const result = compileShotGroupVideoPrompt({
      text: '内容',
      durationS: -3,
      references: [],
    });
    expect(result.durationS).toBe(5);
  });

  it('durationS=20 → clamp 上限 15(2026-05-27 业务调到 15s)', () => {
    const result = compileShotGroupVideoPrompt({
      text: '内容',
      durationS: 20,
      references: [],
    });
    expect(result.durationS).toBe(15);
  });

  it('durationS=7.456 → 保留 1 位小数 7.5', () => {
    const result = compileShotGroupVideoPrompt({
      text: '内容',
      durationS: 7.456,
      references: [],
    });
    expect(result.durationS).toBe(7.5);
  });
});

describe('compileShotGroupVideoPrompt — 段顺序 + extraInstruction', () => {
  it('positive 段顺序固定:风格 → 正文 → 参数 → 额外', () => {
    const result = compileShotGroupVideoPrompt({
      text: '正文',
      durationS: 5,
      references: [],
      style: { characterPrompt: '写实' },
      extraInstruction: '使用浅景深',
    });
    const lines = result.positive.split('\n');
    expect(lines[0]).toMatch(/^【风格】/);
    expect(lines[1]).toBe('正文');
    expect(lines[2]).toMatch(/^【参数】/);
    expect(lines[3]).toBe('使用浅景深');
  });

  it('extraInstruction 不传 → 末尾不留空', () => {
    const result = compileShotGroupVideoPrompt({
      text: '正文',
      durationS: 5,
      references: [],
    });
    expect(result.positive.endsWith('使用浅景深')).toBe(false);
    expect(result.positive).not.toMatch(/\n$/);
  });
});

describe('compileShotGroupVideoPrompt — token 解析', () => {
  it('text 含 token 但同 idx 在两种 kind 都出现 → 各算各的', () => {
    // text 有 @图片1 也有 @音频1,references 只提供 IMAGE 那个 → AUDIO 进 unknown
    const result = compileShotGroupVideoPrompt({
      text: '陆乘@图片1 说话,背景@音频1 响',
      durationS: 5,
      references: [
        {
          refSlotIdx: 1,
          kind: 'IMAGE',
          assetId: 'a',
          name: 'A',
          mediaUrl: 'a',
        },
      ],
    });
    expect(result.references).toHaveLength(1);
    expect(result.warnings.unknownTokens).toEqual(['@音频1']);
  });

  it('token idx=0 / 非整数 → 忽略,不进 unknown', () => {
    const result = compileShotGroupVideoPrompt({
      text: '@图片0 @图片abc 都是无效',
      durationS: 5,
      references: [],
    });
    expect(result.warnings.unknownTokens).toEqual([]);
  });
});
