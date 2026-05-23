/**
 * 资产拆解 — 剧本 → 人物 / 场景 / 道具 结构化资产草稿
 *
 * 原系统设计的"4 步链"(核心 → 配角 → 物种 → 群演 → merge)在 LLM 充分进化的当下
 * 可以一次性 JSON 输出。Phase 1 简化为单次 LLM 调用,需要"4 步可观察过程"时再拆。
 *
 * 设计原则:
 *   - 严格基于剧本原文(性别/年龄/特征/着装),不臆测
 *   - 同人物不同时期 / 同名同姓不同剧情阶段 → 拆为不同资产
 *     例:"陈雪-不良时期" / "陈雪-疗伤期"
 *   - alias 用于自动 @ 匹配 — 给"小陈"、"陈姐"这种昵称留位
 *   - characterRole 沿用产业分类:主演 / 配角 / 反派 / 群演
 */
import { getTextProvider } from '@ss/adapters/provider';
import type { CallContext } from '@ss/adapters/provider';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface AssetBreakdownInput {
  scriptText: string;
  ctx: CallContext;
  /** 项目类型 — 影响美术风格描述 */
  projectType?: 'AI_REAL' | 'ANIM_3D' | 'ANIM_2D' | 'POSTER' | 'CUSTOM';
  /** 项目风格 slug — 'ai_real' / 'anim_3d' / 'anim_2d' */
  styleSlug?: string;
  modelId?: string;
  /** 单次最多识别人物数(防 LLM 输出失控)— 默认 20 */
  maxCharacters?: number;
}

export interface AssetDraft {
  name: string;
  alias: string[];
  description: string;
  /** 生成图像时使用的提示词(融合外形/服装/特征) */
  prompt: string;
  /** 人物专用 — 'CHARACTER' 类型时填 */
  characterRole?: string;
  tags: string[];
  /**
   * W4 变体分组键 — 同一人物的不同时期作为一组变体(同 key 不同 name)。
   * 例:"陈雪 - 不良时期" / "陈雪 - 疗伤期" 共享 archetypeKey="chenxue"。
   * 必填(给 W4 listArchetypeVariants 用),LLM 输出统一小写 ASCII / pinyin。
   */
  archetypeKey?: string;
}

