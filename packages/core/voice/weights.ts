/**
 * Nano 权重管理 — TTS-B(2026-06-10)
 *
 * 权重(~845MB)不入 git 不入安装包,**首次使用时从 ModelScope 下载**(国内直连快;
 * HF 被墙、hf-mirror 对这两个仓只会 308 回源 — 2026-06-10 实测)。
 * 目录:env `SS_TTS_MODELS_DIR` > `~/.starsalign/tts-models`(各机独立,桌面/服务器同路径策略)。
 * 完整性:逐文件存在 + 非 LFS 指针 + 尺寸下限;原子写(.part → rename);`.complete` 标记。
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MODELSCOPE_BASE = 'https://www.modelscope.cn/models/OpenMOSS';

interface WeightFile {
  repo: string;
  file: string;
  /** 尺寸下限(字节)— 防 LFS 指针/截断;真实尺寸见注释 */
  minBytes: number;
}

/** 两个仓全部必需文件(2026-06-10 ModelScope 清单) */
export const NANO_WEIGHT_FILES: WeightFile[] = [
  // 主模型(MOSS-TTS-Nano-100M-ONNX,~672MB)
  { repo: 'MOSS-TTS-Nano-100M-ONNX', file: 'browser_poc_manifest.json', minBytes: 100_000 },
  { repo: 'MOSS-TTS-Nano-100M-ONNX', file: 'tts_browser_onnx_meta.json', minBytes: 1_000 },
  { repo: 'MOSS-TTS-Nano-100M-ONNX', file: 'tokenizer.model', minBytes: 400_000 },
  { repo: 'MOSS-TTS-Nano-100M-ONNX', file: 'moss_tts_prefill.onnx', minBytes: 200_000 },
  { repo: 'MOSS-TTS-Nano-100M-ONNX', file: 'moss_tts_decode_step.onnx', minBytes: 200_000 },
  { repo: 'MOSS-TTS-Nano-100M-ONNX', file: 'moss_tts_local_decoder.onnx', minBytes: 30_000 },
  { repo: 'MOSS-TTS-Nano-100M-ONNX', file: 'moss_tts_local_cached_step.onnx', minBytes: 30_000 },
  { repo: 'MOSS-TTS-Nano-100M-ONNX', file: 'moss_tts_local_fixed_sampled_frame.onnx', minBytes: 300_000 },
  { repo: 'MOSS-TTS-Nano-100M-ONNX', file: 'moss_tts_global_shared.data', minBytes: 400_000_000 }, // 440.8MB
  { repo: 'MOSS-TTS-Nano-100M-ONNX', file: 'moss_tts_local_shared.data', minBytes: 200_000_000 }, // 229.7MB
  // 音频 codec(MOSS-Audio-Tokenizer-Nano-ONNX,~75MB)
  { repo: 'MOSS-Audio-Tokenizer-Nano-ONNX', file: 'codec_browser_onnx_meta.json', minBytes: 500 },
  { repo: 'MOSS-Audio-Tokenizer-Nano-ONNX', file: 'moss_audio_tokenizer_encode.onnx', minBytes: 100_000 },
  { repo: 'MOSS-Audio-Tokenizer-Nano-ONNX', file: 'moss_audio_tokenizer_encode.data', minBytes: 25_000_000 }, // 30MB
  { repo: 'MOSS-Audio-Tokenizer-Nano-ONNX', file: 'moss_audio_tokenizer_decode_full.onnx', minBytes: 400_000 },
  { repo: 'MOSS-Audio-Tokenizer-Nano-ONNX', file: 'moss_audio_tokenizer_decode_step.onnx', minBytes: 200_000 },
  { repo: 'MOSS-Audio-Tokenizer-Nano-ONNX', file: 'moss_audio_tokenizer_decode_shared.data', minBytes: 40_000_000 }, // 44MB
];

export function defaultTtsModelsDir(): string {
  return process.env.SS_TTS_MODELS_DIR ?? join(homedir(), '.starsalign', 'tts-models');
}

