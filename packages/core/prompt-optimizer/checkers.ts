/**
 * H2(docs/07 §2 Checkers):硬门 — 确定性检查,一票否决(区别于判官软门 advisory)。
 *
 * 五门:@token 保全 / 时长加总 / 禁用词 / 抽象词黑名单 / 长度。
 * 纯函数,单测覆盖;违规项全部收集(不短路)— Repair 一轮能拿到完整修复清单。
 *
 * 设计取舍:
 *   - 时长加总:仅当正文带 ≥2 个 `[i/N] … Ns` 显式时长标记时才校验(H0 默认拼接的格式),
 *     无标记 = 不管(时间轴真相在编译期 timelinePart,正文标记只是显示约定)。容差 ±30%。
 *   - 抽象词黑名单:默认只收"纯偷懒短语"(激烈打斗/画面精美…),可经
 *     SystemSetting `prompt.harness.abstractBlacklist` 调 — 误杀面宁小勿大,
 *     真正的抽象词翻译靠判官软门 + ACTION 维知识条目。
 *   - 禁用词:与 style contributor 给 Composer 的指令同口径("正文不得出现"),
 *     负面词的正确位置是 negative(编译期合并),正文出现即违规。
 */
import { findLostTokens } from './guards.js';

export type HardGateCode = 'TOKEN' | 'DURATION' | 'FORBIDDEN' | 'ABSTRACT' | 'LENGTH';

export interface HardGateViolation {
  gate: HardGateCode;
  message: string;
}

export interface HardGateInput {
  /** 优化前原文(@token 真相源) */
  original: string;
  /** 待检文本(Composer / Repair 输出) */
  candidate: string;
  /** 组时长(时长加总门的基准) */
  groupDurationS: number;
  /** 项目风格禁用词(正文不得出现) */
  forbiddenWords: string[];
  /** 抽象词黑名单(CSV 解析后) */
  abstractBlacklist: string[];
  /** 正文长度上限(字符),默认 5000 */
  maxChars?: number;
}

/** 默认抽象词黑名单(与 seed.ts prompt.harness.abstractBlacklist 默认值一致,双写) */
export const DEFAULT_ABSTRACT_BLACKLIST = [
  '激烈打斗',
  '画面精美',
  '美轮美奂',
  '非常震撼',
  '精彩绝伦',
] as const;

const MIN_CHARS = 20;
const DEFAULT_MAX_CHARS = 5000;
/** 时长加总容差(±30% — 正文标记是显示值,允许 LLM 微调节奏) */
const DURATION_TOLERANCE = 0.3;

export function runHardGates(input: HardGateInput): HardGateViolation[] {
  const violations: HardGateViolation[] = [];
  const text = input.candidate.trim();

  // 1) 长度(过短=输出残缺;过长=撑爆下游)
  if (text.length < MIN_CHARS) {
    violations.push({ gate: 'LENGTH', message: `正文过短(${text.length} 字 < ${MIN_CHARS})` });
  }
  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
  if (text.length > maxChars) {
    violations.push({ gate: 'LENGTH', message: `正文过长(${text.length} 字 > ${maxChars})` });
  }

  // 2) @token 保全(复用 M6 守卫 — 丢一即违规)
  const lost = findLostTokens(input.original, text);
  if (lost.length > 0) {
    violations.push({ gate: 'TOKEN', message: `丢失引用 token:${lost.join('、')}` });
  }

  // 3) 时长加总(仅显式标记 ≥2 时)
  const durations = extractShotLineDurations(text);
  if (durations.length >= 2 && input.groupDurationS > 0) {
    const sum = durations.reduce((a, b) => a + b, 0);
    const deviation = Math.abs(sum - input.groupDurationS) / input.groupDurationS;
    if (deviation > DURATION_TOLERANCE) {
      violations.push({
        gate: 'DURATION',
        message: `正文逐镜时长合计 ${sum}s 与组时长 ${input.groupDurationS}s 偏差超 ±30% — 删掉时长标记或改回合理值`,
      });
    }
  }

  // 4) 禁用词(项目风格 forbiddenWords,正文不得出现)
  for (const w of input.forbiddenWords) {
    const word = w.trim();
    if (word && text.includes(word)) {
      violations.push({ gate: 'FORBIDDEN', message: `正文含项目禁用词「${word}」` });
    }
  }

  // 5) 抽象词黑名单(偷懒短语)
  for (const p of input.abstractBlacklist) {
    const phrase = p.trim();
    if (phrase && text.includes(phrase)) {
      violations.push({
        gate: 'ABSTRACT',
        message: `正文含抽象偷懒短语「${phrase}」— 翻译成具体可拍的画面动作`,
      });
    }
  }

  return violations;
}

/**
 * 提取 `[i/N] … Ns ` 行首格式的逐镜时长(H0 默认拼接格式)。
 * 只认行内 [i/N] 头后面出现的首个 `Ns` 标记,避免把正文里的"3秒后"误读。
 */
export function extractShotLineDurations(text: string): number[] {
  const out: number[] = [];
  const lineRe = /\[\d+\/\d+\][^\n]*/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(text)) !== null) {
    const dur = /(?:^|\s)(\d+(?:\.\d+)?)s(?:\s|$|[,，。)）])/.exec(m[0]);
    if (dur) out.push(Number(dur[1]));
  }
  return out;
}

/** SystemSetting CSV → 黑名单数组(空/缺省回默认;显式 'off' 关闭该门) */
export function parseAbstractBlacklist(raw: string | null | undefined): string[] {
  const v = (raw ?? '').trim();
  if (v.toLowerCase() === 'off') return [];
  const parsed = v
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parsed.length > 0 ? parsed : [...DEFAULT_ABSTRACT_BLACKLIST];
}