export interface AssetBreakdownResult {
  characters: AssetDraft[];
  scenes: AssetDraft[];
  props: AssetDraft[];
  cost: number;
  modelId: string;
  raw?: unknown;
  /** LLM 返回不可解析 / 无候选时填,router 显式回给前端,避免"扣了钱以为剧本太简单" */
  warning?: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `你是专业影视美术指导。任务:从剧本中拆解人物 / 场景 / 道具资产。

【核心原则】
1. 仅基于剧本原文,不主观臆测
2. 同人物不同时期或不同剧情阶段 → 拆为不同资产
   例:"陈雪 - 不良时期" / "陈雪 - 疗伤期"
3. 性别、年龄、身高、身材、发型、特征、着装 100% 严格依据原文
4. alias 数组留昵称 / 别称(用于 AIGC 自动 @ 匹配)
5. characterRole 严格用以下值之一:
   - "主演-男主"、"主演-女主"、"主演-反派"
   - "配角-正派"、"配角-反派"、"配角-中性"
   - "群演"
6. 群演只输出一个汇总条目(如 "村民群演"),不要每个无名路人都建条
7. 场景只拆"独立空间"(不是每个分镜的拍摄角度);道具只拆"反复出现且有戏剧意义"的
8. archetypeKey:同一人物的不同时期共享同一 key,在 W4 资产工坊里聚合为变体组
   - 用小写 ASCII / pinyin 主干(不带空格 / 中划线 / 时期后缀)
   - 例:"陈雪 - 不良时期" 和 "陈雪 - 疗伤期" 都用 archetypeKey: "chenxue"
   - 场景 / 道具同理:不同状态共享 key,如 "陆乘家土屋(白天)" / "(夜晚)" → "luchengjia_tuwu"
   - 单一时期 / 无变体的资产也填,直接用主干(如 "1983 年挂历" → "guali_1983")

【输出严格 JSON】
{
  "characters": [
    {
      "name": "陆乘",
      "archetypeKey": "lucheng",
      "alias": ["阿乘","哥","乘哥"],
      "description": "20-25 岁男性,身材消瘦但坚毅,短发,衣着朴素",
      "prompt": "20-25 岁中国男性,身材消瘦但骨骼分明,短发偏粗硬,眼神坚毅有戏,穿着 80 年代农村粗布衣裤,脚踩布鞋",
      "characterRole": "主演-男主",
      "tags": ["坚毅","重情义","逆境重生"]
    }
  ],
  "scenes": [
    {
      "name": "陆乘家破土屋",
      "archetypeKey": "luchengjia_tuwu",
      "alias": ["土屋","老屋","破土屋"],
      "description": "1983 年农村破败土屋,墙体开裂,屋顶漏光",
      "prompt": "1983 年中国农村破败土屋内景,土墙开裂,木门朽烂,屋顶茅草透光,陈设极简(一床一柜一桌)",
      "tags": ["1980s","农村","贫困"]
    }
  ],
  "props": [
    {
      "name": "1983 年挂历",
      "archetypeKey": "guali_1983",
      "alias": ["挂历","日历"],
      "description": "墙上 1983 年 4 月挂历,印红色 12 数字",
      "prompt": "1983 年印刷风格挂历,纸张泛黄,红色 '12' 大字,页脚卷曲",
      "tags": ["时代符号","关键道具"]
    }
  ]
}

【字数控制】
- description: 30-50 字
- prompt: 50-100 字,可直接送图像模型
- alias 上限 5 个,name 必填且唯一

不要输出 markdown 代码块,直接输出 JSON。`;

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

export async function breakdownAssets(
  input: AssetBreakdownInput,
): Promise<AssetBreakdownResult> {
  const modelId = input.modelId ?? 'claude-sonnet-4-5';
  const provider = await getTextProvider(modelId);

  const userPrompt = buildUserPrompt(input);

  const result = await provider.generate(
    {
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      maxTokens: 4096,
      temperature: 0.2,
      jsonSchema: {},
    },
    input.ctx,
  );

  const extracted = extractAssets(result.json, input.maxCharacters ?? 20);
  const totalDrafts =
    extracted.characters.length + extracted.scenes.length + extracted.props.length;

  let warning: string | undefined;
  if (!result.json) {
    warning = 'LLM 未返回 JSON(已计费但本次未拆出资产)';
  } else if (totalDrafts === 0) {
    warning = 'LLM 输出未识别到任何资产(已计费但本次未拆出资产 — 检查剧本格式或调整 prompt)';
  }

  return {
    ...extracted,
    cost: result.costCny,
    modelId,
    raw: result.json,
    warning,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUserPrompt(input: AssetBreakdownInput): string {
  const meta = [
    input.projectType ? `项目类型: ${zhProjectType(input.projectType)}` : null,
    input.styleSlug ? `美术风格: ${zhStyle(input.styleSlug)}` : null,
    input.maxCharacters ? `单次最多识别人物: ${input.maxCharacters} 个` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `${meta}\n\n剧本原文:\n${input.scriptText}`;
}

export function extractAssets(
  json: unknown,
  maxCharacters: number,
): Pick<AssetBreakdownResult, 'characters' | 'scenes' | 'props'> {
  const empty = { characters: [], scenes: [], props: [] };
  if (!json || typeof json !== 'object') return empty;
  const root = json as Record<string, unknown>;

  const characters = parseDraftArray(root.characters, true).slice(0, maxCharacters);
  const scenes = parseDraftArray(root.scenes, false);
  const props = parseDraftArray(root.props, false);

  return { characters, scenes, props };
}

function parseDraftArray(value: unknown, allowRole: boolean): AssetDraft[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): AssetDraft | null => {
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      const name = typeof r.name === 'string' ? r.name.trim() : '';
      if (!name) return null;
      const prompt = typeof r.prompt === 'string' ? r.prompt : '';
      if (!prompt) return null;

      const alias = Array.isArray(r.alias)
        ? r.alias.filter((a): a is string => typeof a === 'string').slice(0, 5)
        : [];
      const tags = Array.isArray(r.tags)
        ? r.tags.filter((t): t is string => typeof t === 'string')
        : [];

      const archetypeKey =
        typeof r.archetypeKey === 'string' ? r.archetypeKey.trim() : '';

      return {
        name,
        alias,
        description: typeof r.description === 'string' ? r.description : '',
        prompt,
        ...(allowRole && typeof r.characterRole === 'string'
          ? { characterRole: r.characterRole }
          : {}),
        tags,
        ...(archetypeKey ? { archetypeKey } : {}),
      };
    })
    .filter((a): a is AssetDraft => a !== null);
}

function zhProjectType(t: string): string {
  return (
    {
      AI_REAL: 'AI 真人短剧',
      ANIM_3D: '3D 国漫',
      ANIM_2D: '2D 动漫',
      POSTER: '海报 / 宣传',
      CUSTOM: '自定义',
    }[t] ?? t
  );
}

function zhStyle(slug: string): string {
  return (
    {
      ai_real: 'AI 真人短剧(照片级写实)',
      anim_3d: '3D 国漫(皮克斯级渲染)',
      anim_2d: '2D 动漫(赛璐璐上色)',
    }[slug] ?? slug
  );
}
