/**
 * 镜头视频 prompt 编译器(W5.0)
 *
 * 把"分镜表里的 shot + 引用资产"拼成"送视频 Provider(Seedance 等)的完整 prompt"。
 *
 * 公式(9 段,顺序固定):
 *   最终 positive prompt =
 *     [项目风格]           ← StyleProfile.characterPrompt + scenePrompt
 *   + [角色视觉]           ← 引用 Asset(CHARACTER)的 description+prompt(让视频模型知道"陆乘长什么样")
 *   + [场景视觉]           ← 引用 Asset(SCENE)的 description+prompt
 *   + [道具视觉]           ← 引用 Asset(PROP)的 description+prompt
 *   + [镜头内容]           ← Shot.content(动作/对白 — 镜头里发生什么)
 *   + [视频描述]           ← Shot.prompt(由用户/LLM 写的视频核心描述)
 *   + [镜头语言]           ← Shot.framing + Shot.angle(景别 + 机位)
 *   + [时长 + 比例]        ← "{duration}s · {aspectRatio}"
 *   + [额外指令]           ← extraInstruction(用户在抽卡面板的"额外要求")
 *
 *   最终 negative prompt = StyleProfile.forbiddenWords ∪ extraNegative
 *
 * 设计原则:
 *   - 纯函数,无 LLM、无 DB I/O — 便于单测和 UI 实时预览
 *   - 缺段自动跳过,不留空行
 *   - aspectRatio / durationS 不参与字符串拼接的核心 prompt,而是单独返回作 Provider 参数
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface VideoAssetRef {
  /** 资产名(用于在 prompt 中点名:"角色【陆乘】:...") */
  name: string;
  /** 资产摘要(给人看的简短描述,可选) */
  description?: string | null;
  /** 资产核心 prompt — 已确认槽位的视觉描述 */
  prompt: string;
}

export interface CompileShotVideoPromptInput {
  shot: {
    /** 镜头内容(动作/事件 — 镜头里发生什么) */
    content: string;
    /** 视频提示词(LLM 已生成 / 用户已编辑的核心描述) */
    prompt: string;
    /** 景别:大全景/全景/中景/近景/特写/大特写 */
    framing?: string | null;
    /** 机位:正面/侧面/仰角/俯角/平视/过肩 */
    angle?: string | null;
    /** 时长(秒) */
    durationS: number;
  };
  /** 镜头引用的角色资产(0+,按出场顺序) */
  characters?: VideoAssetRef[];
  /** 镜头所在场景(0-1) */
  scene?: VideoAssetRef | null;
  /** 镜头引用的道具资产(0+) */
  props?: VideoAssetRef[];
  /** 项目风格 */
  style?: {
    characterPrompt?: string | null;
    scenePrompt?: string | null;
    forbiddenWords?: string[] | null;
  } | null;
  /** 宽高比(默认 '9:16' 短剧竖屏) */
  aspectRatio?: string;
  /** 额外指令(用户在抽卡面板输入的"额外要求") */
  extraInstruction?: string;
  /** 额外负面提示词 */
  extraNegative?: string[];
}

export interface CompiledShotVideoPrompt {
  /** 拼好的正向 prompt(送 Provider 的主输入) */
  positive: string;
  /** 拼好的负面 prompt */
  negative: string;
  /** 透传给 Provider 的非 prompt 参数 */
  aspectRatio: string;
  durationS: number;
  /** 组成部分 — 给 UI 显示"prompt 是怎么拼出来的" */
  parts: {
    stylePart: string;
    charactersPart: string;
    scenePart: string;
    propsPart: string;
    shotContentPart: string;
    shotPromptPart: string;
    cinematographyPart: string;
    durationPart: string;
    extraPart: string;
  };
}

const DEFAULT_ASPECT_RATIO = '9:16';

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

