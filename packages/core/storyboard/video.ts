/**
 * 镜头视频 prompt 编译器(W5.1 — token 化重写)
 *
 * 范式变更:W5.0 时拼描述性文本(`【角色】陆乘:男主,30岁,西装`),
 * W5.1 改成 token 模式 — 提示词文本里嵌 `@图片N` / `@音频N` 占位,
 * compile 同时输出 references[] 把 token 解析到 mediaUrl,供 Seedance 取参考图/音频。
 *
 * 上下文:AIGC 生成段(ShotGroup)级 binding,每个 binding 有 refSlotIdx 在 group 内稳定编号:
 *   - 场景 1 张 → 图片1
 *   - 人物 3 张 → 图片2/3/4
 *   - 声音 2 条 → 音频1/2
 * 视频提示词写 `陆萌萌@图片2 (颤抖声音):...`,送 Seedance 时 prompt 文本带 token,
 * references = [{ idx:2, mediaUrl: 'https://.../陆萌萌-portrait.png' }, ...]
 *
 * 公式(7+1 段,H0 docs/07 增【时间轴】【画质/稳定】):
 *   positive =
 *     [项目风格]           ← StyleProfile.{character|scene|prop}Prompt 三段拼
 *   + [提示词正文]         ← input.text(由 W3 ShotGroup.prompt 而来,可能已含 @图片N 占位)
 *   + [时间轴](可选)      ← H0:从 Shot 表 durationS 累加生成结构段(正文零接触,
 *                            默认拼接/手编/AI 优化三态统一生效 — docs/07 §4.1)
 *   + [声线](可选)        ← 六八:绑定人物的声音设定描述(generateAudio=true 时由调用方传入,
 *                            引导 seedance 等同出音频的模型贴角色音色)
 *   + [画质/稳定](可选)   ← H0:强化词段(八要素 #7/#8,SystemSetting 可改,留空关闭)
 *   + [时长+比例]          ← "时长 {S}s · 宽高比 {AR}"
 *   + [额外指令]
 *   negative = StyleProfile.forbiddenWords ∪ extraNegative
 *
 * 设计原则:
 *   - 纯函数,无 LLM / DB I/O,可单测和 UI 实时预览
 *   - aspectRatio / durationS 单独输出作 Provider 非 prompt 参数
 *   - autoTagPromptWithReferences 是另一个纯函数,负责"自动 @"按钮的逻辑
 *   - kind(IMAGE/AUDIO)由 usageType 派生,不存独立字段
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type ReferenceKind = 'IMAGE' | 'AUDIO';

/** AssetUsageType 的"音频"子集 — 这些 binding 在 UI 显示为"音频N",其他为"图片N" */
const AUDIO_USAGE_TYPES = new Set(['SOUND_BG', 'SOUND_VOICE', 'THEME']);

export function isAudioUsage(usageType: string): boolean {
  return AUDIO_USAGE_TYPES.has(usageType);
}

export function kindFromUsage(usageType: string): ReferenceKind {
  return isAudioUsage(usageType) ? 'AUDIO' : 'IMAGE';
}

/** 输出 token 字符串 — UI 显示 + 提示词文本嵌入用 */
export function tokenFor(kind: ReferenceKind, refSlotIdx: number): string {
  return `${kind === 'AUDIO' ? '@音频' : '@图片'}${refSlotIdx}`;
}

/** auto-tag 输入 — 只需要识别身份的最小字段集 */
export interface AutoTagBinding {
  refSlotIdx: number;
  kind: ReferenceKind;
  name: string;
  aliases?: string[];
}

/** compile 输入 — 包含 mediaUrl 等送 Seedance 用的字段 */
export interface VideoReference {
  refSlotIdx: number;
  kind: ReferenceKind;
  assetId: string;
  name: string;
  /**
   * Seedance 拿这个作 refImageUrls / refAudioUrls。
   * null 表示 binding 在但主图缺失(资产没有 portraitMediaId / sceneMainMediaId 等)—
   * compile 时会进 warnings.missingMedia,UI 提示用户去美术工作台补图,且不送给 Seedance。
   */
  mediaUrl: string | null;
  /**
   * 七二 ⑤-2:binding.required 透传(schema 语义「必须调用 / 可缺」)。
   * 可缺(false)的引用缺图时只记 unusedReferences 提示,不进 missingMedia 硬拦 —
   * 典型:尾帧自动链入的参考图在未配 relay 资产通道的机器上无可达 URL,不应拦死整组生成。
   * 缺省 true(向后兼容:旧调用方不传 = 原有硬拦语义)。
   */
  required?: boolean;
}

