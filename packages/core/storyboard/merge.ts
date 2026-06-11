/**
 * 分镜「向下合并」算法
 *
 * 业务背景:
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
  // H0 捡漏(docs/07 §4.2):四维分镜的 movement/lighting/sound 此前从未进组 prompt 正文
  movement?: string;
  lighting?: string;
  sound?: string;
  content: string;
  prompt: string;
  positionIdx: number;
  /** 所属场景 id(剧本场号对应的 Scene)— requireSameScene 时作严格场景边界 */
  sceneId?: string | null;
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
  /** 合并时是否要求场景一致（通过 refAssetIds 重叠 — 松散启发式） */
  requireSceneContinuity?: boolean;
  /**
   * 仅合并同一场景(sceneId 相同)的相邻镜头 — 跨场景强制开新组。
   * 严格场景边界,区别于 requireSceneContinuity 的资产重叠启发式。
   * (2026-06 用户需求:自动整合只在同场景内合并)
   */
  requireSameScene?: boolean;
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
 *   4. requireSameScene 时，sceneId 不同强制开新组（严格场景边界）
 *   5. isolateSPriority 时，S 级强制单独成组
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
  let currentSceneId: string | null = null;

  function flush(): void {
    if (current.length === 0) return;
    groups.push(buildGroup(current));
    current = [];
    currentDuration = 0;
    currentAssets = new Set();
    currentSceneId = null;
  }

  for (const shot of sorted) {
    const shotAssets = new Set(shot.refAssetIds ?? []);
    const shotSceneId = shot.sceneId ?? null;

    // 单 shot 自己就超长 — 算法只能让它独立成组并发出告警，由调用方决定是否拆镜
    if (shot.durationS > maxD) {
      console.warn(
        `[mergeShots] shot ${shot.number} duration ${shot.durationS}s exceeds maxDurationS ${maxD}s — isolated as oversized group`,
      );
    }

    // 触发 flush 的条件
    const isolatedS = opts.isolateSPriority && shot.priority === 'S';
    const tooLong = currentDuration + shot.durationS > maxD;
    const sceneBreak =
      opts.requireSceneContinuity &&
      current.length > 0 &&
      !hasOverlap(currentAssets, shotAssets);
    // 用户规则(2026-06):仅同一场景(sceneId 相同)的相邻镜头可合并,跨场景强制开新组
    const sceneChange =
      opts.requireSameScene && current.length > 0 && shotSceneId !== currentSceneId;

    if (isolatedS) {
      flush();
      groups.push(buildGroup([shot]));
      continue;
    }

    if (tooLong || sceneBreak || sceneChange) {
      flush();
    }

    if (current.length === 0) currentSceneId = shotSceneId;
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

/**
 * 组内单镜默认拼接行(H0 捡漏,docs/07 §4.2)— mergeShots 路由与 autoMerge 共用的单一真相源。
 *
 * 格式:`[1/3] {prompt}(音效:{sound})`
 *
 * 七二·提示词去重(用户反馈"自动生成的提示词有重复"):**不再把
 * framing/angle/movement/lighting/durationS 拼成标题标签**。原因 —
 * LLM 生成的 prompt 正文本身已含景别/机位/运镜的自然语言描述(典型:
 * "全景平视固定镜头,…"),再前置同源维度标签("全景 平视 0°")与正文字面重复;
 * 且编译期【时间轴】段(compileTimelinePart)已从 Shot 表结构化承载维度+时间边界(等于第三份)。
 * 维度信息交给正文(可读)+ 时间轴段(结构化),此处只保留:
 *   - `[i/N]` 镜号(人类可读的组内镜头边界,显示约定 — 手编/AI 优化可破坏)
 *   - prompt 正文
 *   - sound 音效(正文通常不含,行尾括注)
 */
export function buildGroupShotLine(
  s: Pick<MergeableShot, 'sound' | 'prompt'>,
  i: number,
  total: number,
): string {
  const sound = (s.sound ?? '').trim();
  return `[${i + 1}/${total}] ${s.prompt}${sound ? `(音效:${sound})` : ''}`;
}

function mergePrompts(shots: MergeableShot[]): string {
  // 需求(2026-06):段落之间不要 `---` 分隔符;r3:标题+prompt 同一行,段间 \n 隔开
  //(原是 header\nprompt + 空行分段,与 mergeShots 路由的 r3 格式不一致 — H0 统一为共享行构造)
  return shots.map((s, i) => buildGroupShotLine(s, i, shots.length)).join('\n');
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
