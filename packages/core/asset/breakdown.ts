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
import { asRecord } from '@ss/shared';

import { loadPromptTemplate } from '../shared/load-prompt.js';

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
  /**
   * 五六-2:聚焦单一类型拆解 — 整本剧本仍作上下文,但只产一类,
   * 大幅降低单次生成耗时,避免非流式中转 Headers Timeout(慢模型一次全拆三类会超 300s)。
   * 不传 = 一次全拆(轻量 breakdownAssets 用)。
   */
  focusType?: 'CHARACTER' | 'SCENE' | 'PROP';
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
  /** 性别(人物;从剧本提取)*/
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  /** 年龄(从剧本提取,数字;区间取中值)*/
  age?: number;
  /** 身高 cm(从剧本提取或按体型合理估计)*/
  heightCm?: number;
  /** 人物小传 — 背景故事/动机/弧光(五六-2 完整设定拆解产出,人物专用)*/
  bio?: string;
  /** 性格标签(五六-2 完整设定拆解产出,人物专用)*/
  personalityTags?: string[];
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
      "gender": "MALE",
      "age": 23,
      "heightCm": 178,
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

【人物档案字段(仅 characters)】
- gender:MALE / FEMALE / OTHER(依剧本)
- age:数字年龄;剧本只给区间(如"20-25 岁")时取中值(23)
- heightCm:数字身高;剧本未提则按体型/性别合理估计(成年男约 175、女约 163),实在无据可省略
- ⚠️ 只提取剧本能支撑的客观信息;MBTI / 性格深析 / 人生小传 / 独白等**深度设定不要在此生成**(留空,后续在角色档案里单独 AI 生成 + 人工把关)

【字数控制】
- description: 30-50 字
- prompt: 50-100 字,可直接送图像模型
- alias 上限 5 个,name 必填且唯一

不要输出 markdown 代码块,直接输出 JSON。`;

// ---------------------------------------------------------------------------
// 完整设定 Prompt(五六-2 剧本拆解模块 · 角色圣经三段式 + 生图 spec-sheet)
//   产出富文字设定:人物形象设定 + 人物小传;场景制作设计级描述;道具 hero-prop 细节。
//   admin slug = script_breakdown_full,以下为代码 fallback(与 seed 同步)。
// ---------------------------------------------------------------------------

export const FULL_SETTINGS_PROMPT = `你是顶级影视 / 竖屏短剧的「制作设计 + 编剧」。任务:基于【完整剧本】,为全剧拆解并打磨人物 / 场景 / 道具的文字设定,产出可直接用于「AI 生图」与「演员 / 分镜参考」的高质量设定集。

【总原则】
1. 以剧本为根基:姓名、关系、出场、性别、年龄、关键事件 100% 依据剧本,不得编造与剧情冲突的设定。
2. 专业充实:剧本未明写的视觉与背景细节(外貌服饰质感、空间陈设、道具材质、人物家世与动机),在不违背剧本事实的前提下,按顶级影视设定标准合理充实,使其足够具体、可生图、可表演 —— 这正是"打磨设定"的价值,不要因"剧本没写"而留空泛。
3. 同一人物 / 场景 / 道具的不同时期或状态拆为不同条目,共享 archetypeKey(小写拼音主干,无空格 / 中划线 / 后缀)。例:"陈雪-不良时期" / "陈雪-疗伤期" 都用 chenxue;"土屋(白天)" / "(夜晚)" 都用 luchengjia_tuwu。单一状态也填 key(用主干)。
4. characterRole 严格取其一:主演-男主 / 主演-女主 / 主演-反派 / 配角-正派 / 配角-反派 / 配角-中性 / 群演。群演只汇总一条(如"村民群演"),不为每个无名路人建条。
5. 场景只拆"独立空间"(非分镜机位);道具只拆"反复出现或有戏剧意义"的关键道具。
6. alias 留昵称 / 别称(用于 AIGC 自动 @ 匹配),≤5 个;name 必填且唯一。

【人物 = 角色圣经三段式】每个人物必须完整产出:
- description(形象设定 · 利于生图一致性,120-200字):面部特征(脸型 / 五官 / 眼神)+ 体型与身高 + 发型发色 + 典型服饰(款式 / 颜色 / 材质 / 配饰)+ 标志性外观 / 伤痕 / 整体气质。写成稳定的"视觉锚",同一角色每次生图都应一致。
- prompt(生图提示词 · 100-150字):把上面的视觉锚浓缩为可直接送图像模型的角色描述(年龄性别 + 外貌 + 发型 + 服饰材质 + 气质神态),不含镜头 / 构图 / 机位词。
- bio(人物小传 · 200-400字):出身家世与成长背景 + 推动其行动的核心动机 / 欲望 / 创伤 + 贯穿全剧的人物弧光(从开端到结局的转变)+ 与主要人物的关系。基于剧本事件合理推演,服务表演与一致性。
- personalityTags:3-6 个性格标签。
- gender(MALE / FEMALE / OTHER)、age(数字,区间取中值如 20-25→23)、heightCm(数字,无据按体型 / 性别合理估计:成年男约 175、女约 163)。