/**
 * 18 条内置声线静态清单(manifest 同源快照)— UI 在权重未下载时也能展示选项。
 * lang/gender/desc 仅 UI 标注 + 推荐用,不影响功能;真相源是 manifest.builtin_voices
 * (gender 来自 manifest.group,desc 按 display_name 人工转写,2026-06-10 六八快照)。
 */
export const NANO_BUILTIN_VOICES: Array<{
  name: string;
  lang: 'zh' | 'en' | 'jp';
  gender: 'M' | 'F';
  desc: string;
}> = [
  { name: 'Yuewen', lang: 'zh', gender: 'F', desc: '飒爽利落(机车)' },
  { name: 'Xiaoyu', lang: 'zh', gender: 'F', desc: '明亮(明星范)' },
  { name: 'Lingyu', lang: 'zh', gender: 'F', desc: '低沉温柔(深夜电台)' },
  { name: 'Junhao', lang: 'zh', gender: 'M', desc: '标准青年' },
  { name: 'Zhiming', lang: 'zh', gender: 'M', desc: '京味闲聊' },
  { name: 'Weiguo', lang: 'zh', gender: 'M', desc: '说书苍劲' },
  { name: 'Ava', lang: 'en', gender: 'F', desc: '英文女声' },
  { name: 'Bella', lang: 'en', gender: 'F', desc: '英文女声(轻柔)' },
  { name: 'Adam', lang: 'en', gender: 'M', desc: '英文男声(新闻)' },
  { name: 'Nathan', lang: 'en', gender: 'M', desc: '英文男声(舒缓)' },
  { name: 'Trump', lang: 'en', gender: 'M', desc: '英文男声(特朗普)' },
  { name: 'Soyo', lang: 'jp', gender: 'F', desc: '日文女声' },
  { name: 'Saki', lang: 'jp', gender: 'F', desc: '日文女声' },
  { name: 'Mortis', lang: 'jp', gender: 'F', desc: '日文女声' },
  { name: 'Umiri', lang: 'jp', gender: 'F', desc: '日文女声' },
  { name: 'Mei', lang: 'jp', gender: 'F', desc: '日文女声' },
  { name: 'Anon', lang: 'jp', gender: 'F', desc: '日文女声' },
  { name: 'Arisa', lang: 'jp', gender: 'F', desc: '日文女声' },
];

function isLfsPointer(path: string): boolean {
  try {
    const head = readFileSync(path, { encoding: 'utf8', flag: 'r' }).slice(0, 40);
    return head.startsWith('version https://git-lfs');
  } catch {
    return false;
  }
}

function fileOk(path: string, minBytes: number): boolean {
  try {
    const st = statSync(path);
    if (st.size < minBytes) return false;
    if (minBytes < 10_000_000 && isLfsPointer(path)) return false; // 小文件才值得读头检查
    return true;
  } catch {
    return false;
  }
}

/** 全部文件是否就绪(快速检查,UI 显示用) */
export function nanoModelsReady(dir = defaultTtsModelsDir()): boolean {
  return NANO_WEIGHT_FILES.every((w) => fileOk(join(dir, w.repo, w.file), w.minBytes));
}

// ---------------------------------------------------------------------------
// 七二(用户需求①):安装可观测化 — 进度落盘 `<dir>/.progress.json`,任何进程(web/worker)
// 都能读;UI 轮询渲染下载进度/就绪/失败,失败可重装/清缓存。
// ---------------------------------------------------------------------------

export interface NanoWeightsProgress {
  state: 'downloading' | 'ready' | 'error';
  /** 当前文件(downloading 时) */
  currentFile?: string;
  fileIndex?: number;
  totalFiles?: number;
  /** 本次安装累计已下字节 / 预计总字节(Content-Length 累加,缺头时用 minBytes 估) */
  doneBytes?: number;
  expectedBytes?: number;
  error?: string;
  updatedAt: string;
}

const PROGRESS_FILE = '.progress.json';

