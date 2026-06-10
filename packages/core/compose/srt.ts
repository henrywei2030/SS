/**
 * SRT 字幕生成 — M1(蓝图:台词用剧本解析同款正则提取,时间按 ffprobe 实测时长累加)
 *
 * 时间轴规则:
 *   - 各段(group take)的真实时长由 ffprobe 实测,按时间线顺序累加得到段起点偏移
 *   - 段内台词行均分该段时长(v1 规则:无逐句对齐数据,均分是无偏的确定性近似)
 *   - 无台词的段不出 cue(画面照常,字幕空窗)
 * 全部纯函数,可单测。
 */

export interface SrtSegment {
  /** ffprobe 实测时长(秒) */
  durationS: number;
  /** 本段台词文本(已提取,按出现顺序) */
  lines: string[];
}

export interface SrtCue {
  startS: number;
  endS: number;
  text: string;
}

/** 段列表 → 带绝对时间的 cue 列表(段时长累加 + 段内均分) */
export function buildSrtCues(segments: SrtSegment[]): SrtCue[] {
  const cues: SrtCue[] = [];
  let offsetS = 0;
  for (const seg of segments) {
    const n = seg.lines.length;
    if (n > 0 && seg.durationS > 0) {
      const slot = seg.durationS / n;
      for (let i = 0; i < n; i++) {
        cues.push({
          startS: offsetS + i * slot,
          endS: offsetS + (i + 1) * slot,
          text: seg.lines[i]!,
        });
      }
    }
    offsetS += seg.durationS;
  }
  return cues;
}

/**
 * 把一个场的台词行按各组(同场内,按时间线顺序)的实测时长**比例连续切分**。
 * 背景:本库台词只存在于 Scene.content(场原文),镜头/组里没有逐句归属 —
 * 比例切分是确定性的无偏近似(累计取整防丢行/重行)。
 */
export function sliceLinesByDuration(lines: string[], durations: number[]): string[][] {
  const n = durations.length;
  if (n === 0) return [];
  const total = durations.reduce((a, b) => a + b, 0);
  if (lines.length === 0 || total <= 0) {
    return durations.map(() => []);
  }
  const out: string[][] = [];
  let assigned = 0;
  let cumDur = 0;
  for (let i = 0; i < n; i++) {
    cumDur += durations[i]!;
    const upto = i === n - 1 ? lines.length : Math.round((cumDur / total) * lines.length);
    out.push(lines.slice(assigned, Math.max(assigned, upto)));
    assigned = Math.max(assigned, upto);
  }
  return out;
}

/** 秒 → SRT 时间戳 HH:MM:SS,mmm */
export function formatSrtTime(totalS: number): string {
  const clamped = Math.max(0, totalS);
  const ms = Math.round((clamped % 1) * 1000);
  const s = Math.floor(clamped) % 60;
  const m = Math.floor(clamped / 60) % 60;
  const h = Math.floor(clamped / 3600);
  const pad = (v: number, w = 2): string => String(v).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/** cue 列表 → SRT 文本 */
export function formatSrt(cues: SrtCue[]): string {
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${formatSrtTime(c.startS)} --> ${formatSrtTime(c.endS)}\n${c.text}\n`,
    )
    .join('\n');
}
