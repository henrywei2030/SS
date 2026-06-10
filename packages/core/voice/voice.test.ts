/**
 * 本地 TTS 测试 — TTS-B 验收
 *
 * 纯函数层永远跑;真推理集成层按「权重目录存在」gate:
 *   SS_TTS_MODELS_DIR 指向完整权重(CI/无权重机自动 skip,不挂套件)。
 * 集成断言:中文文本 → 合成 PCM 时长合理 + WAV 可被 ffprobe 识别为有声音频。
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { ffmpegAvailable, probeMedia } from '../media/ffmpeg.js';
import { encodeWavPcm16 } from './audio-io.js';
import { buildSampleText } from './generate-sample.js';
import {
  buildAudioPrefixRows,
  buildTextRows,
  buildVoiceCloneRequestRows,
  getNanoTtsRuntime,
} from './nano-runtime.js';
import { recommendSeedVoice } from './recommend-seed.js';
import { defaultTtsModelsDir, nanoModelsReady } from './weights.js';

const CFG = {
  n_vq: 16,
  audio_pad_token_id: 1024,
  audio_start_token_id: 6,
  audio_end_token_id: 7,
  audio_user_slot_token_id: 8,
  audio_assistant_slot_token_id: 9,
  audio_codebook_sizes: new Array(16).fill(1024) as number[],
};
const TPL = {
  user_prompt_prefix_token_ids: [4, 100],
  user_prompt_after_reference_token_ids: [101],
  assistant_prompt_prefix_token_ids: [5, 102],
};

describe('请求行构造(纯函数,对照官方 Python 语义)', () => {
  it('buildTextRows:行宽 17,首位 token 其余 pad', () => {
    const rows = buildTextRows([42, 7], CFG);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(17);
    expect(rows[0]![0]).toBe(42);
    expect(rows[0]!.slice(1).every((v) => v === 1024)).toBe(true);
  });

  it('buildAudioPrefixRows:首位 user_slot,16 码本逐位填充', () => {
    const rows = buildAudioPrefixRows([[1, 2, 3]], CFG);
    expect(rows[0]![0]).toBe(8);
    expect(rows[0]!.slice(1, 4)).toEqual([1, 2, 3]);
    expect(rows[0]![4]).toBe(1024);
  });

  it('buildVoiceCloneRequestRows:前缀+audio_start | 参考行 | audio_end+模板+文本+assistant+audio_start', () => {
    const { inputIds, attentionMask } = buildVoiceCloneRequestRows(
      [[9, 9]],
      [55],
      { tts_config: CFG, prompt_templates: TPL },
    );
    // 前缀: [4,100,6](3 行) + 参考 1 行 + 后缀 [7,101,55,5,102,6](6 行) = 10 行
    expect(inputIds).toHaveLength(10);
    expect(inputIds[0]![0]).toBe(4);
    expect(inputIds[2]![0]).toBe(6); // audio_start
    expect(inputIds[3]![0]).toBe(8); // user_slot(参考行)
    expect(inputIds[4]![0]).toBe(7); // audio_end
    expect(inputIds[6]![0]).toBe(55); // 文本 token
    expect(inputIds[9]![0]).toBe(6); // assistant audio_start
    expect(attentionMask[0]).toHaveLength(10);
    expect(attentionMask[0]!.every((v) => v === 1)).toBe(true);
  });
});

describe('WAV 编码(纯函数)', () => {
  it('RIFF 头 + PCM16 立体声字节数正确', () => {
    const ch = [new Float32Array([0, 0.5, -0.5]), new Float32Array([1, -1, 0])];
    const wav = encodeWavPcm16(ch, 48000);
    expect(wav.length).toBe(44 + 3 * 2 * 2);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(48000);
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readInt16LE(44 + 2)).toBe(32767); // 第二槽 = 右声道 1.0
  });
});

describe('样本文案取材(纯函数)', () => {
  it('优先独白,空则小传,都空用名字模板;裁剪到上限', () => {
    expect(buildSampleText({ name: 'A', monologue: '我等这一天等了十年。' })).toBe(
      '我等这一天等了十年。',
    );
    expect(buildSampleText({ name: 'A', monologue: '', bio: '他是一个孤儿,自小习武。' })).toBe(
      '他是一个孤儿,自小习武。',
    );
    expect(buildSampleText({ name: '陆鸣' })).toContain('陆鸣');
    expect(buildSampleText({ name: 'A', monologue: '长'.repeat(200) })).toHaveLength(80);
  });
});

// ---------------------------------------------------------------------------
// 集成:真跑 ONNX 推理(权重就绪才跑)
// ---------------------------------------------------------------------------

const modelsDir = defaultTtsModelsDir();
const ready = nanoModelsReady(modelsDir) && ffmpegAvailable();
const tmp = mkdtempSync(join(tmpdir(), 'ss-voice-test-'));

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe.skipIf(!ready)('集成(真跑 Nano ONNX 推理)', () => {
  it(
    '内置声线合成中文 → 时长合理 + ffprobe 识别为有声音频',
    async () => {
      const runtime = await getNanoTtsRuntime(modelsDir);
      expect(runtime.listBuiltinVoices().length).toBeGreaterThanOrEqual(10);

      const result = await runtime.synthesize({
        text: '今天的测试就到这里，谢谢大家。',
        voice: 'Yuewen',
      });
      expect(result.sampleRate).toBe(48000);
      expect(result.durationS).toBeGreaterThan(1);
      expect(result.durationS).toBeLessThan(15);

      const wavPath = join(tmp, 'node-tts.wav');
      writeFileSync(wavPath, encodeWavPcm16(result.channels, result.sampleRate));
      const probe = await probeMedia(wavPath);
      expect(probe.hasAudio).toBe(true);
      expect(Math.abs(probe.durationS - result.durationS)).toBeLessThan(0.2);
      // 非纯静音:有效振幅
      const peak = result.channels[0]!.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak).toBeGreaterThan(0.05);
    },
    180_000,
  );
});

describe.skipIf(ready)('集成跳过提示', () => {
  it('权重未就绪(SS_TTS_MODELS_DIR 未配或文件缺)— 集成已 skip', () => {
    expect(existsSync(join(modelsDir, '.complete'))).toBe(false);
  });
});

describe('recommendSeedVoice(六八:按设定推荐种子声线)', () => {
  it('声音描述关键词命中(男声低沉 → 说书苍劲)', () => {
    const r = recommendSeedVoice({ gender: 'MALE', voiceLabel: '低沉沙哑,像老式收音机' });
    expect(r.seed).toBe('Weiguo');
    expect(r.reason).toContain('低沉');
  });

  it('性别过滤:同是「低沉」女声推 Lingyu 不推 Weiguo', () => {
    const r = recommendSeedVoice({ gender: 'FEMALE', voiceLabel: '低沉温柔' });
    expect(r.seed).toBe('Lingyu');
  });

  it('命中数多者胜', () => {
    const r = recommendSeedVoice({ gender: 'FEMALE', voiceLabel: '明亮活泼,带点俏皮' });
    expect(r.seed).toBe('Xiaoyu');
  });

  it('描述未命中 → 性别+年龄启发(男 50+ → Weiguo,普通男 → Junhao)', () => {
    expect(recommendSeedVoice({ gender: 'MALE', age: 62, voiceLabel: '没特点' }).seed).toBe('Weiguo');
    expect(recommendSeedVoice({ gender: 'MALE', age: 28 }).seed).toBe('Junhao');
    expect(recommendSeedVoice({ gender: 'FEMALE', age: 45 }).seed).toBe('Lingyu');
    expect(recommendSeedVoice({ gender: 'FEMALE', age: 17 }).seed).toBe('Xiaoyu');
  });

  it('无任何线索 → 维持 UI 默认 Yuewen', () => {
    expect(recommendSeedVoice({}).seed).toBe('Yuewen');
    expect(recommendSeedVoice({ gender: 'OTHER', voiceLabel: '' }).seed).toBe('Yuewen');
  });

  it('性别未知但描述命中 → 全池扫描仍可推荐', () => {
    const r = recommendSeedVoice({ voiceLabel: '说书人的嗓音' });
    expect(r.seed).toBe('Weiguo');
  });
});