export function readNanoWeightsProgress(dir = defaultTtsModelsDir()): NanoWeightsProgress | null {
  try {
    const raw = readFileSync(join(dir, PROGRESS_FILE), 'utf8');
    return JSON.parse(raw) as NanoWeightsProgress;
  } catch {
    return null;
  }
}

function writeProgress(dir: string, p: NanoWeightsProgress): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, PROGRESS_FILE), JSON.stringify(p));
  } catch {
    /* 进度是增强项,写失败不影响下载 */
  }
}

export interface NanoWeightsStatus {
  ready: boolean;
  filesDone: number;
  filesTotal: number;
  /** 权重目录现占磁盘(MB,粗略) */
  sizeMb: number;
  /** 最近一次安装进度(downloading 进行中 / error 失败留痕 / ready) */
  progress: NanoWeightsProgress | null;
  dir: string;
}

/** 安装状态总览(UI 轮询数据源)— 纯本地文件检查,零网络开销 */
export function getNanoWeightsStatus(dir = defaultTtsModelsDir()): NanoWeightsStatus {
  const filesDone = NANO_WEIGHT_FILES.filter((w) =>
    fileOk(join(dir, w.repo, w.file), w.minBytes),
  ).length;
  let sizeMb = 0;
  try {
    for (const repo of new Set(NANO_WEIGHT_FILES.map((w) => w.repo))) {
      const rd = join(dir, repo);
      if (!existsSync(rd)) continue;
      for (const f of readdirSync(rd)) {
        try {
          sizeMb += statSync(join(rd, f)).size / 1e6;
        } catch {
          /* 单文件 stat 失败忽略 */
        }
      }
    }
  } catch {
    /* 目录读失败 → sizeMb 维持已累计值 */
  }
  const progress = readNanoWeightsProgress(dir);
  const ready = filesDone === NANO_WEIGHT_FILES.length;
  return {
    ready,
    filesDone,
    filesTotal: NANO_WEIGHT_FILES.length,
    sizeMb: Math.round(sizeMb),
    // 就绪后陈旧的 downloading/error 痕迹不再有意义
    progress: ready && progress?.state !== 'ready' ? { state: 'ready', updatedAt: new Date().toISOString() } : progress,
    dir,
  };
}

/**
 * 清理权重缓存(重装前 / 损坏自救)。下载进行中(进度 2 分钟内更新过)拒绝清理,
 * 防止 rm 正在写的文件;真卡死的下载超过该窗自然允许清。
 */
export function clearNanoWeightsCache(dir = defaultTtsModelsDir()): { cleared: boolean; reason?: string } {
  const p = readNanoWeightsProgress(dir);
  if (p?.state === 'downloading') {
    const ageMs = Date.now() - new Date(p.updatedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs < 2 * 60_000) {
      return { cleared: false, reason: '下载进行中(2 分钟内有进度更新)— 等它完成或失败后再清理' };
    }
  }
  for (const repo of new Set(NANO_WEIGHT_FILES.map((w) => w.repo))) {
    rmSync(join(dir, repo), { recursive: true, force: true });
  }
  rmSync(join(dir, PROGRESS_FILE), { force: true });
  rmSync(join(dir, '.complete'), { force: true });
  return { cleared: true };
}

type GlobalWithWeights = typeof globalThis & {
  __ss_nanoWeightsPromise?: Promise<string> | null;
};

/**
 * 确保权重就绪 — 缺失/损坏的从 ModelScope 下载。
 * ⚠️ 六七深审 P1:进程内单例化下载 Promise — 两个 voice job 首次并发会各自进下载循环、
 *   写同一 `.part` 文件互相覆盖致损坏(有 await 交错,非单线程能避免)。globalThis Promise
 *   让并发调用复用同一次下载;失败清空允许重试。
 */
