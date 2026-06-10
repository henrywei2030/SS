/**
 * ffmpeg 封装测试 — M0 验收
 *
 * 两层:
 *   1. 纯函数 arg builder 单测(无二进制依赖,永远跑)
 *   2. 真跑集成测试(lavfi 生成 0.6s 微型片段 → probe/concat/抽帧/混音 全原语过一遍),
 *      按 ffmpegAvailable() gate — 二进制缺失(如 install 下载失败)时 skip 不挂 CI
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  buildConcatArgs,
  buildExtractFrameArgs,
  buildMixBgmArgs,
  buildNormalizeAudioArgs,
  concatVideos,
  extractFrame,
  ffmpegAvailable,
  mixBgm,
  normalizeAudio,
  probeMedia,
  runFfmpeg,
} from './ffmpeg.js';

describe('buildConcatArgs(纯函数)', () => {
  it('两段输入(一段无音轨)→ 自动垫 anullsrc 静音输入 + concat=n=2', () => {
    const args = buildConcatArgs(
      [
        { path: 'a.mp4', hasAudio: true, durationS: 5 },
        { path: 'b.mp4', hasAudio: false, durationS: 3.5 },
      ],
      'out.mp4',
      { width: 1080, height: 1920, fps: 30 },
    );
    // 输入顺序:a.mp4(0) b.mp4(1) anullsrc(2,垫 b 的静音,时长对齐)
    expect(args.join(' ')).toContain('-i a.mp4');
    expect(args.join(' ')).toContain('-i b.mp4');
    expect(args.join(' ')).toContain('anullsrc=channel_layout=stereo:sample_rate=48000');
    expect(args).toContain('3.500');
    const filter = args[args.indexOf('-filter_complex') + 1]!;
    expect(filter).toContain('[0:a]aresample');
    expect(filter).toContain('[2:a]aresample'); // b 的音频来自静音输入 2
    expect(filter).toContain('concat=n=2:v=1:a=1[outv][outa]');
    expect(filter).toContain('scale=1080:1920');
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('全有音轨 → 不加 lavfi 输入', () => {
    const args = buildConcatArgs(
      [
        { path: 'a.mp4', hasAudio: true, durationS: 5 },
        { path: 'b.mp4', hasAudio: true, durationS: 4 },
      ],
      'out.mp4',
      { width: 1920, height: 1080 },
    );
    expect(args.join(' ')).not.toContain('anullsrc');
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('fps=30'); // 默认 fps
  });

  it('空输入抛错', () => {
    expect(() => buildConcatArgs([], 'out.mp4', { width: 16, height: 16 })).toThrow();
  });
});

describe('buildMixBgmArgs(纯函数)', () => {
  it('有对白 + ducking:asplit 对白作 sidechain 压 BGM 再 amix', () => {
    const filter = (a: string[]): string => a[a.indexOf('-filter_complex') + 1]!;
    const args = buildMixBgmArgs({
      videoIn: 'v.mp4',
      videoHasAudio: true,
      bgmIn: 'bgm.mp3',
      output: 'out.mp4',
    });
    expect(filter(args)).toContain('sidechaincompress');
    expect(filter(args)).toContain('amix=inputs=2');
    expect(filter(args)).toContain('volume=0.3'); // 默认 BGM 音量
    expect(args).toContain('-stream_loop'); // BGM 循环铺满
    expect(args.join(' ')).toContain('-c:v copy'); // 视频不重编码
  });

  it('有对白不 duck:纯 amix', () => {
    const args = buildMixBgmArgs({
      videoIn: 'v.mp4',
      videoHasAudio: true,
      bgmIn: 'b.mp3',
      output: 'o.mp4',
      duck: false,
      bgmVolume: 0.5,
    });
    const filter = args[args.indexOf('-filter_complex') + 1]!;
    expect(filter).not.toContain('sidechaincompress');
    expect(filter).toContain('volume=0.5');
  });

  it('视频无音轨:BGM 直出为唯一音轨', () => {
    const args = buildMixBgmArgs({
      videoIn: 'v.mp4',
      videoHasAudio: false,
      bgmIn: 'b.mp3',
      output: 'o.mp4',
    });
    const filter = args[args.indexOf('-filter_complex') + 1]!;
    expect(filter).not.toContain('amix');
    expect(filter).toContain('[1:a]volume=');
  });
});

describe('buildExtractFrameArgs(纯函数)', () => {
  it('指定 atS:-ss 在 -i 前(快速 seek)+ 单帧', () => {
    const args = buildExtractFrameArgs({ input: 'v.mp4', output: 'f.png', atS: 4.98 });
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args).toContain('4.980');
    expect(args.join(' ')).toContain('-frames:v 1');
  });

  it('尾帧模式:-sseof -1 + -update 1(不靠时长减 margin)', () => {
    const args = buildExtractFrameArgs({ input: 'v.mp4', output: 'f.png' });
    expect(args.join(' ')).toContain('-sseof -1');
    expect(args.join(' ')).toContain('-update 1');
    expect(args.join(' ')).not.toContain('-ss ');
  });
});

describe('buildNormalizeAudioArgs(纯函数)', () => {
  it('掐头尾静音(areverse 夹心)+ loudnorm + 截断上限 + 纯音频输出', () => {
    const args = buildNormalizeAudioArgs({ input: 'v.wav', output: 'o.m4a' });
    const af = args[args.indexOf('-af') + 1]!;
    expect(af.match(/silenceremove/g)).toHaveLength(2);
    expect(af.match(/areverse/g)).toHaveLength(2);
    expect(af).toContain('loudnorm=I=-16');
    expect(args.join(' ')).toContain('-t 15');
    expect(args).toContain('-vn');
  });

  it('targetLufs / maxDurationS 可调', () => {
    const args = buildNormalizeAudioArgs({
      input: 'a',
      output: 'b',
      targetLufs: -14,
      maxDurationS: 8,
    });
    expect(args[args.indexOf('-af') + 1]).toContain('loudnorm=I=-14');
    expect(args.join(' ')).toContain('-t 8');
  });
});

// ---------------------------------------------------------------------------
// 集成:真跑二进制(lavfi 生成微型素材,全原语过一遍)
// ---------------------------------------------------------------------------

const ffOk = ffmpegAvailable();
const tmp = mkdtempSync(join(tmpdir(), 'ss-ffmpeg-test-'));

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe.skipIf(!ffOk)('集成(真跑 ffmpeg/ffprobe)', () => {
  const clipWithAudio = join(tmp, 'a.mp4');
  const clipSilent = join(tmp, 'b.mp4');
  const bgm = join(tmp, 'bgm.m4a');

  it('lavfi 生成测试素材(0.6s 含音轨 + 0.6s 静音 + 1s BGM)', async () => {
    await runFfmpeg([
      '-y',
      '-f', 'lavfi', '-t', '0.6', '-i', 'testsrc=size=192x108:rate=24',
      '-f', 'lavfi', '-t', '0.6', '-i', 'sine=frequency=440:sample_rate=48000',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      clipWithAudio,
    ]);
    await runFfmpeg([
      '-y',
      '-f', 'lavfi', '-t', '0.6', '-i', 'testsrc=size=128x128:rate=24',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an',
      clipSilent,
    ]);
    await runFfmpeg([
      '-y',
      '-f', 'lavfi', '-t', '1', '-i', 'sine=frequency=220:sample_rate=48000',
      '-c:a', 'aac',
      bgm,
    ]);
    expect(existsSync(clipWithAudio) && existsSync(clipSilent) && existsSync(bgm)).toBe(true);
  }, 30_000);

  it('probeMedia:时长 ≈0.6s + 音轨有无判定正确', async () => {
    const a = await probeMedia(clipWithAudio);
    expect(a.durationS).toBeGreaterThan(0.4);
    expect(a.durationS).toBeLessThan(1.0);
    expect(a.hasVideo).toBe(true);
    expect(a.hasAudio).toBe(true);
    expect(a.width).toBe(192);

    const b = await probeMedia(clipSilent);
    expect(b.hasAudio).toBe(false);
  }, 15_000);

  it('concatVideos:含音轨段 + 静音段 → 总时长 ≈1.2s,统一 256x144', async () => {
    const out = join(tmp, 'concat.mp4');
    await concatVideos([clipWithAudio, clipSilent], out, { width: 256, height: 144, fps: 24 });
    const probe = await probeMedia(out);
    expect(probe.durationS).toBeGreaterThan(1.0);
    expect(probe.durationS).toBeLessThan(1.6);
    expect(probe.hasAudio).toBe(true);
    expect(probe.width).toBe(256);
    expect(probe.height).toBe(144);
  }, 30_000);

  it('extractFrame:默认抽尾帧出图', async () => {
    const out = join(tmp, 'last.png');
    await extractFrame({ input: clipWithAudio, output: out });
    expect(existsSync(out)).toBe(true);
  }, 15_000);

  it('mixBgm:静音视频混入 BGM → 出现音轨,时长不变(≈0.6s)', async () => {
    const out = join(tmp, 'mixed.mp4');
    await mixBgm({ videoIn: clipSilent, bgmIn: bgm, output: out });
    const probe = await probeMedia(out);
    expect(probe.hasAudio).toBe(true);
    expect(probe.durationS).toBeLessThan(1.0);
  }, 15_000);

  it('normalizeAudio:带头尾静音的音频 → 掐静音 + 时长被截到上限内', async () => {
    // 0.5s 静音 + 1s 440Hz + 0.5s 静音(总 2s)
    const padded = join(tmp, 'padded.wav');
    await runFfmpeg([
      '-y',
      '-f', 'lavfi', '-t', '2',
      '-i', 'sine=frequency=440:sample_rate=48000',
      '-af', 'volume=0:enable=\'lt(t,0.5)+gt(t,1.5)\'',
      padded,
    ]);
    const out = join(tmp, 'normalized.m4a');
    await normalizeAudio({ input: padded, output: out, maxDurationS: 10 });
    const probe = await probeMedia(out);
    expect(probe.hasAudio).toBe(true);
    // 掐掉首尾 ~1s 静音后应明显短于原 2s(loudnorm 会有少量 padding,放宽到 <1.6s)
    expect(probe.durationS).toBeLessThan(1.6);
  }, 20_000);
});

describe.skipIf(ffOk)('集成跳过提示', () => {
  it('ffmpeg/ffprobe 二进制不可用 — 集成测试已 skip(重跑 pnpm install 可恢复)', () => {
    expect(ffOk).toBe(false);
  });
});
