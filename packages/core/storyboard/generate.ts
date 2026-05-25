/**
 * 分镜生成（剧本 → 单镜列表 + 提示词）
 *
 * 业务流程：
 *   1. 剧本解析器（parse.ts）把剧本拆成场（Scene）+ 行（Line）
 *   2. 本模块按"一场一次 LLM 调用"生成该场的分镜
 *   3. 每个 shot 直接含 framing / angle / content / durationS / prompt（含台词+OS）
 *   4. router 层再调 mergeShots 算法（merge.ts）按 maxDurationS 预合并组
 *
 * 设计原则：
 *   - 一次性整体生成（不暴露单镜重抽，与用户产品决策一致）
 *   - 失败回退：JSON 解析失败时不报错，返回空 shots，让 router 标记任务失败
 *   - 与 packages/adapters/provider 的 TextProvider 接口对齐
 */
import { getTextProvider } from '@ss/adapters/provider';

import { loadPromptTemplate } from '../shared/load-prompt.js';
import type { CallContext } from '@ss/adapters/provider';

import type { ParsedScene } from '../script/parse.js';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface GenerateStoryboardInput {
  scene: ParsedScene;
  ctx: CallContext;
  /** 项目风格 slug（'ai_real' / 'anim_3d' / 'anim_2d'），影响美术风格描述 */
  styleSlug?: string;
  /**
   * 完整 StyleProfile 风格段(W4 + W3 拼接公式对齐)— scenePrompt 拼到分镜 prompt 里
   * 让 LLM 输出的视频提示词遵循全剧统一风格
   */
  stylePrompt?: {
    scenePrompt?: string | null;
    characterPrompt?: string | null;
    // W7 audit R5:propPrompt 之前漏传(W4/W5 拼接公式都读三段,W3 LLM 输入只读 2 段)
    propPrompt?: string | null;
    forbiddenWords?: string[] | null;
  };
  /** 已知角色资产名单,用于 @ 引用提示 */
  knownCharacters?: string[];
  /** LLM 模型 — 默认从 SystemSetting `binding.storyboard.generation.modelId` 读取 */
  modelId?: string;
  /** 单镜默认时长(秒) — 默认 3 */
  defaultShotDurationS?: number;
  /** 单镜最大时长(秒) — 用于裁剪 LLM 返回的过长 durationS,默认 15 */
  maxShotDurationS?: number;
  /**
   * W7 followup:预设值清单 — admin.preset 4 大类(framing/angle/movement/lighting)
   * 传给 LLM 让其在已定义值里选,而不是自由发挥。
   * router 层从 me.presets / admin.preset.list 取后传入。
   */
  presets?: {
    framing?: string[];
    angle?: string[];
    movement?: string[];
    lighting?: string[];
  };
}

export interface GeneratedShot {
  /** 场内顺序 1-based — 跨场合并时由 router 层重编号 */
  index: number;
  framing: string; // 景别（特写/近景/中景/全景）
  angle: string; // 角度（平视/俯视/仰视 + 度数；如 "平视 0°"）
  // W7 followup:LLM 也输出运镜 + 光线(可选),让分镜更完整
  movement?: string; // 运镜（固定/推/拉/摇/移/跟/升降/甩,跟 admin.preset 联动）
  lighting?: string; // 光线（自然光/硬光/柔光/逆光/侧光,跟 admin.preset 联动）
  content: string; // 镜头内容（30 字内）
  durationS: number; // 时长
  priority?: 'S' | 'A' | 'B' | 'C';
  prompt: string; // 视频提示词（含台词+OS，可直接送视频模型）
}

export interface GenerateStoryboardResult {
  shots: GeneratedShot[];
  cost: number;
  modelId: string;
  /** LLM 返回的原始 JSON（便于调试 / debug 入库） */
  raw?: unknown;
  /** 解析失败 / 0 shot 时填，让 router 显式告知用户"扣费但未生成" */
  warning?: string;
}