export interface CompileShotGroupVideoPromptInput {
  /**
   * 提示词正文(来自 W3 ShotGroup.prompt,可能已经被 autoTagPromptWithReferences 加过 @图片N token,
   * 也可能是用户手编的纯文本)。compile 不再注入资产描述 — 文本本身就是中心。
   */
  text: string;
  /** 生成段时长(秒) */
  durationS: number;
  /** 该生成段绑定的资产引用,**已按 refSlotIdx 升序排列** */
  references: VideoReference[];
  /** 项目风格 — 三段都读,跟 W4 compileAssetPrompt 对齐 */
  style?: {
    characterPrompt?: string | null;
    scenePrompt?: string | null;
    propPrompt?: string | null;
    forbiddenWords?: string[] | null;
  } | null;
  /** 宽高比(默认 '9:16' 短剧竖屏)*/
  aspectRatio?: string;
  /** 额外指令(用户在抽卡面板的"额外要求") */
  extraInstruction?: string;
  /** 额外负面提示词 */
  extraNegative?: string[];
  /**
   * 六八:绑定人物的声音设定描述(name + profileJson.voiceLabel)。
   * 仅 generateAudio=true 时由调用方传入(无声生成塞声线描述是浪费 token);
   * 空数组/undefined 时 positive 不出现【声线】段,完全向后兼容。
   */
  voiceDescriptions?: Array<{ name: string; desc: string }>;
  /**
   * H0(docs/07 §4.1):组内逐镜结构数据,**按 positionIdx 升序**(调用方从 Shot 表读)。
   * 提供时输出【时间轴】段 — durationS 累加生成边界(`0-3s 全景·固定 | 3-7s …`),
   * prompt 正文零接触;总时长与 durationS 不一致时按比例缩放保持叙事节奏。
   * undefined / 空数组 = 不输出(向后兼容);单镜且无任何维度信息也省略(纯噪音)。
   */
  timelineShots?: TimelineShotInput[];
  /**
   * H0:强化词(八要素 #7 画质 / #8 约束-稳定)。调用方从 SystemSetting
   * `prompt.enhancer.quality` / `prompt.enhancer.stability` 解析后传入;
   * 空串/undefined = 对应行关闭,整体不出现该段则完全向后兼容。
   */
  enhancers?: { quality?: string | null; stability?: string | null };
}

/** H0:时间轴段的单镜输入(Shot 表字段子集) */
export interface TimelineShotInput {
  durationS: number;
  framing?: string | null;
  angle?: string | null;
  movement?: string | null;
  lighting?: string | null;
}

export interface CompiledShotGroupVideoPrompt {
  positive: string;
  negative: string;
  /**
   * 解析后的引用清单 — 送 Seedance 时按 kind 分发到 refImageUrls / refAudioUrls。
   * 注意:只包含 references 输入里**确实在 text 中被引用**(出现 @图片N token)的项,
   * 未被引用的 reference 会进 warnings.unusedReferences。
   */
  references: Array<{
    refSlotIdx: number;
    token: string;
    kind: ReferenceKind;
    assetId: string;
    mediaUrl: string;
  }>;
  aspectRatio: string;
  durationS: number;
  parts: {
    stylePart: string;
    textPart: string;
    /** H0:【时间轴】结构段(无 timelineShots 输入时为 '') */
    timelinePart: string;
    voicePart: string;
    /** H0:【画质】/【稳定】强化词段(两行都关时为 '') */
    enhancerPart: string;
    durationPart: string;
    extraPart: string;
  };
  warnings: {
    /** references 提供了,但 text 里没用 — UI 显示"图片N 已关联但未在提示词中引用" */
    unusedReferences: number[];
    /** text 里用了 @图片N / @音频N 但 references 没提供 — Seedance 会拿不到参考 */
    unknownTokens: string[];
    /** binding 在但主图缺失(W5 audit W1)— refSlotIdx 列表,UI 提示"图片N 缺主图,去美术工作台补" */
    missingMedia: Array<{ refSlotIdx: number; kind: ReferenceKind; assetName: string }>;
  };
}