export function compileShotVideoPrompt(
  input: CompileShotVideoPromptInput,
): CompiledShotVideoPrompt {
  const stylePart = compileStylePart(input.style);
  const charactersPart = compileAssetGroup('角色', input.characters);
  const scenePart = input.scene ? compileAssetGroup('场景', [input.scene]) : '';
  const propsPart = compileAssetGroup('道具', input.props);
  const shotContentPart = input.shot.content.trim();
  const shotPromptPart = input.shot.prompt.trim();
  const cinematographyPart = compileCinematographyPart(
    input.shot.framing,
    input.shot.angle,
  );
  // 注意:用户传 '   '(纯空白)也算缺省,fallback 到 9:16
  const aspectRatio =
    (input.aspectRatio ?? '').trim() || DEFAULT_ASPECT_RATIO;
  const durationS = clampDuration(input.shot.durationS);
  const durationPart = `【参数】时长 ${durationS}s · 宽高比 ${aspectRatio}`;
  const extraPart = (input.extraInstruction ?? '').trim();

  const positive = [
    stylePart,
    charactersPart,
    scenePart,
    propsPart,
    shotContentPart && `【镜头内容】${shotContentPart}`,
    shotPromptPart && `【视频描述】${shotPromptPart}`,
    cinematographyPart,
    durationPart,
    extraPart,
  ]
    .filter((s): s is string => Boolean(s && s.length > 0))
    .join('\n');

  const negative = compileNegative(
    input.style?.forbiddenWords ?? null,
    input.extraNegative ?? null,
  );

  return {
    positive,
    negative,
    aspectRatio,
    durationS,
    parts: {
      stylePart,
      charactersPart,
      scenePart,
      propsPart,
      shotContentPart,
      shotPromptPart,
      cinematographyPart,
      durationPart,
      extraPart,
    },
  };
}

// ---------------------------------------------------------------------------
// 内部 helper
// ---------------------------------------------------------------------------

/**
 * 风格段:镜头通常同时包含人物+场景,直接拼 characterPrompt + scenePrompt,
 * 让视频模型同时拿到两种约束(写实/动漫/3D 等)
 */
function compileStylePart(
  style: CompileShotVideoPromptInput['style'],
): string {
  if (!style) return '';
  const parts = [
    (style.characterPrompt ?? '').trim(),
    (style.scenePrompt ?? '').trim(),
  ].filter((s) => s.length > 0);
  if (parts.length === 0) return '';
  return `【风格】${parts.join(' · ')}`;
}

/**
 * 资产引用段:把一组资产拼成
 *   "【角色】陆乘:身高180cm,短发,...;李婉:长发,白裙,..."
 */
function compileAssetGroup(
  label: string,
  refs: VideoAssetRef[] | undefined,
): string {
  if (!refs || refs.length === 0) return '';
  const items = refs
    .map((r) => {
      const desc = (r.description ?? '').trim();
      const prompt = r.prompt.trim();
      // description 优先(给人看的精简版),fallback 到 prompt(完整版)
      const body = desc.length > 0 ? desc : prompt;
      if (!body) return null;
      return `${r.name}:${body}`;
    })
    .filter((s): s is string => s !== null);
  if (items.length === 0) return '';
  return `【${label}】${items.join(';')}`;
}

function compileCinematographyPart(
  framing: string | null | undefined,
  angle: string | null | undefined,
): string {
  const parts = [framing?.trim(), angle?.trim()].filter(
    (s): s is string => Boolean(s && s.length > 0),
  );
  if (parts.length === 0) return '';
  return `【镜头语言】${parts.join(' · ')}`;
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
 * 时长 clamp:防 0/负数 / 超过 10s 上限(Seedance 等单次生成硬限)
 * 业务层应在调用前结合 SystemSetting.shot.video.maxDurationS 做更精确的限制,
 * 这里只是字符串拼接的最后一道防线
 */
function clampDuration(s: number): number {
  if (!Number.isFinite(s) || s <= 0) return 5; // 默认 5s
  if (s > 10) return 10;
  return Math.round(s * 10) / 10; // 保留 1 位小数
}
