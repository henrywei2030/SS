/**
 * MOSS-TTS-Nano onnxruntime-node 推理 — TTS-B(2026-06-10)
 *
 * 移植自官方 ort_cpu_runtime.py / onnx_tts_runtime.py(Apache-2.0,OpenMOSS/MOSS-TTS-Nano,
 * browser-poc ONNX 导出版),**零 Python**:onnxruntime-node + sentencepiece-js(分词已
 * 与 Python 逐 id 对照一致)+ ffmpeg 音频 IO。
 *
 * 只移植 `sample_mode=fixed` 路径(manifest 默认,PoC 实测用的就是它):
 *   - 每帧的 assistant/audio 采样(16 码本 + 重复惩罚 + top-k/top-p)全部在
 *     `local_fixed_sampled_frame.onnx` 图内完成,宿主只喂 hidden + 重复掩码 + 随机数
 *   - 流程:tokenize → 拼 voice-clone 请求行(manifest 模板 token)→ prefill(KV 初始化)
 *     → 循环 [fixed_frame 采样 → decode_step 推进 KV] → decode_full 一次性解码 48k 立体声
 *   - greedy / local_cached_step / 流式 codec 路径不移植(我们生成 5-15s 样本,无流式需求)
 *
 * KV cache 名称完全由 tts meta 的 onnx.*_names 驱动(present_* ↔ past_*),不硬编码。
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

import * as ort from 'onnxruntime-node';
// sentencepiece-js 无类型声明
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { SentencePieceProcessor } from 'sentencepiece-js';

// ---------------------------------------------------------------------------
// manifest / meta 类型(只声明用到的字段)
// ---------------------------------------------------------------------------

export interface NanoTtsConfig {
  n_vq: number;
  audio_pad_token_id: number;
  audio_start_token_id: number;
  audio_end_token_id: number;
  audio_user_slot_token_id: number;
  audio_assistant_slot_token_id: number;
  audio_codebook_sizes: number[];
}

export interface NanoGenerationDefaults {
  max_new_frames: number;
  sample_mode: string;
}

export interface NanoBuiltinVoice {
  voice: string;
  prompt_audio_codes: number[][];
}

interface NanoManifest {
  model_files: { tts_meta: string; codec_meta: string; tokenizer_model: string };
  tts_config: NanoTtsConfig;
  prompt_templates: {
    user_prompt_prefix_token_ids: number[];
    user_prompt_after_reference_token_ids: number[];
    assistant_prompt_prefix_token_ids: number[];
  };
  generation_defaults: NanoGenerationDefaults;
  builtin_voices: NanoBuiltinVoice[];
}

interface NanoTtsMeta {
  files: Record<string, string>;
  onnx: {
    prefill_output_names: string[];
    decode_input_names: string[];
    decode_output_names: string[];
  };
}

interface NanoCodecMeta {
  files: { encode: string; decode_full: string };
  codec_config: { sample_rate: number; channels: number; num_quantizers: number };
}

export interface SynthesisResult {
  /** planar 声道 PCM(f32, -1..1) */
  channels: Float32Array[];
  sampleRate: number;
  frames: number;
  durationS: number;
}

// ---------------------------------------------------------------------------
// 纯函数(单测用)
// ---------------------------------------------------------------------------

/** 文本 token → 行(行宽 n_vq+1,首位 token,其余 audio_pad) */
export function buildTextRows(tokenIds: number[], cfg: NanoTtsConfig): number[][] {
  const rowWidth = cfg.n_vq + 1;
  return tokenIds.map((id) => {
    const row = new Array<number>(rowWidth).fill(cfg.audio_pad_token_id);
    row[0] = id;
    return row;
  });
}

/** 参考音频 codes → 行(首位 user_slot,后接 16 码本) */
export function buildAudioPrefixRows(
  promptAudioCodes: number[][],
  cfg: NanoTtsConfig,
): number[][] {
  const rowWidth = cfg.n_vq + 1;
  return promptAudioCodes.map((codeRow) => {
    const row = new Array<number>(rowWidth).fill(cfg.audio_pad_token_id);
    row[0] = cfg.audio_user_slot_token_id;
    for (let i = 0; i < Math.min(codeRow.length, cfg.n_vq); i++) row[i + 1] = codeRow[i]!;
    return row;
  });
}