const DEFAULT_ASPECT_RATIO = '9:16';

// ---------------------------------------------------------------------------
// 自动 @(autoTagPromptWithReferences)
// ---------------------------------------------------------------------------

/**
 * 在 text 中找 binding 的 name / alias **每一次出现位置**,紧跟其后插入 @图片N / @音频N token。
 *
 * 规则(W5 audit T1 修):
 *   - 标**所有**出现(产品截图证实:同一段提示词里 "陆萌萌@图片2" 重复多次)
 *   - 已有正确 token 紧跟某次 name 出现 → 该次跳过(已标)
 *   - 已有错 token(例 text 有 @图片5 但本 binding 是 #2)→ 不动 text,留给 compile 报 warning
 *   - 找不到 name / alias 任一处 → 该 binding 静默跳过(compile 时会进 unusedReferences)
 *
 * 多 binding 共享同 name(罕见,变体场景):
 *   - 第一个 binding 标全部出现 → 第二个 binding 来时所有 name 后已有 token → 跳过
 *   - 这是设计妥协:同名变体只能用 alias 区分或人工手编
 */
export function autoTagPromptWithReferences(
  text: string,
  bindings: AutoTagBinding[],
): string {
  if (!text || bindings.length === 0) return text;
  let result = text;

  for (const b of bindings) {
    const token = tokenFor(b.kind, b.refSlotIdx);
    const candidates = [b.name, ...(b.aliases ?? [])].filter(
      (s) => s && s.length > 0,
    );

    for (const cand of candidates) {
      result = tagAllOccurrences(result, cand, token);
    }
  }

  return result;
}

/**
 * 在 haystack 中找 needle 的所有出现,每处紧跟其后插 token。
 * 已紧跟 @图片N / @音频N 的 occurrence 跳过(避免重复 + 不覆盖手编)。
 */
