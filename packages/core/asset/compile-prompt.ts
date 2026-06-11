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

/**
 * 七二第九波(用户①·换衣/变装):基于已有「主体形象」图生图换装的提示词。
 * 与 compileAssetPrompt 区别:不走 portrait turnaround slotPhrase(那会让模型重画整张设定图),
 * 改为「身份锚定 + 仅替换服装」语义 —— 配合 img2img(以主体形象为参考 + 较高 strength)锁脸锁发锁身材。
 *
 * @param outfitDesc 造型描述(如「JK制服」);留空/缺省 = 随机一套契合人设的衣服。
 */
export function compileOutfitPrompt(input: {
  asset: { type: AssetTypeLike; name: string; description?: string | null; prompt: string };
  style?: CompilePromptInput['style'];
  outfitDesc?: string;
  extraNegative?: string[];
}): CompiledPrompt {
  const stylePart = pickStylePart(input.asset.type, input.style ?? null);
  // 身份锚段:沿用人物 description/prompt(脸型/五官/发型/体型),服装以下方换装指令为准
  const identityPart = [(input.asset.description ?? '').trim(), input.asset.prompt.trim()]
    .filter((s) => s.length > 0)
    .join('\n');
  const desc = (input.outfitDesc ?? '').trim();
  const outfitClause = desc
    ? `仅将其服装造型更换为:${desc}`
    : '仅将其服装造型更换为:一套契合该角色气质、年代与人设的全新服装(配色协调、风格统一、材质细节合理,可与原造型明显不同)';
  const outfitPart =
    `【换衣】画面中为同一角色:脸型、五官、发型与发色、身材比例与参考图完全一致(identical character, same face & hairstyle & body),` +
    `${outfitClause};服装以本指令为准,忽略上文描述里的原服装。` +
    `沿用主体形象设定图构图(16:9 横版,正面全身立绘 + 侧面/背面/三分之四侧前同框、等高对齐),纯白或浅中性纯色背景,统一柔和影棚平光。`;

  const positive = [stylePart, identityPart, outfitPart].filter((s) => s.length > 0).join('\n');

  const negativeParts: string[] = [];
  if (input.style?.forbiddenWords && input.style.forbiddenWords.length > 0) {
    negativeParts.push(input.style.forbiddenWords.join('、'));
  }
  if (input.extraNegative && input.extraNegative.length > 0) {
    negativeParts.push(input.extraNegative.join('、'));
  }
  // 换衣专属负面:防换脸/换人/改身材
  negativeParts.push('不同的人、换脸、五官改变、发型改变、身材比例改变、多人、文字水印、变形、低清');
  const negative = negativeParts.join('、');

  return {
    positive,
    negative,
    parts: {
      stylePart,
      descriptionPart: identityPart,
      promptPart: '',
      slotPart: outfitPart,
      extraPart: '',
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
      // 七二第九波(用户②):人物「主体形象」= 一张同框 turnaround(正面立绘 + 三视图),
      //   取代原「正面半身像 + 独立三视图」两张。16:9 横版给并排视图足够横向空间。
      return '【构图】16:9 横版人物主体形象设定图(character turnaround / model sheet):同一角色四视图横向并排、等高对齐,从左到右依次为 正面全身立绘、侧面(90° profile)、背面、四分之三侧前(3/4 view);四视图严格同一人物 —— 同一脸型、发型发色、服装款式与配色、身材比例完全一致(identical character & outfit across all views)。纯白或浅中性纯色背景,统一柔和影棚平光,光源方向与色温一致;无投影杂物、无多余人物、无文字水印,排版整洁如专业角色设定参考表';
    case 'three_view':
      // 六八:three_view 槽位双语义 — 人物=三视图,场景=九宫格(9 角度合一张)
      return type === 'SCENE'
        ? '【构图】16:9 九宫格分镜图(3×3 等分,格间细白线):第一行 正面全景/左侧 45° 视角/右侧 45° 视角,第二行 入口反向视角/俯视角/平视纵深,第三行 三个关键陈设局部特写;九格同一场景同一时段,光源方向与色温严格一致,无人物'
        : '【构图】16:9 横版三视图,同一角色从左到右依次为:正面、侧面、背面,统一光线,纯色背景,等高对齐';
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