/** voice-clone 完整请求行(模板前缀 + 参考音频 + 模板后缀 + 文本 + assistant 起手) */
export function buildVoiceCloneRequestRows(
  promptAudioCodes: number[][],
  textTokenIds: number[],
  manifest: Pick<NanoManifest, 'tts_config' | 'prompt_templates'>,
): { inputIds: number[][]; attentionMask: number[][] } {
  const cfg = manifest.tts_config;
  const tpl = manifest.prompt_templates;
  const prefixText = [...tpl.user_prompt_prefix_token_ids, cfg.audio_start_token_id];
  const suffixText = [
    cfg.audio_end_token_id,
    ...tpl.user_prompt_after_reference_token_ids,
    ...textTokenIds,
    ...tpl.assistant_prompt_prefix_token_ids,
    cfg.audio_start_token_id,
  ];
  const rows = [
    ...buildTextRows(prefixText, cfg),
    ...buildAudioPrefixRows(promptAudioCodes, cfg),
    ...buildTextRows(suffixText, cfg),
  ];
  return { inputIds: rows, attentionMask: [rows.map(() => 1)] };
}

function int32Tensor(data: number[] | Int32Array, dims: number[]): ort.Tensor {
  // 六七深审 P2:显式复制一份 — 即便传入已是 Int32Array(如复用的 repetitionMask),
  // 也给 Tensor 独立 buffer,消除「ORT 异步持有 buffer 期间 JS 侧改原数组」的别名隐患。
  return new ort.Tensor('int32', new Int32Array(data), dims);
}

function rows3dTensor(rows: number[][]): ort.Tensor {
  const dim1 = rows.length;
  const dim2 = rows[0]!.length;
  const flat = new Int32Array(dim1 * dim2);
  for (let i = 0; i < dim1; i++) for (let j = 0; j < dim2; j++) flat[i * dim2 + j] = rows[i]![j]!;
  return int32Tensor(flat, [1, dim1, dim2]);
}