function tagAllOccurrences(
  haystack: string,
  needle: string,
  token: string,
): string {
  if (!needle) return haystack;
  let from = 0;
  let result = haystack;
  while (from <= result.length) {
    const idx = result.indexOf(needle, from);
    if (idx < 0) break;
    const insertPos = idx + needle.length;
    const trailing = result.slice(insertPos, insertPos + 12);
    const existing = trailing.match(/^@(图片|音频)\d+/);
    if (existing) {
      // 已标(可能是本 binding 或其他 binding),跳过
      from = insertPos + existing[0].length;
      continue;
    }
    result = result.slice(0, insertPos) + token + result.slice(insertPos);
    from = insertPos + token.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// compileShotGroupVideoPrompt
// ---------------------------------------------------------------------------

/**
 * 编译 ShotGroup 级视频提示词。
 *
 * 输入的 text 视为权威 prompt 正文(可能由 LLM 生成 + 用户手工编辑 + autoTag 自动加 token)。
 * compile 不修改 text 的语义,只:
 *   - 前置项目风格段
 *   - 后置时长 + 宽高比 + 额外指令
 *   - 扫描 text 中所有 @图片N / @音频N token 与 references 做对齐校验
 *   - 输出 references 清单(只含真正被引用的)给 Seedance
 */
export function compileShotGroupVideoPrompt(
  input: CompileShotGroupVideoPromptInput,
): CompiledShotGroupVideoPrompt {
  const aspectRatio =
    (input.aspectRatio ?? '').trim() || DEFAULT_ASPECT_RATIO;
  const durationS = clampDuration(input.durationS);
  const stylePart = compileStylePart(input.style);
  const textPart = input.text.trim();
  const timelinePart = compileTimelinePart(input.timelineShots, durationS);
  const voicePart = compileVoicePart(input.voiceDescriptions);
  const enhancerPart = compileEnhancerPart(input.enhancers);
  const durationPart = `【参数】时长 ${durationS}s · 宽高比 ${aspectRatio}`;
  const extraPart = (input.extraInstruction ?? '').trim();

  const positive = [stylePart, textPart, timelinePart, voicePart, enhancerPart, durationPart, extraPart]
    .filter((s): s is string => Boolean(s && s.length > 0))
    .join('\n');

  const negative = compileNegative(
    input.style?.forbiddenWords ?? null,
    input.extraNegative ?? null,
  );

  // ----- references 对齐 -----
  // 1. 扫 text 里所有 @图片N / @音频N → 收集 tokens
  // 2. 比对 input.references → 真正被引用的 → 输出 references[]
  // 3. unused = references 有但 text 没引用
  // 4. unknown = text 引用了但 references 没提供
  const tokenRegex = /@(图片|音频)(\d+)/g;
  const usedTokenKeys = new Set<string>(); // "IMAGE:2" / "AUDIO:1"
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(textPart)) !== null) {
    const kind: ReferenceKind = match[1] === '图片' ? 'IMAGE' : 'AUDIO';
    const idx = Number(match[2]);
    if (Number.isInteger(idx) && idx > 0) {
      usedTokenKeys.add(`${kind}:${idx}`);
    }
  }

  const refMap = new Map<string, VideoReference>();
  for (const r of input.references) {
    refMap.set(`${r.kind}:${r.refSlotIdx}`, r);
  }

  const outRefs: CompiledShotGroupVideoPrompt['references'] = [];
  const unusedReferences: number[] = [];
  const unknownTokens: string[] = [];
  const missingMedia: CompiledShotGroupVideoPrompt['warnings']['missingMedia'] = [];

  for (const r of input.references) {
    const key = `${r.kind}:${r.refSlotIdx}`;
    const isUsed = usedTokenKeys.has(key);

    // W5 audit W1:mediaUrl 缺失先报 missingMedia,无论是否被 text 引用
    // 七二 ⑤-2:required=false(可缺)的引用缺图只记 unused 提示,不硬拦(见 VideoReference.required)
    if (!r.mediaUrl) {
      if (r.required !== false) {
        missingMedia.push({
          refSlotIdx: r.refSlotIdx,
          kind: r.kind,
          assetName: r.name,
        });
      }
      // 同时,如果 text 没引用,也算 unused;但缺图本身是更严重的问题,优先标 missingMedia
      if (!isUsed) unusedReferences.push(r.refSlotIdx);
      continue;
    }

    if (isUsed) {
      outRefs.push({
        refSlotIdx: r.refSlotIdx,
        token: tokenFor(r.kind, r.refSlotIdx),
        kind: r.kind,
        assetId: r.assetId,
        mediaUrl: r.mediaUrl,
      });
    } else {
      unusedReferences.push(r.refSlotIdx);
    }
  }

  for (const key of usedTokenKeys) {
    if (!refMap.has(key)) {
      const [kindStr, idxStr] = key.split(':');
      const kind = kindStr as ReferenceKind;
      unknownTokens.push(tokenFor(kind, Number(idxStr)));
    }
  }

  // outRefs 按 refSlotIdx 升序,UI 友好
  outRefs.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'IMAGE' ? -1 : 1;
    return a.refSlotIdx - b.refSlotIdx;
  });

  return {
    positive,
    negative,
    references: outRefs,
    aspectRatio,
    durationS,
    parts: { stylePart, textPart, timelinePart, voicePart, enhancerPart, durationPart, extraPart },
    warnings: { unusedReferences, unknownTokens, missingMedia },
  };
}

// ---------------------------------------------------------------------------
// 内部 helper
// ---------------------------------------------------------------------------

/**
 * H0(docs/07 §4.1):【时间轴】结构段 — 八要素文章"最大金矿":每镜 durationS 数据全有,
 * 此前从未送进 prompt。从 Shot 表数据生成,不解析正文(`[i/N]` 只是显示约定,手编 /
 * promptOverride / AI 优化都会破坏它 — 结构段对三态统一生效)。
 *
 * 输出:`【时间轴】0-3s 全景·俯视30°·固定·低调侧光 | 3-7s 中景·跟 | 7-9s 特写`
 *   - 边界由 durationS 累加;目标总长(抽卡面板可覆盖)≠ 镜表总和时按比例缩放,保持节奏
 *   - 末段边界强制对齐目标总长(防浮点漂移出 14.9s 之类)
 *   - 维度标签 = framing/angle/movement/lighting 非空项 '·' 连接;全空镜回退 `镜N`
 *   - sound 不进时间轴(自由文本过长,已由默认拼接行/优化器 shot contributor 承载)
 */
