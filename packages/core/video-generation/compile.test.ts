/**
 * 六八(人到声必到)— collectCharacterVoiceInfo 纯函数测试。
 * 规则:人物绑定在生成段 → 其 voiceMediaId 必进参考声线(不论 usageType / @token);
 * 缺声线提示只针对「需要声线」的角色(主演/配角 — 用户定调:群演不需要)。
 */
import { describe, expect, it } from 'vitest';

import { collectCharacterVoiceInfo } from './compile.js';

function binding(asset: {
  id: string;
  name: string;
  type: string;
  voiceMediaId: string | null;
  characterRole?: string | null;
}): { asset: typeof asset } {
  return { asset };
}

const urlMap = new Map<string, string>([
  ['m-voice-1', 'https://cdn/voice1.m4a'],
  ['m-voice-2', 'https://cdn/voice2.m4a'],
]);
const urlOf = (id: string): string | null => urlMap.get(id) ?? null;

describe('collectCharacterVoiceInfo', () => {
  it('人物有声线 → voiceRefs;主演/配角无声线 → voiceMissing', () => {
    const { voiceRefs, voiceMissing } = collectCharacterVoiceInfo(
      [
        binding({
          id: 'a1',
          name: '林小满',
          type: 'CHARACTER',
          voiceMediaId: 'm-voice-1',
          characterRole: '主演-女主',
        }),
        binding({
          id: 'a2',
          name: '阿野',
          type: 'CHARACTER',
          voiceMediaId: null,
          characterRole: '配角-正派',
        }),
      ],
      urlOf,
    );
    expect(voiceRefs).toEqual([
      { assetId: 'a1', name: '林小满', mediaUrl: 'https://cdn/voice1.m4a' },
    ]);
    expect(voiceMissing).toEqual([{ assetId: 'a2', name: '阿野' }]);
  });

  it('voiceMediaId 有值但 URL 解析不出 → 也算 voiceMissing(送不出去等于没有)', () => {
    const { voiceRefs, voiceMissing } = collectCharacterVoiceInfo(
      [
        binding({
          id: 'a1',
          name: '甲',
          type: 'CHARACTER',
          voiceMediaId: 'm-gone',
          characterRole: '主演-男主',
        }),
      ],
      urlOf,
    );
    expect(voiceRefs).toEqual([]);
    expect(voiceMissing).toEqual([{ assetId: 'a1', name: '甲' }]);
  });

  it('群演/未分类无声线 → 不进 voiceMissing(不需要声线,不唠叨)', () => {
    const { voiceRefs, voiceMissing } = collectCharacterVoiceInfo(
      [
        binding({
          id: 'g1',
          name: '上海群演',
          type: 'CHARACTER',
          voiceMediaId: null,
          characterRole: '群演',
        }),
        binding({
          id: 'u1',
          name: '路人',
          type: 'CHARACTER',
          voiceMediaId: null,
          characterRole: null,
        }),
      ],
      urlOf,
    );
    expect(voiceRefs).toEqual([]);
    expect(voiceMissing).toEqual([]);
  });

  it('群演被手动配了声线 → 仍照常附带(手动 = 明确意图)', () => {
    const { voiceRefs, voiceMissing } = collectCharacterVoiceInfo(
      [
        binding({
          id: 'g1',
          name: '说书先生',
          type: 'CHARACTER',
          voiceMediaId: 'm-voice-1',
          characterRole: '群演',
        }),
      ],
      urlOf,
    );
    expect(voiceRefs).toHaveLength(1);
    expect(voiceMissing).toEqual([]);
  });

  it('同一人物多条 binding(APPEAR + SOUND_VOICE)按 assetId 去重', () => {
    const { voiceRefs, voiceMissing } = collectCharacterVoiceInfo(
      [
        binding({
          id: 'a1',
          name: '林小满',
          type: 'CHARACTER',
          voiceMediaId: 'm-voice-1',
          characterRole: '主演-女主',
        }),
        binding({
          id: 'a1',
          name: '林小满',
          type: 'CHARACTER',
          voiceMediaId: 'm-voice-1',
          characterRole: '主演-女主',
        }),
      ],
      urlOf,
    );
    expect(voiceRefs).toHaveLength(1);
    expect(voiceMissing).toHaveLength(0);
  });

  it('场景 / 道具不参与(声线是人物身份属性)', () => {
    const { voiceRefs, voiceMissing } = collectCharacterVoiceInfo(
      [
        binding({ id: 's1', name: '天台', type: 'SCENE', voiceMediaId: 'm-voice-1' }),
        binding({ id: 'p1', name: '怀表', type: 'PROP', voiceMediaId: null }),
      ],
      urlOf,
    );
    expect(voiceRefs).toEqual([]);
    expect(voiceMissing).toEqual([]);
  });

  it('多人物各取各的声线', () => {
    const { voiceRefs } = collectCharacterVoiceInfo(
      [
        binding({
          id: 'a1',
          name: '甲',
          type: 'CHARACTER',
          voiceMediaId: 'm-voice-1',
          characterRole: '主演-男主',
        }),
        binding({
          id: 'a2',
          name: '乙',
          type: 'CHARACTER',
          voiceMediaId: 'm-voice-2',
          characterRole: '配角-反派',
        }),
      ],
      urlOf,
    );
    expect(voiceRefs.map((r) => r.mediaUrl)).toEqual([
      'https://cdn/voice1.m4a',
      'https://cdn/voice2.m4a',
    ]);
  });
});