/** global_hidden 输出统一成 [1, hidden](取末位置) */
function extractLastHidden(t: ort.Tensor): ort.Tensor {
  const dims = t.dims;
  if (dims.length === 2) return t;
  if (dims.length !== 3 || dims[0] !== 1) {
    throw new Error(`global_hidden 形状异常: [${dims.join(',')}]`);
  }
  const [, seq, hidden] = dims as [number, number, number];
  const data = t.data as Float32Array;
  // 六七深审 P2 防御:seq 恒 ≥1(prefill 后),但 Math.max(0) 杜绝 seq=0 时 slice 负索引取空
  const start = Math.max(0, (seq - 1) * hidden);
  const last = data.slice(start, start + hidden);
  return new ort.Tensor('float32', last, [1, hidden]);
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const MANIFEST_CANDIDATES = ['browser_poc_manifest.json', 'MOSS-TTS-Nano-100M-ONNX/browser_poc_manifest.json'];

export class NanoTtsRuntime {
  private constructor(
    readonly manifest: NanoManifest,
    private readonly ttsMeta: NanoTtsMeta,
    private readonly codecMeta: NanoCodecMeta,
    private readonly sessions: {
      prefill: ort.InferenceSession;
      decode: ort.InferenceSession;
      fixedFrame: ort.InferenceSession;
      codecEncode: ort.InferenceSession;
      codecDecode: ort.InferenceSession;
    },
    private readonly sp: { encodeIds(text: string): number[] },
  ) {}

  get sampleRate(): number {
    return this.codecMeta.codec_config.sample_rate;
  }
  get codecChannels(): number {
    return this.codecMeta.codec_config.channels;
  }

  static async load(opts: { modelsDir: string; threads?: number }): Promise<NanoTtsRuntime> {
    const threads = Math.max(1, opts.threads ?? 4);
    let manifestPath: string | null = null;
    for (const rel of MANIFEST_CANDIDATES) {
      const candidate = resolve(opts.modelsDir, rel);
      try {
        readFileSync(candidate);
        manifestPath = candidate;
        break;
      } catch {
        /* try next */
      }
    }
    if (!manifestPath) {
      throw new Error(`browser_poc_manifest.json 不存在于 ${opts.modelsDir}(权重未下载?)`);
    }
    const manifestDir = dirname(manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as NanoManifest;
    const ttsMetaPath = resolve(manifestDir, manifest.model_files.tts_meta);
    const codecMetaPath = resolve(manifestDir, manifest.model_files.codec_meta);
    const ttsMeta = JSON.parse(readFileSync(ttsMetaPath, 'utf8')) as NanoTtsMeta;
    const codecMeta = JSON.parse(readFileSync(codecMetaPath, 'utf8')) as NanoCodecMeta;
    if (!ttsMeta.files.local_fixed_sampled_frame) {
      throw new Error('权重缺 local_fixed_sampled_frame.onnx(只支持 fixed 采样路径)');
    }

    const sessionOpts: ort.InferenceSession.SessionOptions = {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: threads,
      interOpNumThreads: 1,
    };
    const ttsDir = dirname(ttsMetaPath);
    const codecDir = dirname(codecMetaPath);
    const [prefill, decode, fixedFrame, codecEncode, codecDecode] = await Promise.all([
      ort.InferenceSession.create(join(ttsDir, ttsMeta.files.prefill!), sessionOpts),
      ort.InferenceSession.create(join(ttsDir, ttsMeta.files.decode_step!), sessionOpts),
      ort.InferenceSession.create(join(ttsDir, ttsMeta.files.local_fixed_sampled_frame!), sessionOpts),
      ort.InferenceSession.create(join(codecDir, codecMeta.files.encode), sessionOpts),
      ort.InferenceSession.create(join(codecDir, codecMeta.files.decode_full), sessionOpts),
    ]);

    const sp = new SentencePieceProcessor();
    await sp.load(resolve(manifestDir, manifest.model_files.tokenizer_model));

    return new NanoTtsRuntime(
      manifest,
      ttsMeta,
      codecMeta,
      { prefill, decode, fixedFrame, codecEncode, codecDecode },
      sp as { encodeIds(text: string): number[] },
    );
  }

  listBuiltinVoices(): Array<{ voice: string }> {
    return this.manifest.builtin_voices.map((v) => ({ voice: v.voice }));
  }

  encodeText(text: string): number[] {
    return this.sp.encodeIds(text);
  }

  /** 参考音频 PCM(planar,目标采样率/声道)→ 16 码本 codes */
  async encodeReferencePcm(channels: Float32Array[]): Promise<number[][]> {
    const ch = this.codecChannels;
    if (channels.length !== ch) throw new Error(`参考音频声道数需为 ${ch}`);
    const frames = channels[0]!.length;
    const planar = new Float32Array(ch * frames);
    for (let c = 0; c < ch; c++) planar.set(channels[c]!, c * frames);
    const outputs = await this.sessions.codecEncode.run({
      waveform: new ort.Tensor('float32', planar, [1, ch, frames]),
      input_lengths: int32Tensor([frames], [1]),
    });
    const codes = outputs['audio_codes']!;
    const lengths = outputs['audio_code_lengths']!.data as Int32Array;
    const codeLength = Number(lengths[0]);
    const nq = this.codecMeta.codec_config.num_quantizers;
    const data = codes.data as Int32Array | BigInt64Array;
    const result: number[][] = [];
    for (let f = 0; f < codeLength; f++) {
      const row: number[] = [];
      for (let q = 0; q < nq; q++) row.push(Number(data[f * nq + q]));
      result.push(row);
    }
    return result;
  }

  /** 生成音频帧(fixed 采样路径) */
  private async generateAudioFrames(
    requestRows: { inputIds: number[][]; attentionMask: number[][] },
    maxNewFrames: number,
  ): Promise<number[][]> {
    const cfg = this.manifest.tts_config;
    const nVq = cfg.n_vq;
    const rowWidth = nVq + 1;
    const codebookSize = cfg.audio_codebook_sizes[0]!;

    const prefillOutputs = await this.sessions.prefill.run({
      input_ids: rows3dTensor(requestRows.inputIds),
      attention_mask: int32Tensor(requestRows.attentionMask[0]!, [1, requestRows.attentionMask[0]!.length]),
    });
    let globalHidden = extractLastHidden(prefillOutputs['global_hidden']!);
    let pastValidLength = requestRows.attentionMask[0]!.reduce((a, b) => a + b, 0);
    // present_* → past_*(名称映射由 meta 驱动)
    let pastByName: Record<string, ort.Tensor> = {};
    for (const name of this.ttsMeta.onnx.prefill_output_names.slice(1)) {
      pastByName[name.replace('present_', 'past_')] = prefillOutputs[name]!;
    }

    // 重复惩罚掩码(图内消费):[1, n_vq, codebook],增量置位
    const repetitionMask = new Int32Array(nVq * codebookSize);
    const generated: number[][] = [];

    for (let step = 0; step < maxNewFrames; step++) {
      const assistantRandom = new Float32Array([Math.min(0.99999994, Math.random())]);
      const audioRandom = new Float32Array(nVq);
      for (let i = 0; i < nVq; i++) audioRandom[i] = Math.min(0.99999994, Math.random());

      const frameOutputs = await this.sessions.fixedFrame.run({
        global_hidden: globalHidden,
        repetition_seen_mask: int32Tensor(repetitionMask, [1, nVq, codebookSize]),
        assistant_random_u: new ort.Tensor('float32', assistantRandom, [1]),
        audio_random_u: new ort.Tensor('float32', audioRandom, [1, nVq]),
      });
      const shouldContinue = Number((frameOutputs['should_continue']!.data as Int32Array | BigInt64Array)[0]) !== 0;
      if (!shouldContinue) break;
      const frameData = frameOutputs['frame_token_ids']!.data as Int32Array | BigInt64Array;
      const frame: number[] = [];
      for (let c = 0; c < nVq; c++) {
        const token = Number(frameData[c]);
        frame.push(token);
        if (token >= 0 && token < codebookSize) repetitionMask[c * codebookSize + token] = 1;
      }
      generated.push(frame);

      // 推进全局 KV:next_row = [assistant_slot, ...frame]
      const nextRow = new Int32Array(rowWidth).fill(cfg.audio_pad_token_id);
      nextRow[0] = cfg.audio_assistant_slot_token_id;
      for (let i = 0; i < frame.length; i++) nextRow[i + 1] = frame[i]!;
      const decodeFeeds: Record<string, ort.Tensor> = {
        input_ids: int32Tensor(nextRow, [1, 1, rowWidth]),
        past_valid_lengths: int32Tensor([pastValidLength], [1]),
      };
      for (const name of this.ttsMeta.onnx.decode_input_names.slice(2)) {
        decodeFeeds[name] = pastByName[name]!;
      }
      const decodeOutputs = await this.sessions.decode.run(decodeFeeds);
      globalHidden = extractLastHidden(decodeOutputs['global_hidden']!);
      pastValidLength += 1;
      pastByName = {};
      for (const name of this.ttsMeta.onnx.decode_output_names.slice(1)) {
        pastByName[name.replace('present_', 'past_')] = decodeOutputs[name]!;
      }
    }
    return generated;
  }

  /** 帧 → 48k 立体声 PCM(decode_full 一次性) */
  private async decodeFullAudio(frames: number[][]): Promise<SynthesisResult> {
    const nq = this.codecMeta.codec_config.num_quantizers;
    const flat = new Int32Array(frames.length * nq);
    for (let f = 0; f < frames.length; f++) {
      for (let q = 0; q < nq; q++) flat[f * nq + q] = frames[f]![q] ?? 0;
    }
    const outputs = await this.sessions.codecDecode.run({
      audio_codes: int32Tensor(flat, [1, frames.length, nq]),
      audio_code_lengths: int32Tensor([frames.length], [1]),
    });
    const audio = outputs['audio']!;
    const audioLength = Number((outputs['audio_lengths']!.data as Int32Array | BigInt64Array)[0]);
    const [, ch, total] = audio.dims as [number, number, number];
    const data = audio.data as Float32Array;
    const end = Math.min(audioLength, total);
    const channels: Float32Array[] = [];
    for (let c = 0; c < ch; c++) channels.push(data.slice(c * total, c * total + end));
    return {
      channels,
      sampleRate: this.sampleRate,
      frames: frames.length,
      durationS: end / this.sampleRate,
    };
  }

  /**
   * 合成:文本 + 声线(内置名 或 参考音频 codes)→ PCM。
   * 文本应已做基本清洗(归一化责任在调用方;台词类干净文本可直接进)。
   */
  async synthesize(opts: {
    text: string;
    voice?: string;
    promptAudioCodes?: number[][];
    maxNewFrames?: number;
  }): Promise<SynthesisResult> {
    const text = opts.text.trim();
    if (!text) throw new Error('合成文本为空');
    let codes = opts.promptAudioCodes;
    if (!codes) {
      const voiceName = opts.voice ?? this.manifest.builtin_voices[0]!.voice;
      const voice = this.manifest.builtin_voices.find((v) => v.voice === voiceName);
      if (!voice) throw new Error(`内置声线不存在: ${voiceName}`);
      codes = voice.prompt_audio_codes;
    }
    const textIds = this.encodeText(text);
    const rows = buildVoiceCloneRequestRows(codes, textIds, this.manifest);
    const frames = await this.generateAudioFrames(
      rows,
      opts.maxNewFrames ?? this.manifest.generation_defaults.max_new_frames,
    );
    if (frames.length === 0) throw new Error('模型未生成任何音频帧(文本可能过短或异常)');
    return this.decodeFullAudio(frames);
  }
}

// ---------------------------------------------------------------------------
// 进程级单例(模型加载 ~秒级 + 占内存,worker 进程内复用;globalThis 防多模块实例)
// ---------------------------------------------------------------------------

type GlobalWithNano = typeof globalThis & {
  __ss_nanoTtsRuntime?: Promise<NanoTtsRuntime> | null;
};

export function getNanoTtsRuntime(modelsDir: string): Promise<NanoTtsRuntime> {
  const g = globalThis as GlobalWithNano;
  if (!g.__ss_nanoTtsRuntime) {
    g.__ss_nanoTtsRuntime = NanoTtsRuntime.load({ modelsDir }).catch((err) => {
      g.__ss_nanoTtsRuntime = null; // 失败不缓存,允许下次重试(如权重刚下完)
      throw err;
    });
  }
  return g.__ss_nanoTtsRuntime;
}
