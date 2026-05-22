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
}

export interface GeneratedShot {
  /** 场内顺序 1-based — 跨场合并时由 router 层重编号 */
  index: number;
  framing: string; // 景别（特写/近景/中景/全景）
  angle: string; // 角度（平视/俯视/仰视 + 度数；如 "平视 0°"）
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

【输入】你会收到一场剧本（含场号、时段、内外、地点、人物、动作行/对白/旁白）

【输出严格 JSON】
{
  "shots": [
    {
      "index": 1,
      "framing": "特写" | "近景" | "中景" | "全景",
      "angle": "平视 0°" | "俯视 30°" | "仰视 15°" | "侧拍 45°" | ...,
      "content": "30 字内描述这一镜的画面内容",
      "durationS": 1-5,
      "priority": "S" | "A" | "B" | "C",
      "prompt": "视频生成的完整提示词，融合 framing + angle + content + 美术风格 + 台词/OS"
    }
  ]
}

【拆镜原则】
1. 每个对白/旁白单独成镜（除非两句台词紧贴同一动作）
2. 每个动作行（△ 起头）单独成镜
3. 重要表情、道具特写单独成镜
4. 默认镜头时长 1-3 秒；爽点/反转给 3-5 秒
5. priority：爽点反转 S；冲突高潮 A；叙事推进 B；过渡 C

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

  const result = await provider.generate(
    {
      system: SYSTEM_PROMPT,
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
  const { scene, styleSlug, stylePrompt, knownCharacters } = input;

  const lines = scene.lines
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
    .join('\n');

  // 完整风格段:scenePrompt(场景质感)+ characterPrompt(人物风格)+ forbiddenWords
  // 让生成的镜头 prompt 直接继承全剧统一风格
  const styleBlock = stylePrompt
    ? [
        stylePrompt.scenePrompt ? `场景风格: ${stylePrompt.scenePrompt}` : null,
        stylePrompt.characterPrompt ? `人物风格: ${stylePrompt.characterPrompt}` : null,
        stylePrompt.forbiddenWords && stylePrompt.forbiddenWords.length > 0
          ? `禁止: ${stylePrompt.forbiddenWords.join('、')}`
          : null,
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
