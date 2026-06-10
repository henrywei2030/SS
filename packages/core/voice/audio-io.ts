/**
 * 声音样本音频 IO — TTS-B(2026-06-10)
 *
 * 全部走 ffmpeg(M0 封装的二进制),不引入任何 JS 音频解码依赖:
 *   - 任意输入音频 → f32 PCM(目标采样率/声道,planar 返回)— 参考音频喂 codec encode 用
 *   - f32 PCM → WAV(PCM16)Buffer — 生成结果落盘/上传用(手写 RIFF 头,44 字节)
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { resolveFfmpegPath } from '../media/ffmpeg.js';

const execFileAsync = promisify(execFile);

/** 参考音频解码上限(秒)— 声线克隆参考超过这个长度没有收益,防超大输入打爆内存 */
const MAX_REF_AUDIO_SECONDS = 20;

/**
 * 任意音频文件 → planar Float32Array[](每声道一条),按目标采样率/声道数重采样。
 * mono→stereo 由 ffmpeg -ac 完成(复制声道),与官方 Python 预处理语义一致。
 */
export async function decodeAudioToPcm(
  filePath: string,
  opts: { sampleRate: number; channels: number },
): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  const { stdout } = await execFileAsync(
    resolveFfmpegPath(),
    [
      '-v', 'error',
      '-i', filePath,
      '-t', String(MAX_REF_AUDIO_SECONDS),
      '-f', 'f32le',
      '-acodec', 'pcm_f32le',
      '-ac', String(opts.channels),
      '-ar', String(opts.sampleRate),
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
  );
  const interleaved = new Float32Array(
    stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength),
  );
  const frames = Math.floor(interleaved.length / opts.channels);
  if (frames === 0) throw new Error(`参考音频解码为空: ${filePath}`);
  const channels: Float32Array[] = [];
  for (let c = 0; c < opts.channels; c++) {
    const ch = new Float32Array(frames);
    for (let i = 0; i < frames; i++) ch[i] = interleaved[i * opts.channels + c]!;
    channels.push(ch);
  }
  return { channels, sampleRate: opts.sampleRate };
}

/** planar f32 → WAV(PCM16) Buffer */
export function encodeWavPcm16(channels: Float32Array[], sampleRate: number): Buffer {
  const numChannels = channels.length;
  if (numChannels === 0) throw new Error('encodeWavPcm16: 无声道数据');
  const frames = channels[0]!.length;
  const dataBytes = frames * numChannels * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * 2, 28); // byte rate
  buf.writeUInt16LE(numChannels * 2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const v = Math.max(-1, Math.min(1, channels[c]![i]!));
      buf.writeInt16LE(Math.round(v * 32767), offset);
      offset += 2;
    }
  }
  return buf;
}
