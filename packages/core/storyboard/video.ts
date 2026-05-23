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
 * 公式(5 段):
 *   positive =
 *     [项目风格]           ← StyleProfile.{character|scene|prop}Prompt 三段拼
 *   + [提示词正文]         ← input.text(由 W3 ShotGroup.prompt 而来,可能已含 @图片N 占位)
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
  /** Seedance 拿这个作 refImageUrls / refAudioUrls */
  mediaUrl: string;
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
    durationPart: string;
    extraPart: string;
  };
  warnings: {
    /** references 提供了,但 text 里没用 — UI 显示"图片N 已关联但未在提示词中引用" */
    unusedReferences: number[];
    /** text 里用了 @图片N / @音频N 但 references 没提供 — Seedance 会拿不到参考 */
    unknownTokens: string[];
  };
}

const DEFAULT_ASPECT_RATIO = '9:16';

// ---------------------------------------------------------------------------
// 自动 @(autoTagPromptWithReferences)
// ---------------------------------------------------------------------------

/**
 * 在 text 中找 binding 的 name / alias 首次出现位置,紧跟其后插入 @图片N(或 @音频N)token。
 *
 * 规则:
 *   - 已有 @图片N 紧随同一 binding 的 name 后 → 不重复插入
 *   - 没找到 name / alias → 该 binding 跳过(也会进 warnings,但本函数仅负责 text,不返 warnings)
 *   - 同 binding 在 text 中多次出现 → 只在第一次出现处插
 *   - 多 binding 共享同 name(罕见,如 "陆萌萌" 出现两次但绑两个不同变体)→ 第一个 binding 占第一处,第二个占第二处
 *
 * 不会动:
 *   - 已有但绑错了的 token(例 text 有 @图片5 但只有 4 个 binding)→ 留给 compile 报 warning
 *   - text 中的标点和换行 → 严格按字符位置插入
 */
export function autoTagPromptWithReferences(
  text: string,
  bindings: AutoTagBinding[],
): string {
  if (!text || bindings.length === 0) return text;

  // 同 binding 在 text 中可能出现多次,我们只插第一次 — 用 occurrenceCursor 跟踪每个 name 已用到第几次
  const occurrenceCursor: Map<string, number> = new Map();
  let result = text;

  for (const b of bindings) {
    const expectedToken = tokenFor(b.kind, b.refSlotIdx);
    const candidates = [b.name, ...(b.aliases ?? [])].filter(
      (s) => s && s.length > 0,
    );

    for (const cand of candidates) {
      const cursor = occurrenceCursor.get(cand) ?? 0;
      const insertPos = findNthOccurrenceEnd(result, cand, cursor + 1);
      if (insertPos < 0) continue;

      // 检查 insertPos 后是否已经紧跟 @图片N / @音频N — 已有则跳过
      const trailing = result.slice(insertPos, insertPos + 12);
      if (/^@(图片|音频)\d+/.test(trailing)) {
        occurrenceCursor.set(cand, cursor + 1);
        break; // 已标过,该 binding 完成
      }

      result =
        result.slice(0, insertPos) + expectedToken + result.slice(insertPos);
      occurrenceCursor.set(cand, cursor + 1);
      break; // 该 binding 标完,跳出 candidates 循环
    }
  }

  return result;
}

/** 找 needle 在 haystack 中第 n 次出现的"末尾索引"(用于在词后插 token);找不到返 -1 */
function findNthOccurrenceEnd(
  haystack: string,
  needle: string,
  n: number,
): number {
  if (!needle) return -1;
  let from = 0;
  for (let i = 0; i < n; i++) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) return -1;
    from = idx + needle.length;
  }
  return from;
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
  const durationPart = `【参数】时长 ${durationS}s · 宽高比 ${aspectRatio}`;
  const extraPart = (input.extraInstruction ?? '').trim();

  const positive = [stylePart, textPart, durationPart, extraPart]
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

  for (const r of input.references) {
    const key = `${r.kind}:${r.refSlotIdx}`;
    if (usedTokenKeys.has(key)) {
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
    parts: { stylePart, textPart, durationPart, extraPart },
    warnings: { unusedReferences, unknownTokens },
  };
}

// ---------------------------------------------------------------------------
// 内部 helper
// ---------------------------------------------------------------------------

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
 * 时长 clamp:防 0/负数 / 超过 10s 上限(Seedance 等单次生成硬限)。
 * 业务层应在调用前结合 SystemSetting.shot.video.maxDurationS 做更精确限制。
 */
function clampDuration(s: number): number {
  if (!Number.isFinite(s) || s <= 0) return 5;
  if (s > 10) return 10;
  return Math.round(s * 10) / 10;
}