function compileTimelinePart(
  shots: TimelineShotInput[] | undefined,
  targetDurationS: number,
): string {
  if (!shots || shots.length === 0) return '';
  const durations = shots.map((s) =>
    Number.isFinite(s.durationS) && s.durationS > 0 ? s.durationS : 0,
  );
  const total = durations.reduce((a, b) => a + b, 0);
  if (total <= 0) return '';
  const dimsOf = (s: TimelineShotInput): string[] =>
    [s.framing, s.angle, s.movement, s.lighting]
      .map((v) => (v ?? '').trim())
      .filter((v) => v.length > 0);
  // 单镜且无任何维度信息:时间轴只剩 "0-5s 镜1",纯噪音 → 省略
  if (shots.length === 1 && dimsOf(shots[0]!).length === 0) return '';

  const factor = targetDurationS / total;
  const segs: string[] = [];
  let cursor = 0;
  for (let i = 0; i < shots.length; i++) {
    const start = cursor;
    cursor += durations[i]! * factor;
    const end = i === shots.length - 1 ? targetDurationS : cursor;
    const label = dimsOf(shots[i]!).join('·') || `镜${i + 1}`;
    segs.push(`${fmtTimelineS(start)}-${fmtTimelineS(end)}s ${label}`);
  }
  return `【时间轴】${segs.join(' | ')}`;
}

/** 时间轴边界格式化:保留 1 位小数,整数不带小数点(3 → "3",3.33 → "3.3") */
function fmtTimelineS(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/**
 * H0:【画质】/【稳定】强化词段(八要素 #7/#8,文章"质量保险丝":省掉 ≈ 10 条 7 返工)。
 * 值由调用方从 SystemSetting 解析(默认=文章模板,用户清空 = 显式关闭该行)。
 */
function compileEnhancerPart(
  enhancers: CompileShotGroupVideoPromptInput['enhancers'],
): string {
  if (!enhancers) return '';
  const quality = (enhancers.quality ?? '').trim();
  const stability = (enhancers.stability ?? '').trim();
  const lines: string[] = [];
  if (quality) lines.push(`【画质】${quality}`);
  if (stability) lines.push(`【稳定】${stability}`);
  return lines.join('\n');
}

/** 六八:【声线】段 — `林小满:低沉沙哑 · 阿野:清脆少年音`(空描述项过滤) */
function compileVoicePart(
  voiceDescriptions: CompileShotGroupVideoPromptInput['voiceDescriptions'],
): string {
  if (!voiceDescriptions || voiceDescriptions.length === 0) return '';
  const items = voiceDescriptions
    .map((v) => ({ name: v.name.trim(), desc: v.desc.trim() }))
    .filter((v) => v.name.length > 0 && v.desc.length > 0)
    .map((v) => `${v.name}:${v.desc}`);
  if (items.length === 0) return '';
  return `【声线】${items.join(' · ')}`;
}

function compileStylePart(
  style: CompileShotGroupVideoPromptInput['style'],
): string {
  if (!style) return '';
  const parts = [
    (style.characterPrompt ?? '').trim(),
    (style.scenePrompt ?? '').trim(),
    (style.propPrompt ?? '').trim(),
  ].filter((s) => s.length > 0);
  if (parts.length === 0) return '';
  return `【风格】${parts.join(' · ')}`;
}

function compileNegative(
  forbidden: string[] | null,
  extra: string[] | null,
): string {
  const parts: string[] = [];
  if (forbidden && forbidden.length > 0) {
    parts.push(...forbidden.map((s) => s.trim()).filter((s) => s.length > 0));
  }
  if (extra && extra.length > 0) {
    parts.push(...extra.map((s) => s.trim()).filter((s) => s.length > 0));
  }
  if (parts.length === 0) return '';
  return Array.from(new Set(parts)).join('、');
}

/**
 * 时长 clamp:防 0/负数 / 超过 15s 上限(2026-05-27 业务调到 15s)。
 * 业务层应在调用前结合 SystemSetting.shot.video.maxDurationS 做更精确限制。
 */
function clampDuration(s: number): number {
  if (!Number.isFinite(s) || s <= 0) return 5;
  if (s > 15) return 15;
  return Math.round(s * 10) / 10;
}
