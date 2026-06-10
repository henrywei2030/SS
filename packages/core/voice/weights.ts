/**
 * Nano 权重管理 — TTS-B(2026-06-10)
 *
 * 权重(~845MB)不入 git 不入安装包,**首次使用时从 ModelScope 下载**(国内直连快;
 * HF 被墙、hf-mirror 对这两个仓只会 308 回源 — 2026-06-10 实测)。
 * 目录:env `SS_TTS_MODELS_DIR` > `~/.starsalign/tts-models`(各机独立,桌面/服务器同路径策略)。
 * 完整性:逐文件存在 + 非 LFS 指针 + 尺寸下限;原子写(.part → rename);`.complete` 标记。
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
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

  for (const w of missing) {
    const destDir = join(dir, w.repo);
    mkdirSync(destDir, { recursive: true });
    const dest = join(destDir, w.file);
    const part = `${dest}.part`;
    const url = `${MODELSCOPE_BASE}/${w.repo}/resolve/master/${w.file}`;
    log(`↓ ${w.repo}/${w.file}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000), redirect: 'follow' });
    if (!res.ok || !res.body) {
      throw new Error(`权重下载失败 ${w.file}: HTTP ${res.status}(ModelScope)`);
    }
    rmSync(part, { force: true });
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
    if (!fileOk(part, w.minBytes)) {
      rmSync(part, { force: true });
      throw new Error(`权重文件不完整 ${w.file}(下到的尺寸低于下限 ${w.minBytes}B)`);
    }
    renameSync(part, dest);
  }
  if (!existsSync(join(dir, '.complete'))) {
    writeFileSync(join(dir, '.complete'), `MOSS-TTS-Nano weights · 来源 ModelScope/OpenMOSS\n`);
  }
  log('权重就绪 ✓');
  return dir;
}
