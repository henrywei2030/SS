/**
 * ffmpeg / ffprobe 封装 — M0 基建(2026-06-10,蓝图 docs/06 §3 M0)
 *
 * 给后续里程碑的媒体处理用:M1 成片 concat/字幕/BGM 混音、M3 抽尾帧/QC 抽帧。
 * M0 提供四个原语:concat / 抽帧 / 混音(BGM ducking)/ ffprobe 时长。
 *
 * 二进制来源(三平台):
 *   - `ffmpeg-static`(install 时下载本平台单二进制,包根 ffmpeg)
 *   - `ffprobe-static`(包内自带 bin/{platform}/{arch}/ffprobe)
 *   - env `SS_FFMPEG_PATH` / `SS_FFPROBE_PATH` 可覆盖(桌面打包态路径兜底逃生门)
 *
 * ⚠️ 打包注意:两个包已加 next.config serverExternalPackages(防 Next 把 index.js 编进
 *   bundle 后 __dirname 漂移 → 二进制路径失效)。M1 web 侧真用上后,桌面 .app 需验证
 *   standalone 文件追踪带上了二进制(不带则加 outputFileTracingIncludes 或 SS_FFMPEG_PATH)。
 *
 * 安全:全部 execFile 数组传参,无 shell,无注入面;stderr 上限 32MB(ffmpeg 日志大户)。
 * 纯函数 arg builder 单独导出供单测(build*Args),跑二进制的集成测试按二进制存在性 gate。
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

import ffmpegStaticPath from 'ffmpeg-static';

// ffprobe-static 不带 .d.ts(TS7016,api/worker 编译 core 源码时炸)→ createRequire + 显式断言,
// 跟 ESM default import 行为等价(CJS 包,导出 { path, version })
const requireCjs = createRequire(import.meta.url);
const ffprobeStatic = requireCjs('ffprobe-static') as { path: string };

const execFileAsync = promisify(execFile);

const MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

// ---------------------------------------------------------------------------
// 二进制路径解析
// ---------------------------------------------------------------------------

export function resolveFfmpegPath(): string {
  const fromEnv = process.env.SS_FFMPEG_PATH;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error(`SS_FFMPEG_PATH 指向的文件不存在: ${fromEnv}`);
    return fromEnv;
  }
  if (!ffmpegStaticPath) {
    throw new Error('ffmpeg-static 未提供当前平台二进制(安装时下载失败?)— 可用 SS_FFMPEG_PATH 指定');
  }
  if (!existsSync(ffmpegStaticPath)) {
    throw new Error(`ffmpeg 二进制不存在: ${ffmpegStaticPath}(重跑 pnpm install 或设 SS_FFMPEG_PATH)`);
  }
  return ffmpegStaticPath;
}

export function resolveFfprobePath(): string {
  const fromEnv = process.env.SS_FFPROBE_PATH;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error(`SS_FFPROBE_PATH 指向的文件不存在: ${fromEnv}`);
    return fromEnv;
  }
  const p = ffprobeStatic.path;
  if (!p || !existsSync(p)) {
    throw new Error(`ffprobe 二进制不存在: ${p}(重跑 pnpm install 或设 SS_FFPROBE_PATH)`);
  }
  return p;
}

/** 二进制是否就绪(测试 gate / 启动自检用,不抛错) */
export function ffmpegAvailable(): boolean {
  try {
    resolveFfmpegPath();
    resolveFfprobePath();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 进程执行
// ---------------------------------------------------------------------------

export interface RunOptions {
  timeoutMs?: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

async function runBinary(bin: string, args: string[], opts?: RunOptions): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
    });
    return { stdout, stderr };
  } catch (err) {
    // execFile 失败时 err 上带 stderr — 截尾部(ffmpeg 真实错误原因在最后几行)
    const e = err as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    const tail = (e.stderr ?? '').trim().split('\n').slice(-8).join('\n');
    const reason = e.killed ? `超时被杀(>${opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms)` : e.message;
    throw new Error(`${bin.split(/[\\/]/).pop()} 执行失败: ${reason}${tail ? `\n${tail}` : ''}`);
  }
}

export async function runFfmpeg(args: string[], opts?: RunOptions): Promise<RunResult> {
  return runBinary(resolveFfmpegPath(), args, opts);
}

export async function runFfprobe(args: string[], opts?: RunOptions): Promise<RunResult> {
  return runBinary(resolveFfprobePath(), args, opts);
}

// ---------------------------------------------------------------------------
// ffprobe — 时长 / 流信息
// ---------------------------------------------------------------------------

export interface MediaProbe {
  durationS: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
}

