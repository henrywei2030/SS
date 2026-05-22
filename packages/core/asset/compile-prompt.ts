/**
 * 资产 prompt 编译器 — 把"基础描述"拼成"送图像 Provider 的完整 prompt"
 *
 * 公式(W4 升级版):
 *   最终 positive prompt =
 *     [项目风格段]      ← StyleProfile.{characterPrompt | scenePrompt | propPrompt}
 *     + [资产 description]  ← 给人看的摘要(可选)
 *     + [资产 prompt]   ← 用户/LLM 写的核心描述
 *     + [槽位提示]     ← 例如 "9:16 竖版正面胸像" / "16:9 三视图"
 *
 *   最终 negative prompt =
 *     StyleProfile.forbiddenWords (项目级禁止项)
 *     + 资产级负面(若 Asset 加了字段;Phase 1 暂无)
 *
 * 设计原则:
 *   - 纯函数,无 LLM 调用,无 DB I/O — 便于单测
 *   - 容错:StyleProfile / description 缺失时跳过该段
 *   - 暴露 slotHint 让前端在调 generateImage 时传"我要生成什么槽位",自动拼接对应短语
 */

// ---------------------------------------------------------------------------
// 类型(轻量化,不直接依赖 Prisma 类型避免循环)
// ---------------------------------------------------------------------------

export type AssetTypeLike = 'CHARACTER' | 'SCENE' | 'PROP' | 'STYLE_REFERENCE';

export type GenerationSlot =
  | 'portrait' // 9:16 人物正面
  | 'three_view' // 16:9 三视图
  | 'scene_main' // 场景主视角
  | 'scene_front' // 场景正面
  | 'scene_left' // 场景左侧
  | 'scene_right' // 场景右侧
  | 'scene_back' // 场景背面
  | 'panorama' // 360° 全景
  | 'main' // 道具/通用主图
  | 'detail' // 细节图
  | 'reference'; // 仅参考

export interface CompilePromptInput {
  asset: {
    type: AssetTypeLike;
    name: string;
    description?: string | null;
    prompt: string;
    archetypeKey?: string | null;
  };
  /** 项目风格(可选 — 若 null 则跳过风格段) */
  style?: {
    characterPrompt?: string | null;
    scenePrompt?: string | null;
    propPrompt?: string | null;
    forbiddenWords?: string[] | null;
  } | null;
  /** 要生成的槽位(影响附加的镜头/视角提示) */
  slot?: GenerationSlot;
  /** 额外的自定义指令(例如用户在生成面板的"额外要求"输入框) */
  extraInstruction?: string;
  /** 额外的负面提示词 */
  extraNegative?: string[];
}

export interface CompiledPrompt {
  positive: string;
  negative: string;
  /** 组成部分 — 便于 UI 显示"完整 prompt 是怎么来的" */
  parts: {
    stylePart: string;
    descriptionPart: string;
    promptPart: string;
    slotPart: string;
    extraPart: string;
  };
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

export function compileAssetPrompt(input: CompilePromptInput): CompiledPrompt {
  const stylePart = pickStylePart(input.asset.type, input.style);
  const descriptionPart = (input.asset.description ?? '').trim();
  const promptPart = input.asset.prompt.trim();
  const slotPart = input.slot ? slotPhrase(input.slot, input.asset.type) : '';
  const extraPart = (input.extraInstruction ?? '').trim();

  const positive = [stylePart, descriptionPart, promptPart, slotPart, extraPart]
    .filter((s) => s.length > 0)
    .join('\n');

  const negativeParts: string[] = [];
  if (input.style?.forbiddenWords && input.style.forbiddenWords.length > 0) {
    negativeParts.push(input.style.forbiddenWords.join('、'));
  }
  if (input.extraNegative && input.extraNegative.length > 0) {
    negativeParts.push(input.extraNegative.join('、'));
  }
  const negative = negativeParts.join('、');

  return {
    positive,
    negative,
    parts: {
      stylePart,
      descriptionPart,
      promptPart,
      slotPart,
      extraPart,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickStylePart(
  type: AssetTypeLike,
  style: CompilePromptInput['style'],
): string {
  if (!style) return '';
  if (type === 'CHARACTER') return (style.characterPrompt ?? '').trim();
  if (type === 'SCENE') return (style.scenePrompt ?? '').trim();
  if (type === 'PROP') return (style.propPrompt ?? '').trim();
  // STYLE_REFERENCE 不附加风格段(它本身就是风格定义)
  return '';
}

/**
 * 不同槽位附加的视角/构图提示 — 让图像模型知道生成什么版式
 */
function slotPhrase(slot: GenerationSlot, type: AssetTypeLike): string {
  switch (slot) {
    case 'portrait':
      return '【构图】9:16 竖版正面半身像或胸像,角色面向镜头,完整面部清晰,背景简洁居中';
    case 'three_view':
      return '【构图】16:9 横版三视图,同一角色从左到右依次为:正面、侧面、背面,统一光线,纯色背景,等高对齐';
    case 'scene_main':
      return type === 'SCENE'
        ? '【构图】场景主视角,展现整体空间结构和氛围,无人物'
        : '';
    case 'scene_front':
      return '【构图】场景正面视角,展现主要墙面/陈设,平视镜头,无人物';
    case 'scene_left':
      return '【构图】场景左侧视角,展现左墙/相邻空间,无人物';
    case 'scene_right':
      return '【构图】场景右侧视角,展现右墙/相邻空间,无人物';
    case 'scene_back':
      return '【构图】场景背面视角,从入口反方向看向场景,无人物';
    case 'panorama':
      return '【构图】360° 等距圆柱投影全景图,2:1 宽高比,完整覆盖场景四面,纯空间无人物';
    case 'main':
      return type === 'PROP'
        ? '【构图】道具单体产品图,纯色背景,无人物,细节清晰,光线均匀'
        : '';
    case 'detail':
      return '【构图】细节特写,展示纹理/材质/文字等关键信息';
    case 'reference':
      return '';
    default:
      return '';
  }
}