// ---------------------------------------------------------------------------
// Prompt 模板
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `你是经验丰富的短剧分镜师。任务：把单场剧本拆解为视频生成可用的分镜列表。

【输入】你会收到一场剧本（含场号、时段、内外、地点、人物、动作行/对白/旁白）+ 4 大预设值清单(framing/angle/movement/lighting)

【输出严格 JSON】
{
  "shots": [
    {
      "index": 1,
      "framing": "特写" | "近景" | "中景" | "全景" | ...,
      "angle": "平视 0°" | "俯视 30°" | "仰视 15°" | "侧拍 45°" | ...,
      "movement": "固定" | "推" | "拉" | "摇" | "移" | "跟" | "升降" | "甩",
      "lighting": "自然光" | "硬光" | "柔光" | "逆光" | "侧光" | "低调" | "高调" | "冷调" | "暖调",
      "content": "30 字内描述这一镜的画面内容",
      "durationS": 1-5,
      "priority": "S" | "A" | "B" | "C",
      "prompt": "视频生成的完整提示词，融合 framing + angle + movement + lighting + content + 美术风格 + 台词/OS"
    }
  ]
}

【拆镜原则】
1. 每个对白/旁白单独成镜（除非两句台词紧贴同一动作）
2. 每个动作行（△ 起头）单独成镜
3. 重要表情、道具特写单独成镜
4. 默认镜头时长 1-3 秒；爽点/反转给 3-5 秒
5. priority：爽点反转 S；冲突高潮 A；叙事推进 B；过渡 C

【framing/angle/movement/lighting 选值】
- 4 个字段都**必须**从【可选预设】清单里挑;清单里没有的值用空字符串 "" 不要瞎编
- movement / lighting 允许 ""(不强求所有镜都有运镜光线设计;固定镜 + 自然光是默认)

【提示词写作】
- 起手：景别 + 角度 + 主体
- 含：环境、光线、表情、动作、运镜
- 台词放在末尾，格式 "角色名：台词"
- OS 旁白格式 "角色名（OS）：旁白文字"
- 引用人物用 @ 前缀（系统会自动替换为人物特征）— 例：@陆乘 走入

【字数控制】
- content：30 字以内
- prompt：100-150 字

不要输出 markdown 代码块，直接输出 JSON。`;

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