/** 探测媒体文件:时长(秒)+ 有无视频/音频流 + 分辨率 */
export async function probeMedia(input: string): Promise<MediaProbe> {
  const { stdout } = await runFfprobe([
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,width,height',
    '-of', 'json',
    input,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const durationS = Number(parsed.format?.duration ?? NaN);
  if (!Number.isFinite(durationS)) {
    throw new Error(`ffprobe 未取到时长: ${input}`);
  }
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  return {
    durationS,
    hasVideo: !!video,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    width: video?.width,
    height: video?.height,
  };
}

/** 实测时长(秒)— M1 SRT 时间轴按这个累加,不信任 DB 里的请求时长 */
export async function probeDurationS(input: string): Promise<number> {
  return (await probeMedia(input)).durationS;
}

// ---------------------------------------------------------------------------
// 抽帧
// ---------------------------------------------------------------------------

export interface ExtractFrameArgs {
  input: string;
  output: string;
  /** 抽帧时间点(秒);省略 = 抽尾帧 */
  atS?: number;
}

/**
 * 纯函数 arg builder(单测用)。
 * - 指定 atS:-ss 放 -i 前走快速 seek + 单帧。
 * - 尾帧:用「时长-margin」做 seek 不可靠(音轨常比视频流长一点,seek 落在最后一帧 PTS
 *   之后 → ffmpeg 0 帧输出且 exit 0)→ 标准做法 `-sseof -1` 解码最后 1 秒 + `-update 1`
 *   逐帧覆写同一输出,结束时文件必是真·最后一帧。
 */
export function buildExtractFrameArgs(a: ExtractFrameArgs): string[] {
  if (a.atS !== undefined) {
    return [
      '-y',
      '-ss', a.atS.toFixed(3),
      '-i', a.input,
      '-frames:v', '1',
      '-q:v', '2',
      a.output,
    ];
  }
  return [
    '-y',
    '-sseof', '-1',
    '-i', a.input,
    '-update', '1',
    '-q:v', '2',
    a.output,
  ];
}

/**
 * 抽单帧 → 图片文件(png/jpg 由 output 扩展名决定)。
 * atS 省略 = 抽尾帧(M3 场内尾帧链:N 组采纳 take 尾帧 → N+1 组首帧参考)。
 * seek 超出片尾时 ffmpeg 会 0 帧输出且不报错 → 这里兜底校验产物存在。
 */
export async function extractFrame(opts: {
  input: string;
  output: string;
  atS?: number;
}): Promise<void> {
  await runFfmpeg(buildExtractFrameArgs(opts));
  if (!existsSync(opts.output)) {
    throw new Error(
      `抽帧无输出(atS=${opts.atS ?? 'last'} 可能超出片尾): ${opts.input} → ${opts.output}`,
    );
  }
}

// ---------------------------------------------------------------------------
// concat — 多段视频串片(M1 成片核心原语)
// ---------------------------------------------------------------------------

export interface ConcatInput {
  path: string;
  /** 无音轨的输入自动垫等长静音(concat filter 要求各段流数一致) */
  hasAudio: boolean;
  /** 无音轨时静音垫的时长 */
  durationS: number;
}

export interface ConcatOptions {
  width: number;
  height: number;
  fps?: number;
}

/**
 * 纯函数 arg builder(单测用)。
 * 统一规格化每段:scale 等比缩进 + pad 黑边 + setsar=1 + 统一 fps;
 * 音频统一 48k 立体声,无音轨段用 anullsrc 垫等长静音 → concat n 段 → x264+aac。
 */
export function buildConcatArgs(
  inputs: ConcatInput[],
  output: string,
  opts: ConcatOptions,
): string[] {
  if (inputs.length === 0) throw new Error('concat 需要至少 1 个输入');
  const fps = opts.fps ?? 30;
  const { width, height } = opts;

  const args: string[] = ['-y'];
  for (const inp of inputs) args.push('-i', inp.path);

  // 无音轨段:追加 lavfi anullsrc 输入(等长静音),输入序号排在视频输入之后
  const silenceInputIdx = new Map<number, number>();
  let nextIdx = inputs.length;
  for (let i = 0; i < inputs.length; i++) {
    if (!inputs[i]!.hasAudio) {
      args.push(
        '-f', 'lavfi',
        '-t', inputs[i]!.durationS.toFixed(3),
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
      );
      silenceInputIdx.set(i, nextIdx++);
    }
  }

  const filters: string[] = [];
  const concatPads: string[] = [];
  for (let i = 0; i < inputs.length; i++) {
    filters.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[v${i}]`,
    );
    const audioSrc = inputs[i]!.hasAudio ? `[${i}:a]` : `[${silenceInputIdx.get(i)}:a]`;
    filters.push(`${audioSrc}aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
    concatPads.push(`[v${i}][a${i}]`);
  }
  filters.push(`${concatPads.join('')}concat=n=${inputs.length}:v=1:a=1[outv][outa]`);

  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[outv]',
    '-map', '[outa]',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    output,
  );
  return args;
}

/** 串片:自动探测各段音轨/时长 → 规格化 concat → 输出 mp4 */
export async function concatVideos(
  inputPaths: string[],
  output: string,
  opts: ConcatOptions & RunOptions,
): Promise<void> {
  const inputs: ConcatInput[] = await Promise.all(
    inputPaths.map(async (p) => {
      const probe = await probeMedia(p);
      if (!probe.hasVideo) throw new Error(`concat 输入无视频流: ${p}`);
      return { path: p, hasAudio: probe.hasAudio, durationS: probe.durationS };
    }),
  );
  await runFfmpeg(buildConcatArgs(inputs, output, opts), { timeoutMs: opts.timeoutMs });
}

// ---------------------------------------------------------------------------
// 参考音频规范化(M2′ 声线小工具:裁剪 + 响度归一)
// ---------------------------------------------------------------------------

export interface NormalizeAudioArgs {
  input: string;
  /** 输出建议 .m4a(aac) */
  output: string;
  /** 响度目标(LUFS),默认 -16(配音参考通用档) */
  targetLufs?: number;
  /** 截断上限(秒),默认 15(参考音频不需要更长) */
  maxDurationS?: number;
}

/**
 * 纯函数 arg builder(单测用)。
 * 处理链:掐头静音 → (areverse 掐尾静音 areverse) → loudnorm 响度归一 → 截断上限。
 * silenceremove 阈值 -45dB / 0.15s:只剪真静音,不吃气口。
 */
export function buildNormalizeAudioArgs(a: NormalizeAudioArgs): string[] {
  const lufs = a.targetLufs ?? -16;
  const maxS = a.maxDurationS ?? 15;
  const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15';
  return [
    '-y',
    '-i', a.input,
    '-af', `${trim},areverse,${trim},areverse,loudnorm=I=${lufs}:TP=-1.5:LRA=11`,
    '-t', String(maxS),
    '-vn',
    '-c:a', 'aac',
    '-b:a', '128k',
    a.output,
  ];
}

/** 参考音频规范化:掐头尾静音 + 响度归一 + 截断,输出 aac/m4a */
export async function normalizeAudio(a: NormalizeAudioArgs): Promise<void> {
  await runFfmpeg(buildNormalizeAudioArgs(a), { timeoutMs: 2 * 60_000 });
  if (!existsSync(a.output)) {
    throw new Error(`音频规范化无输出(输入可能不是有效音频): ${a.input}`);
  }
}

// ---------------------------------------------------------------------------
// BGM 混音(对白 ducking)
// ---------------------------------------------------------------------------

export interface MixBgmArgs {
  videoIn: string;
  videoHasAudio: boolean;
  bgmIn: string;
  output: string;
  /** BGM 基础音量(0-1),默认 0.3 */
  bgmVolume?: number;
  /** 对白 sidechain ducking(有对白时自动压低 BGM),默认开;视频无音轨时无效 */
  duck?: boolean;
}

/**
 * 纯函数 arg builder(单测用)。
 * 视频流 copy 不重编码;BGM 循环铺满(-stream_loop -1)+ -shortest 截到视频长度。
 * ducking 用 sidechaincompress:对白(0:a)作 sidechain 压 BGM,再 amix 对白+压后 BGM。
 */
export function buildMixBgmArgs(a: MixBgmArgs): string[] {
  const vol = a.bgmVolume ?? 0.3;
  const duck = a.duck ?? true;

  const args: string[] = [
    '-y',
    '-i', a.videoIn,
    '-stream_loop', '-1',
    '-i', a.bgmIn,
  ];

  let audioFilter: string;
  if (!a.videoHasAudio) {
    audioFilter = `[1:a]volume=${vol},aformat=channel_layouts=stereo[outa]`;
  } else if (duck) {
    audioFilter =
      `[0:a]asplit=2[dlg][sc];` +
      `[1:a]volume=${vol}[bgm];` +
      `[bgm][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked];` +
      `[dlg][ducked]amix=inputs=2:duration=first:dropout_transition=0,aformat=channel_layouts=stereo[outa]`;
  } else {
    audioFilter =
      `[1:a]volume=${vol}[bgm];` +
      `[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0,aformat=channel_layouts=stereo[outa]`;
  }

  args.push(
    '-filter_complex', audioFilter,
    '-map', '0:v',
    '-map', '[outa]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    a.output,
  );
  return args;
}

/** BGM 混入视频(自动探测视频有无对白音轨) */
export async function mixBgm(opts: {
  videoIn: string;
  bgmIn: string;
  output: string;
  bgmVolume?: number;
  duck?: boolean;
  timeoutMs?: number;
}): Promise<void> {
  const probe = await probeMedia(opts.videoIn);
  await runFfmpeg(
    buildMixBgmArgs({
      videoIn: opts.videoIn,
      videoHasAudio: probe.hasAudio,
      bgmIn: opts.bgmIn,
      output: opts.output,
      bgmVolume: opts.bgmVolume,
      duck: opts.duck,
    }),
    { timeoutMs: opts.timeoutMs },
  );
}