【场景 = 制作设计级】description(120-200字)覆盖:空间类型与结构 + 主要陈设与道具布局 + 材质与色调 + 时段与天气 + 光影方向与质感 + 整体氛围情绪。prompt(100-150字):浓缩为可生图的环境 spec(环境 + 陈设 + 光影 + 氛围,不含机位)。务求"尽可能完善以利生图"。

【道具 = hero-prop 细节】description(80-150字)覆盖:外形与尺寸 + 材质与工艺 + 年代 / 磨损 / 使用痕迹 + 颜色纹理 + 在剧情中的功能与象征意义。prompt(80-120字):浓缩为可生图的道具 spec。

【输出严格 JSON · 不要 markdown · 不要任何解释 · 第一个字符是 { 最后一个是 }】
{"characters":[{"name":"","archetypeKey":"","alias":[],"gender":"MALE","age":0,"heightCm":0,"characterRole":"","description":"","prompt":"","bio":"","personalityTags":[],"tags":[]}],"scenes":[{"name":"","archetypeKey":"","alias":[],"description":"","prompt":"","tags":[]}],"props":[{"name":"","archetypeKey":"","alias":[],"description":"","prompt":"","tags":[]}]}`;

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

export async function breakdownAssets(
  input: AssetBreakdownInput,
): Promise<AssetBreakdownResult> {
  const modelId = input.modelId ?? 'claude-sonnet-4-5';
  const provider = await getTextProvider(modelId);

  const userPrompt = buildUserPrompt(input);

  // W7 audit R4:从 DB PromptTemplate 拉(admin 可编辑),失败 fallback 到 hardcoded SYSTEM_PROMPT
  const systemPrompt = await loadPromptTemplate('asset_step_base', SYSTEM_PROMPT);

  const result = await provider.generate(
    {
      system: systemPrompt,
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

/**
 * 完整设定拆解(五六-2)— 从【整部剧本】产出富文字设定(形象 + 小传 + 富场景/道具)。
 *
 * 与 breakdownAssets 的区别:
 *   - prompt slug = script_breakdown_full(角色圣经三段式 + 生图 spec),fallback FULL_SETTINGS_PROMPT
 *   - maxTokens 16000(富输出)+ temperature 0.4(小传/形象需专业充实,略高于轻量拆解的 0.2)
 *   - 复用 extractAssets/parseDraftArray(已 bio/personalityTags-aware)
 * breakdownAssets(asset_step_base 轻量版)保留给美术工坊「从剧本拆解」快速建用,行为不变。
 */
export async function breakdownFullSettings(
  input: AssetBreakdownInput,
): Promise<AssetBreakdownResult> {
  const modelId = input.modelId ?? 'claude-sonnet-4-5';
  const provider = await getTextProvider(modelId);

  const userPrompt = buildUserPrompt(input);
  const systemPrompt = await loadPromptTemplate('script_breakdown_full', FULL_SETTINGS_PROMPT);

  const result = await provider.generate(
    {
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 16000,
      temperature: 0.4,
      jsonSchema: {},
    },
    input.ctx,
  );

  const extracted = extractAssets(result.json, input.maxCharacters ?? 30);
  const totalDrafts =
    extracted.characters.length + extracted.scenes.length + extracted.props.length;

  let warning: string | undefined;
  if (!result.json) {
    warning = 'LLM 未返回 JSON(已计费但本次未拆出设定 — 检查剧本是否为空 / 模型是否支持 JSON 输出)';
  } else if (totalDrafts === 0) {
    warning = 'LLM 输出未识别到任何资产(已计费但本次未拆出设定 — 检查剧本格式或调整 prompt)';
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

  // 五六-2:聚焦单类型时明确只产该类、其余空数组(分次拆避免单请求超时)
  const focusLabel = { CHARACTER: '人物', SCENE: '场景', PROP: '道具' };
  const focus = input.focusType
    ? `\n\n【本次聚焦】只拆解并完整输出【${focusLabel[input.focusType]}】这一类(尽量详尽);characters / scenes / props 中其余两类一律返回空数组 []。`
    : '';

  return `${meta}${focus}\n\n剧本原文:\n${input.scriptText}`;
}

export function extractAssets(
  json: unknown,
  maxCharacters: number,
): Pick<AssetBreakdownResult, 'characters' | 'scenes' | 'props'> {
  const empty = { characters: [], scenes: [], props: [] };
  const root = asRecord(json);
  if (!root) return empty;

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
        ...(allowRole && (r.gender === 'MALE' || r.gender === 'FEMALE' || r.gender === 'OTHER')
          ? { gender: r.gender }
          : {}),
        ...(allowRole && typeof r.age === 'number' && r.age > 0 ? { age: Math.round(r.age) } : {}),
        ...(allowRole && typeof r.heightCm === 'number' && r.heightCm > 0
          ? { heightCm: Math.round(r.heightCm) }
          : {}),
        // 五六-2 完整设定:人物小传 + 性格标签(仅 characters)
        ...(allowRole && typeof r.bio === 'string' && r.bio.trim() ? { bio: r.bio.trim() } : {}),
        ...(allowRole && Array.isArray(r.personalityTags)
          ? {
              personalityTags: r.personalityTags
                .filter((t): t is string => typeof t === 'string')
                .slice(0, 20),
            }
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