export async function generateStoryboard(
  input: GenerateStoryboardInput,
): Promise<GenerateStoryboardResult> {
  const modelId = input.modelId ?? 'claude-sonnet-4-5';
  const provider = await getTextProvider(modelId);

  const userPrompt = buildUserPrompt(input);

  // W7 audit R4:DB-driven prompt(admin 可编辑),失败 fallback hardcoded
  const systemPrompt = await loadPromptTemplate('storyboard_main', SYSTEM_PROMPT);

  const result = await provider.generate(
    {
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 4096,
      temperature: 0.3,
      jsonSchema: {},
    },
    input.ctx,
  );

  const shots = extractShots(
    result.json,
    input.defaultShotDurationS ?? 3,
    input.maxShotDurationS ?? 15,
  );

  let warning: string | undefined;
  if (!result.json) {
    warning = 'LLM 未返回 JSON';
  } else if (shots.length === 0) {
    warning = 'LLM 输出无可解析 shots（已计费但本场未生成分镜）';
  }

  return {
    shots,
    cost: result.costCny,
    modelId,
    raw: result.json,
    warning,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUserPrompt(input: GenerateStoryboardInput): string {
  const { scene, styleSlug, stylePrompt, knownCharacters, presets } = input;

  // Phase 1.5.3 bugfix:fallback 合成 scene 时 scene.lines=[],必须 fallback 到 rawContent
  // 否则 LLM 拿到空 "剧本原文:" 就摆烂,只产 1 个通用镜
  const lines =
    scene.lines.length > 0
      ? scene.lines
          .map((l) => {
            switch (l.kind) {
              case 'action':
                return `△ ${l.text}`;
              case 'dialog':
                return `${l.speaker}${l.emotion ? `（${l.emotion}）` : ''}：${l.text}`;
              case 'voiceover':
                return `${l.speaker}（${l.emotion ?? 'OS'}）：${l.text}`;
              default:
                return l.text;
            }
          })
          .join('\n')
      : scene.rawContent;

  // 完整风格段:scene/character/prop 三段 prompt + forbiddenWords
  // W7 audit R5:补 propPrompt(原漏传,跟 W4/W5 拼接公式对齐)
  // 让生成的镜头 prompt 直接继承全剧统一风格
  const styleBlock = stylePrompt
    ? [
        stylePrompt.scenePrompt ? `场景风格: ${stylePrompt.scenePrompt}` : null,
        stylePrompt.characterPrompt ? `人物风格: ${stylePrompt.characterPrompt}` : null,
        stylePrompt.propPrompt ? `道具风格: ${stylePrompt.propPrompt}` : null,
        stylePrompt.forbiddenWords && stylePrompt.forbiddenWords.length > 0
          ? `禁止: ${stylePrompt.forbiddenWords.join('、')}`
          : null,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  // W7 followup:把 4 大预设清单灌给 LLM,让 framing/angle/movement/lighting 在已知值里选
  const presetBlock = presets
    ? [
        presets.framing?.length ? `framing 可选: ${presets.framing.join(' | ')}` : null,
        presets.angle?.length ? `angle 可选: ${presets.angle.join(' | ')}` : null,
        presets.movement?.length ? `movement 可选: ${presets.movement.join(' | ')}` : null,
        presets.lighting?.length ? `lighting 可选: ${presets.lighting.join(' | ')}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const meta = [
    `场号: ${scene.number}`,
    `时段: ${zhTimeOfDay(scene.timeOfDay)}`,
    `内外: ${zhLocation(scene.location)}`,
    scene.place ? `地点: ${scene.place}` : null,
    scene.characters.length ? `本场人物: ${scene.characters.join('、')}` : null,
    styleSlug ? `美术风格: ${zhStyle(styleSlug)}` : null,
    styleBlock ? `\n【全剧风格规约】\n${styleBlock}` : null,
    presetBlock ? `\n【可选预设】\n${presetBlock}` : null,
    knownCharacters?.length
      ? `已建档资产: ${knownCharacters.map((c) => `@${c}`).join(' / ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `${meta}\n\n剧本原文：\n${lines}`;
}

function extractShots(
  json: unknown,
  defaultDurationS: number,
  maxDurationS: number,
): GeneratedShot[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as { shots?: unknown };
  if (!Array.isArray(root.shots)) return [];

  const items = root.shots
    .map((raw, i): GeneratedShot | null => {
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;

      const framing = typeof r.framing === 'string' ? r.framing : '中景';
      const angle = typeof r.angle === 'string' ? r.angle : '平视 0°';
      // W7 followup:movement/lighting 都可选,空字符串 "" 视为 undefined(不存)
      const movement =
        typeof r.movement === 'string' && r.movement.length > 0 ? r.movement : undefined;
      const lighting =
        typeof r.lighting === 'string' && r.lighting.length > 0 ? r.lighting : undefined;
      const content = typeof r.content === 'string' ? r.content : '';
      const prompt = typeof r.prompt === 'string' ? r.prompt : '';
      const durationS =
        typeof r.durationS === 'number' && r.durationS > 0
          ? Math.min(r.durationS, maxDurationS)
          : defaultDurationS;
      const priority =
        r.priority === 'S' || r.priority === 'A' || r.priority === 'B' || r.priority === 'C'
          ? r.priority
          : undefined;

      // 必须有 content 或 prompt 之一才算有效
      if (!content && !prompt) return null;

      return {
        index: typeof r.index === 'number' ? r.index : i + 1,
        framing,
        angle,
        movement,
        lighting,
        content,
        durationS,
        priority,
        prompt,
      };
    })
    .filter((s): s is GeneratedShot => s !== null);

  // LLM 可能返回乱序 index — 按 index 排序后重编号，确保入库顺序与剧情顺序一致
  items.sort((a, b) => a.index - b.index);
  return items.map((s, i) => ({ ...s, index: i + 1 }));
}

function zhTimeOfDay(t: ParsedScene['timeOfDay']): string {
  return { DAWN: '晨', DAY: '日', DUSK: '昏', NIGHT: '夜' }[t];
}

function zhLocation(l: ParsedScene['location']): string {
  return { INDOOR: '内', OUTDOOR: '外', MIXED: '内外' }[l];
}

function zhStyle(slug: string): string {
  return (
    {
      ai_real: 'AI 真人短剧（照片级写实）',
      anim_3d: '3D 国漫（皮克斯级渲染）',
      anim_2d: '2D 动漫（赛璐璐上色）',
    }[slug] ?? slug
  );
}