export async function ensureNanoModels(opts?: {
  dir?: string;
  onProgress?: (msg: string) => void;
}): Promise<string> {
  const dir = opts?.dir ?? defaultTtsModelsDir();
  if (nanoModelsReady(dir)) return dir; // 快路径:已就绪免进单例
  const g = globalThis as GlobalWithWeights;
  if (!g.__ss_nanoWeightsPromise) {
    g.__ss_nanoWeightsPromise = doEnsureNanoModels({ ...opts, dir }).catch((err) => {
      g.__ss_nanoWeightsPromise = null;
      throw err;
    });
  }
  return g.__ss_nanoWeightsPromise;
}

async function doEnsureNanoModels(opts: {
  dir: string;
  onProgress?: (msg: string) => void;
}): Promise<string> {
  const dir = opts.dir;
  const log = opts?.onProgress ?? ((m: string) => console.log(`[tts-weights] ${m}`));
  const missing = NANO_WEIGHT_FILES.filter((w) => !fileOk(join(dir, w.repo, w.file), w.minBytes));
  if (missing.length === 0) return dir;

  const totalMb = Math.round(missing.reduce((a, w) => a + w.minBytes, 0) / 1e6);
  log(`下载 MOSS-TTS-Nano 权重:${missing.length} 个文件(≥${totalMb}MB,ModelScope)→ ${dir}`);

  // 七二:进度落盘 — expectedBytes 起步用 minBytes 估,拿到 Content-Length 逐文件校准
  let doneBytes = 0;
  let expectedBytes = missing.reduce((a, w) => a + w.minBytes, 0);
  let lastWrite = 0;
  const progress = (over: Partial<NanoWeightsProgress>, force = false): void => {
    const now = Date.now();
    if (!force && now - lastWrite < 500) return; // 节流:大文件计数流别刷爆磁盘
    lastWrite = now;
    writeProgress(dir, {
      state: 'downloading',
      doneBytes,
      expectedBytes,
      updatedAt: new Date().toISOString(),
      ...over,
    });
  };

  try {
    for (let i = 0; i < missing.length; i++) {
      const w = missing[i]!;
      const destDir = join(dir, w.repo);
      mkdirSync(destDir, { recursive: true });
      const dest = join(destDir, w.file);
      const part = `${dest}.part`;
      const url = `${MODELSCOPE_BASE}/${w.repo}/resolve/master/${w.file}`;
      log(`↓ ${w.repo}/${w.file}`);
      progress({ currentFile: `${w.repo}/${w.file}`, fileIndex: i + 1, totalFiles: missing.length }, true);
      const res = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000), redirect: 'follow' });
      if (!res.ok || !res.body) {
        throw new Error(`权重下载失败 ${w.file}: HTTP ${res.status}(ModelScope)`);
      }
      // Content-Length 校准该文件的预计字节(minBytes 是下限,真实尺寸更大)
      const contentLen = Number(res.headers.get('content-length') ?? 0);
      if (contentLen > 0) expectedBytes += contentLen - w.minBytes;
      rmSync(part, { force: true });
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          doneBytes += chunk.length;
          progress({ currentFile: `${w.repo}/${w.file}`, fileIndex: i + 1, totalFiles: missing.length });
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(part));
      if (!fileOk(part, w.minBytes)) {
        rmSync(part, { force: true });
        throw new Error(`权重文件不完整 ${w.file}(下到的尺寸低于下限 ${w.minBytes}B)`);
      }
      renameSync(part, dest);
    }
  } catch (e) {
    writeProgress(dir, {
      state: 'error',
      doneBytes,
      expectedBytes,
      error: e instanceof Error ? e.message : String(e),
      updatedAt: new Date().toISOString(),
    });
    throw e;
  }
  if (!existsSync(join(dir, '.complete'))) {
    writeFileSync(join(dir, '.complete'), `MOSS-TTS-Nano weights · 来源 ModelScope/OpenMOSS\n`);
  }
  writeProgress(dir, { state: 'ready', doneBytes, expectedBytes, updatedAt: new Date().toISOString() });
  log('权重就绪 ✓');
  return dir;
}
