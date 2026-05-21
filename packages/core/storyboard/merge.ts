/**
 * 分镜「向下合并」算法
 *
 * 业务背景（杨帆原系统）：
 *   - 视频模型一次能生成 ~10 秒（Seedance）/ ~18 秒（Runway）等
 *   - 单一镜头可能很短（特写 1-2 秒）
 *   - "向下合并" = 把相邻短镜头合并成一段送给视频模型
 *
 * 关键决策：
 *   - 合并阈值 = 当前 Provider 的 maxDuration（动态而非硬编码 15s）
 *   - 同一场景 + 同一组人物时优先合并
 *   - 合并后保留原始镜号链路（mergedFrom）以便回溯
 */

export interface MergeableShot {
  id: string;
  number: string;
  durationS: number;
  framing?: string;
  angle?: string;
  content: string;
  prompt: string;
  positionIdx: number;
  /** 镜头中出现的人物 / 场景 ID（用于合并判断） */
  refAssetIds?: string[];
  /** 优先级 — 同一组里若有 S 级，提示加重 */
  priority?: 'S' | 'A' | 'B' | 'C';
}

export interface MergeResult {
  /** 合并后的镜头单元（保留原始镜号链） */
  groups: MergedShotGroup[];
}

export interface MergedShotGroup {
  number: string;          // 如 "1-8" / "1-8a"
  durationS: number;       // 合并后总时长
  shots: MergeableShot[];  // 原始构成
  refAssetIds: string[];   // 合并集
  mergedPrompt: string;    // 拼接 prompt
  highestPriority?: 'S' | 'A' | 'B' | 'C';
}

export interface MergeOptions {
  /** 视频 Provider 的最大单次生成时长（秒） */
  maxDurationS: number;
  /** 合并时是否要求场景一致（通过 refAssetIds 重叠） */
  requireSceneContinuity?: boolean;
  /** S 级镜头是否禁止合并（保留单独抽卡） */
  isolateSPriority?: boolean;
}

/**
 * 向下合并：从第一个镜头开始，逐个尝试合并下一个镜头
 *
 * 算法：
 *   1. 按 positionIdx 排序
 *   2. 累积时长，未超过 maxDurationS 就继续合并
 *   3. requireSceneContinuity 时，refAssetIds 必须有交集
 *   4. isolateSPriority 时，S 级强制单独成组
 */
export function mergeShots(
  shots: MergeableShot[],
  opts: MergeOptions,
): MergeResult {
  const maxD = opts.maxDurationS;
  if (maxD <= 0) throw new Error('maxDurationS must be positive');

  const sorted = [...shots].sort((a, b) => a.positionIdx - b.positionIdx);
  const groups: MergedShotGroup[] = [];
  let current: MergeableShot[] = [];
  let currentDuration = 0;
  let currentAssets = new Set<string>();

  function flush(): void {
    if (current.length === 0) return;
    groups.push(buildGroup(current));
    current = [];
    currentDuration = 0;
    currentAssets = new Set();
  }

  for (const shot of sorted) {
    const shotAssets = new Set(shot.refAssetIds ?? []);

    // 触发 flush 的条件
    const isolatedS = opts.isolateSPriority && shot.priority === 'S';
    const tooLong = currentDuration + shot.durationS > maxD;
    const sceneBreak =
      opts.requireSceneContinuity &&
      current.length > 0 &&
      !hasOverlap(currentAssets, shotAssets);

    if (isolatedS) {
      flush();
      groups.push(buildGroup([shot]));
      continue;
    }

    if (tooLong || sceneBreak) {
      flush();
    }

    current.push(shot);
    currentDuration += shot.durationS;
    shotAssets.forEach((a) => currentAssets.add(a));
  }

  flush();
  return { groups };
}

function buildGroup(shots: MergeableShot[]): MergedShotGroup {
  const durationS = shots.reduce((sum, s) => sum + s.durationS, 0);
  const refAssetIds = unique(shots.flatMap((s) => s.refAssetIds ?? []));
  const number =
    shots.length === 1
      ? (shots[0]?.number ?? '0')
      : buildMergedNumber(shots);
  const mergedPrompt = mergePrompts(shots);
  const highestPriority = pickHighestPriority(shots);
  return { number, durationS, shots, refAssetIds, mergedPrompt, highestPriority };
}

function buildMergedNumber(shots: MergeableShot[]): string {
  const first = shots[0]?.number ?? '0';
  const last = shots[shots.length - 1]?.number ?? '0';
  if (first === last) return first;
  const fNum = extractFirst(first);
  const lNum = extractLast(last);
  return `${fNum}-${lNum}`;
}

function extractFirst(num: string): string {
  // "1-8" → "1"
  return num.split('-')[0] ?? num;
}

function extractLast(num: string): string {
  // "9-18" → "18"
  const parts = num.split('-');
  return parts[parts.length - 1] ?? num;
}

function mergePrompts(shots: MergeableShot[]): string {
  return shots
    .map((s, i) => {
      const header = `[${i + 1}/${shots.length}] ${s.framing ?? ''} ${s.angle ?? ''}`.trim();
      return `${header}\n${s.prompt}`;
    })
    .join('\n\n---\n\n');
}

function hasOverlap(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return true; // 无信息 = 不阻塞
  for (const x of a) if (b.has(x)) return true;
  return false;
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function pickHighestPriority(
  shots: MergeableShot[],
): 'S' | 'A' | 'B' | 'C' | undefined {
  const order: Array<'S' | 'A' | 'B' | 'C'> = ['S', 'A', 'B', 'C'];
  for (const p of order) {
    if (shots.some((s) => s.priority === p)) return p;
  }
  return undefined;
}
