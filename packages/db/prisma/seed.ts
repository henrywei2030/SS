/**
 * Seed 脚本 — 初始化系统默认数据
 * 运行: pnpm db:seed
 *
 * Prisma 7 升级:用 @ss/db 单例 + dotenv 显式加载(7 CLI 不再自动加载 .env)
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/index.js';
import { StyleKind, PromptCategory, ProviderKind } from '../src/generated/prisma/client.js';

async function main() {
  // 四九收工:DB 跨机统一 —— SEED_ADDITIVE=1(pnpm db:sync)只补缺失的结构数据
  //   (风格 / prompt 模板 / 系统设置 KEY),绝不覆盖各机独立的 binding 值 / 手动
  //   编辑过的 prompt 正文 / 已配的密钥;providers 整段跳过(各机可能已删/改)。
  //   无此 flag(pnpm db:seed)= 全量初始化(新机首次,覆盖式),行为不变。
  const ADDITIVE = process.env.SEED_ADDITIVE === '1';
  // 四九收工:增量模式下额外强更 prompt 正文(prompt 是可改进的默认值,改进应能传播)。
  //   仅影响 prompt_templates 的 content/name/description,不碰 binding 值 / 各机配置。
  //   ⚠️ 会覆盖 admin 在 /admin/prompts 手动编辑过的正文 —— 故需显式开启(db:sync:prompts)。
  const FORCE_PROMPTS = process.env.SEED_FORCE_PROMPTS === '1';
  console.log(
    ADDITIVE
      ? `🔄 StarsAlign Studio · DB 增量同步(只补缺失,不覆盖各机配置${FORCE_PROMPTS ? ' · prompt 正文强更' : ''})\n`
      : '🌱 StarsAlign Studio · 星垣工坊 · 种子数据初始化(全量)\n',
  );

  // ---------- 1. 默认风格 ----------
  console.log('  → 创建默认风格 StyleProfile');
  const styles = [
    {
      slug: 'ai_real',
      name: 'AI 真人',
      kind: StyleKind.AI_REAL,
      characterPrompt: '核心风格：照片级写实肖像，真实人类，电影级摄影，专业人像\n严格禁止：动漫、卡通、插画、三维渲染、计算机生成图像、三维动画、绘画、素描、错误解剖、变形',
      scenePrompt: '核心风格：照片级写实，真实环境，电影级摄影，8K 超清\n严格禁止：动漫、卡通、插画、三维渲染、计算机生成图像、三维动画、绘画、素描、错误解剖、变形',
      propPrompt: '核心风格：照片级写实，真实环境，电影级摄影，8K 超清\n严格禁止：动漫、卡通、插画、三维渲染、计算机生成图像、三维动画、绘画、素描、错误解剖、变形',
      forbiddenWords: ['动漫', '卡通', '插画', '三维渲染', '错误解剖', '变形'],
      isBuiltIn: true,
    },
    {
      slug: 'anim_3d',
      name: '3D 国漫',
      kind: StyleKind.ANIM_3D,
      characterPrompt: '核心风格：高质量 3D 国漫风，皮克斯/迪士尼级别建模，电影级渲染，光线追踪，细腻面部表情\n严格禁止：照片级写实、真人、模糊、低多边形',
      scenePrompt: '核心风格：高质量 3D 国漫场景，氛围光，景深，立体感，色彩饱和但不溢出\n严格禁止：照片写实、真人、低多边形',
      propPrompt: '核心风格：高质量 3D 道具建模，细腻材质，PBR 渲染\n严格禁止：照片写实、低多边形',
      forbiddenWords: ['照片写实', '真人', '低多边形'],
      isBuiltIn: true,
    },
    {
      slug: 'anim_2d',
      name: '2D 动漫',
      kind: StyleKind.ANIM_2D,
      characterPrompt: '核心风格：高质量 2D 动漫风，赛璐璐上色，干净线稿，富有表现力的眼睛\n严格禁止：照片写实、3D 渲染、扭曲',
      scenePrompt: '核心风格：动漫风场景，吉卜力级别背景，丰富细节，柔和光线\n严格禁止：照片写实、3D 渲染',
      propPrompt: '核心风格：2D 动漫风道具，干净线条，平涂上色\n严格禁止：照片写实、3D 渲染',
      forbiddenWords: ['照片写实', '3D 渲染', '扭曲'],
      isBuiltIn: true,
    },
  ];

  for (const s of styles) {
    await prisma.styleProfile.upsert({
      where: { slug: s.slug },
      create: s,
      update: ADDITIVE ? {} : s, // 增量:已存在不动(保留用户改过的风格)
    });
  }
  console.log(`    ✓ ${styles.length} 个风格`);

  // ---------- 2. Provider 配置（默认价格表） ----------
  console.log('  → 创建默认 Provider 配置');
  const providers = [
    {
      providerId: 'seedance-2.0',
      displayName: 'Seedance 2.0（视频 · 标准）',
      kind: ProviderKind.VIDEO,
      apiUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKeyRef: 'SEEDANCE_API_KEY',
      unitPriceCny: '1.0',
      unitName: 'second',
      maxConcurrent: 5,
      rateLimitRpm: 30,
      // 2026-05-27:业务上限 15s(用户反馈)— Provider 实际不支持时由 adapter 二次 clamp
      defaultParams: { maxDuration: 15, defaultDuration: 5 },
    },
    {
      providerId: 'seedance-2.0-fast',
      displayName: 'Seedance 2.0 Fast（视频 · 快速）',
      kind: ProviderKind.VIDEO,
      apiUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKeyRef: 'SEEDANCE_API_KEY',
      unitPriceCny: '0.67',
      unitName: 'second',
      maxConcurrent: 8,
      rateLimitRpm: 60,
      defaultParams: { maxDuration: 15, defaultDuration: 5 },
    },
    {
      providerId: 'doubao-1-5-pro-256k',
      displayName: '豆包 1.5 Pro（资产拆解 LLM）',
      kind: ProviderKind.TEXT,
      apiUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKeyRef: 'DOUBAO_API_KEY',
      unitPriceCny: '0.005',
      unitName: 'ktoken',
      maxConcurrent: 10,
      rateLimitRpm: 200,
    },
    {
      providerId: 'nano-banana-pro',
      displayName: 'Nano Banana Pro（图片生成）',
      kind: ProviderKind.IMAGE,
      apiUrl: 'https://api.example.com/nano-banana',
      apiKeyRef: 'NANO_BANANA_API_KEY',
      unitPriceCny: '0.53',
      unitName: 'image',
      maxConcurrent: 10,
      rateLimitRpm: 100,
    },
    {
      providerId: 'gpt-image-2',
      displayName: 'GPT Image 2（图片生成 · 全景/海报）',
      kind: ProviderKind.IMAGE,
      apiUrl: 'https://api.openai.com/v1',
      apiKeyRef: 'OPENAI_API_KEY',
      unitPriceCny: '0.04',
      unitName: 'image',
      maxConcurrent: 5,
      rateLimitRpm: 50,
    },
    {
      providerId: 'claude-sonnet-4-5',
      displayName: 'Claude Sonnet 4.5（剧本分析）',
      kind: ProviderKind.TEXT,
      apiUrl: 'https://api.anthropic.com/v1',
      apiKeyRef: 'ANTHROPIC_API_KEY',
      unitPriceCny: '0.022',
      unitName: 'ktoken',
      maxConcurrent: 10,
      rateLimitRpm: 100,
    },
    {
      providerId: 'volcengine-compliance',
      displayName: '火山引擎合规（真人脸 ID）',
      kind: ProviderKind.COMPLIANCE,
      apiUrl: 'https://visual.volcengineapi.com',
      apiKeyRef: 'VOLCENGINE_COMPLIANCE_API_KEY',
      unitPriceCny: '0.10',
      unitName: 'request',
      maxConcurrent: 3,
      rateLimitRpm: 30,
    },
    // ==========================================================================
    // Phase 1.5.1(2026-05-25)— 中转站模型不再 hardcode seed
    //
    // 旧:8 个 relay-* 模型 seed 进 ProviderConfig 表(死数据,用户 80% 用不上)
    // 新:用户在 /admin/providers UI 从 catalog(packages/shared/data/relay-catalogs.json)
    //     动态选 → 调用 admin.provider.createFromCatalog 落 ProviderConfig 行
    // 中转站凭证由 RelayProvider 表管理(下方 seed),catalog 含 148+ 候选模型
    //
    // 现有 DB 的 relay-* provider 已由 migration 20260525000000 关联到默认 RelayProvider
    // ==========================================================================
  ];

  if (ADDITIVE) {
    // 增量模式:provider 配置 + 密钥各机独立(用户可能已删直连/改中转),整段跳过
    console.log(`    ⏭  增量模式跳过 ${providers.length} 个默认 Provider(各机独立,不动)`);
  } else {
    for (const p of providers) {
      await prisma.providerConfig.upsert({
        where: { providerId: p.providerId },
        create: p as never,
        update: p as never,
      });
    }
    console.log(`    ✓ ${providers.length} 个 Provider`);
  }

  // ---------- 2.5 默认 RelayProvider 占位(Phase 1.5.1) ----------
  // 用户启动后会在 /admin/providers UI 看到一个空的 "moyu" 中转站 placeholder
  // 填 apiUrl + token 后从 catalog 选模型,生成的 ProviderConfig 自动关联到这条
  console.log('  → 创建默认 RelayProvider 占位(moyu)');
  await prisma.relayProvider.upsert({
    where: { name: 'moyu' },
    create: {
      name: 'moyu',
      displayName: 'moyu.info(默认中转站)',
      apiUrl: '', // 用户填
      catalogKey: 'moyu',
      isActive: true,
      notes: 'seed 默认创建 — 填 apiUrl + apiKey 后从 catalog 添加模型',
    },
    update: {}, // 已存在不动(保留用户配过的 token + apiUrl)
  });
  console.log('    ✓ 默认 RelayProvider "moyu" 就绪');

  // ---------- 3. 提示词模板（核心几个） ----------
  console.log('  → 创建核心 Prompt 模板');
  const templates = [
    {
      category: PromptCategory.ASSET_BREAKDOWN,
      slug: 'asset_step_base',
      versionTag: 'v1',
      name: '资产拆解（Base）',
      description: '剧本→人物/场景/道具资产(JSON:含 archetypeKey/gender/age 等核心档案字段)',
      content:
        '你是专业影视美术指导。从剧本拆解人物/场景/道具资产,严格输出 JSON。\n\n【核心原则】\n1. 仅基于剧本原文,不臆测;性别/年龄/身高/发型/着装严格依原文\n2. 同人物不同时期拆为不同资产,共享 archetypeKey(小写拼音主干,如"陈雪-不良时期"/"陈雪-疗伤期"都用 chenxue;场景道具同理共享 key)\n3. characterRole 取值:主演-男主/主演-女主/主演-反派/配角-正派/配角-反派/配角-中性/群演;群演只汇总一条\n4. 场景只拆独立空间(非分镜角度);道具只拆反复出现且有戏剧意义的\n5. 人物补 gender(MALE/FEMALE/OTHER)、age(数字,区间取中值如 20-25→23)、heightCm(数字,无据可省)\n6. ⚠️ 只提取剧本客观信息;MBTI/性格深析/人生小传/独白等深度设定不要在此生成(留空,后续在角色档案里单独 AI 生成 + 人工把关)\n\n【输出严格 JSON,不要 markdown】\n{"characters":[{"name":"陆乘","archetypeKey":"lucheng","alias":["阿乘"],"gender":"MALE","age":23,"heightCm":178,"description":"30-50字外形","prompt":"50-100字可直接送图像模型","characterRole":"主演-男主","tags":["坚毅"]}],"scenes":[{"name":"陆乘家破土屋","archetypeKey":"luchengjia_tuwu","alias":["老屋"],"description":"...","prompt":"...","tags":["农村"]}],"props":[{"name":"1983年挂历","archetypeKey":"guali_1983","alias":["挂历"],"description":"...","prompt":"...","tags":["关键道具"]}]}',
      varsJson: {},
    },
    {
      // 五六-2:剧本拆解模块完整设定 prompt(角色圣经三段式 + 生图 spec-sheet)
      //   与 packages/core/asset/breakdown.ts 的 FULL_SETTINGS_PROMPT 同步
      category: PromptCategory.ASSET_BREAKDOWN,
      slug: 'script_breakdown_full',
      versionTag: 'v1',
      name: '剧本拆解（完整设定）',
      description:
        '从完整剧本拆解人物(形象设定 + 人物小传)/ 场景(制作设计级)/ 道具(hero-prop)富文字设定,严格 JSON',
      content: `你是顶级影视 / 竖屏短剧的「制作设计 + 编剧」。任务:基于【完整剧本】,为全剧拆解并打磨人物 / 场景 / 道具的文字设定,产出可直接用于「AI 生图」与「演员 / 分镜参考」的高质量设定集。

【总原则】
1. 以剧本为根基:姓名、关系、出场、性别、年龄、关键事件 100% 依据剧本,不得编造与剧情冲突的设定。
2. 专业充实:剧本未明写的视觉与背景细节(外貌服饰质感、空间陈设、道具材质、人物家世与动机),在不违背剧本事实的前提下,按顶级影视设定标准合理充实,使其足够具体、可生图、可表演 —— 这正是"打磨设定"的价值,不要因"剧本没写"而留空泛。
3. 同一人物 / 场景 / 道具的不同时期或状态拆为不同条目,共享 archetypeKey(小写拼音主干,无空格 / 中划线 / 后缀)。例:"陈雪-不良时期" / "陈雪-疗伤期" 都用 chenxue;"土屋(白天)" / "(夜晚)" 都用 luchengjia_tuwu。单一状态也填 key(用主干)。
4. characterRole 严格取其一:主演-男主 / 主演-女主 / 主演-反派 / 配角-正派 / 配角-反派 / 配角-中性 / 群演。群演只汇总一条(如"村民群演"),不为每个无名路人建条。
5. 场景只拆"独立空间"(非分镜机位);道具只拆"反复出现或有戏剧意义"的关键道具。
6. alias 留昵称 / 别称(用于 AIGC 自动 @ 匹配),≤5 个;name 必填且唯一。
7. 出场集:每个资产输出 episodes 数组 = 它在剧本中出现的集号(依据 ===第N集=== 标记;跨多集的人物 / 场景 / 道具列出全部出场集,升序)。
8. 排序输出:characters 数组先按重要性(主演 > 配角 > 群演)、同档再按首次出场集升序;scenes 与 props 数组按首次出场集升序排列。

【人物 = 角色圣经三段式】每个人物必须完整产出:
- description(形象设定 · 利于生图一致性,120-200字):面部特征(脸型 / 五官 / 眼神)+ 体型与身高 + 发型发色 + 典型服饰(款式 / 颜色 / 材质 / 配饰)+ 标志性外观 / 伤痕 / 整体气质。写成稳定的"视觉锚",同一角色每次生图都应一致。
- prompt(生图提示词 · 100-150字):把上面的视觉锚浓缩为可直接送图像模型的角色描述(年龄性别 + 外貌 + 发型 + 服饰材质 + 气质神态),不含镜头 / 构图 / 机位词。
- bio(人物小传 · 200-400字):出身家世与成长背景 + 推动其行动的核心动机 / 欲望 / 创伤 + 贯穿全剧的人物弧光(从开端到结局的转变)+ 与主要人物的关系。基于剧本事件合理推演,服务表演与一致性。
- personalityTags:3-6 个性格标签。
- gender(MALE / FEMALE / OTHER)、age(数字,区间取中值如 20-25→23)、heightCm(数字,无据按体型 / 性别合理估计:成年男约 175、女约 163)。

【场景 = 制作设计级】description(120-200字)覆盖:空间类型与结构 + 主要陈设与道具布局 + 材质与色调 + 时段与天气 + 光影方向与质感 + 整体氛围情绪。prompt(100-150字):浓缩为可生图的环境 spec(环境 + 陈设 + 光影 + 氛围,不含机位)。务求"尽可能完善以利生图"。

【道具 = hero-prop 细节】description(80-150字)覆盖:外形与尺寸 + 材质与工艺 + 年代 / 磨损 / 使用痕迹 + 颜色纹理 + 在剧情中的功能与象征意义。prompt(80-120字):浓缩为可生图的道具 spec。

【输出严格 JSON · 不要 markdown · 不要任何解释 · 第一个字符是 { 最后一个是 }】
{"characters":[{"name":"","archetypeKey":"","alias":[],"gender":"MALE","age":0,"heightCm":0,"characterRole":"","episodes":[1,3],"description":"","prompt":"","bio":"","personalityTags":[],"tags":[]}],"scenes":[{"name":"","archetypeKey":"","alias":[],"episodes":[1],"description":"","prompt":"","tags":[]}],"props":[{"name":"","archetypeKey":"","alias":[],"episodes":[2],"description":"","prompt":"","tags":[]}]}`,
      varsJson: {},
    },
    {
      category: PromptCategory.SCRIPT_STORYBOARD,
      slug: 'storyboard_main',
      versionTag: 'v1',
      name: '剧本分镜生成',
      description: '单场剧本 → 分镜列表(严格 JSON · 景别/运镜/光影 · 进阶提示词公式)',
      content: `你是经验丰富的短剧分镜师。任务：把单场剧本拆解为视频生成可用的分镜列表。

【输入】你会收到一场剧本（含场号、时段、内外、地点、人物、动作行/对白/旁白）+ 4 大预设值清单(framing/angle/movement/lighting)

【输出严格 JSON】
{"shots":[{"index":1,"framing":"特写|近景|中景|全景","angle":"平视 0°|俯视 30°|仰视 15°|侧拍 45°","movement":"固定|推|拉|摇|移|跟|升降|甩","lighting":"自然光|硬光|柔光|逆光|侧光|低调|高调|冷调|暖调","content":"30 字内画面内容","durationS":3,"priority":"S|A|B|C","prompt":"完整视频提示词"}]}

【拆镜原则】
1. 每个对白/旁白单独成镜（除非两句台词紧贴同一动作）
2. 每个动作行（△ 起头）单独成镜
3. 重要表情、道具特写单独成镜
4. 默认镜头时长 1-3 秒；爽点/反转给 3-5 秒
5. 短剧结构感:钩子(开场强冲突)→发展→反转/高潮→收尾;priority 爽点反转 S、冲突高潮 A、叙事推进 B、过渡 C

【framing/angle/movement/lighting 选值】
- 4 个字段都必须从【可选预设】清单里挑;清单没有的值用空字符串 "" 不要瞎编
- movement / lighting 允许 ""(固定镜 + 自然光是默认)

【提示词写作 — 进阶公式：景别 + 运镜 + 主体(细节) + 动作(速率) + 场景(层次) + 氛围 + 光影】
- 起手:景别 + 角度 + 主体;主体带关键细节(外貌/服装/表情)
- 动作写清速率(缓缓/猛地/急促);场景写层次(前景···背景)
- 含:环境、光影、氛围、运镜;台词放末尾 "角色名：台词";OS 旁白 "角色名（OS）：旁白"
- 引用人物用 @ 前缀(系统自动替换人物特征)— 例:@陆鸣 猛地起身

【字数】content ≤30 字;prompt 100-150 字

【输出格式 — 严格遵守,违反则系统报错】
⛔ 禁止任何 markdown(# 标题 / ** 加粗 / - 列表 / | 表格 / \`\`\` 代码块)、禁止"以下是分镜表"之类说明文字
✅ 直接从 { 开始、以 } 结尾的纯 JSON;第一个字符必须是 {、最后一个必须是 }
示例:{"shots":[{"index":1,"framing":"特写","angle":"平视 0°","movement":"固定","lighting":"自然光","content":"...","durationS":3,"priority":"B","prompt":"..."}]}`,
      varsJson: { maxDurationS: { type: 'number', default: 15 } },
    },
    {
      category: PromptCategory.PANORAMA_360,
      slug: 'panorama_360_base',
      versionTag: 'v1',
      name: '360° 全景场景',
      description: '场景资产 360° 全景生成',
      content: '生成一张 360° 全景图，要求：\n1. 等距圆柱投影（equirectangular），2:1 宽高比\n2. 无人物，纯空间\n3. 灯光与剧情时段一致（白天/黄昏/夜晚）\n4. 主要朝向标注：北/南/东/西墙各有何摆设',
      varsJson: {},
    },
    {
      // W7 audit R4:剧本 8 维分析 — 之前 hardcoded,这里入 DB,admin 可改
      category: PromptCategory.SCRIPT_STORYBOARD,
      slug: 'script_analysis_main',
      versionTag: 'v1',
      name: '剧本 8 维分析',
      description: '生成 hook/suspense/twist/climax/conflict/dialogue/pace/urgency + 曲线 + 制作计划',
      content:
        '你是经验丰富的短剧编剧 + 制作人。任务:为一集剧本输出 8 维评分(hook/suspense/twist/climax/conflict/dialogue/pace/urgency 各 0-10)+ overall + summary + highlights + issues + curve(每集 8-15 点)+ productionPlan(每镜 priority S/A/B/C)。输出严格 JSON,不要 markdown 包裹。',
      varsJson: {},
    },
    {
      // 四八收工:灵感创作子模块 prompt — admin 可在 /admin/prompts 编辑优化(与 router 内置 fallback 一致)
      category: PromptCategory.SCRIPT_STORYBOARD,
      slug: 'inspiration_outline',
      versionTag: 'v1',
      name: '灵感创作 · 分集大纲',
      description: '想法/灵感 → 多集短剧分集大纲(JSON:title + episodes[number/title/synopsis])',
      content:
        '你是资深短剧编剧。根据用户提供的"想法/灵感"和可选参数,产出一部多集竖屏短剧的分集大纲。\n要求:\n- 剧名简洁有钩子;每集标题 + 一句话梗概(冲突/反转/悬念)\n- 集数:若用户给了目标集数就严格按它,否则默认 12 集\n- 节奏紧凑,每集留钩子,符合短剧"强冲突/快反转"特征\n只输出 JSON,不要任何解释或 markdown,格式:\n{"title":"剧名","episodes":[{"number":1,"title":"集标题","synopsis":"本集梗概"}]}\n⚠️严格JSON:所有字符串值(尤其synopsis)内严禁出现半角双引号 " — 要强调的词改用中文「」《》或不加引号,否则JSON解析失败。确保整段可被JSON.parse直接解析。',
      varsJson: {},
    },
    {
      category: PromptCategory.SCRIPT_STORYBOARD,
      slug: 'inspiration_episode',
      versionTag: 'v1',
      name: '灵感创作 · 单集展开',
      description: '剧名 + 本集大纲 → 该集正式剧本(screenplay:集-场 场头 + 动作 + 台词,对齐解析器)',
      content:
        '你是资深竖屏微短剧编剧。把"本集大纲"展开为一集可直接拍摄的正式剧本。\n\n【剧本格式】严格按此结构(每场之间空一行):\n<集号>-<场号> <时段> <内外> <地点>\n人物：本场出场角色(顿号分隔)\n△动作/场景描述(以 △ 起头,只写镜头能拍到的画面:动作/神态/环境,不写心理)\n角色名（情绪）：台词\n角色名（OS）：内心独白 / 旁白\n(空一行后继续下一场)\n\n【格式细则】\n- 场头:集号-场号 时段(日/夜/晨/黄昏) 内外(内/外) 地点 —— 如第 N 集第 1 场写 "N-1 夜 内 出租屋"\n- 一集拆 4-7 个场,每场聚焦一个动作 / 冲突单元;△ 行只写画面,台词短平快\n- 人物首次登场:△ 补一句人物速写(性别/大致年龄/体型/发型/衣着/气质),供后续剧本拆解提取角色资产\n\n【竖屏微短剧写法】\n- 开篇 3 秒抓人:第 1 场用强冲突画面 + 悬念钩住\n- 三幕节奏:铺垫 → 冲突升级 → 反转 / 爽点;台词尽量一句 ≤20 字、有爆发力、贴人设\n- 结尾留钩子(悬念 / 反转),引导追下一集\n\n只输出剧本正文,不要任何解释 / markdown / 标题符号,从第一个场头开始。',
      varsJson: {},
    },
    {
      // 四九收工:全部展开 — 多集统筹,同样产正式剧本(对齐解析器)
      category: PromptCategory.SCRIPT_STORYBOARD,
      slug: 'inspiration_episodes_batch',
      versionTag: 'v1',
      name: '灵感创作 · 全部展开(批量统筹)',
      description: '完整大纲 + 待展开集 → 多集正式剧本(===第N集=== 分隔 · 集-场 screenplay 格式)',
      content:
        '你是资深竖屏微短剧编剧。把【待展开集】全部展开为可直接拍摄的正式剧本。\n\n【输出结构】每集用单独一行 "===第N集===" 开头分隔(N=集号):\n===第5集===\n<本集剧本(按下方剧本格式)>\n===第6集===\n<...>\n\n【剧本格式】严格按此结构(每场之间空一行):\n<集号>-<场号> <时段> <内外> <地点>\n人物：本场出场角色(顿号分隔)\n△动作/场景描述(△ 起头,只写画面:动作/神态/环境,不写心理)\n角色名（情绪）：台词\n角色名（OS）：内心独白 / 旁白\n\n【格式细则】\n- 场头集号=该集集号(第 5 集的场头是 5-1、5-2…);时段 日/夜/晨/黄昏,内外 内/外\n- 每集 4-7 场,每场一个动作/冲突单元;△ 行只写画面,台词短平快(≤20字)、留钩子\n- 人物首次登场:△ 补一句人物速写(性别/大致年龄/体型/发型/衣着/气质),供后续剧本拆解提取角色资产\n- 多集统筹:前后呼应、伏笔回收、人物弧光连贯,符合短剧"强冲突/快反转"\n\n严格只展开"待展开集"列表里的集。只输出剧本正文 + ===第N集=== 分隔,不要 JSON / markdown / 额外解释。',
      varsJson: {},
    },
  ];

  for (const t of templates) {
    await prisma.promptTemplate.upsert({
      where: { slug_versionTag: { slug: t.slug, versionTag: t.versionTag } },
      create: t as never,
      // 增量默认保留 admin 手编正文;FORCE_PROMPTS 时强更 content/name/description(改进传播)
      update: ADDITIVE
        ? FORCE_PROMPTS
          ? // 全盘审查 #18:补 varsJson — 原强更分支漏它,prompt 占位符元信息改进无法跨机传播
            ({ content: t.content, name: t.name, description: t.description, varsJson: t.varsJson } as never)
          : {}
        : (t as never),
    });
  }
  console.log(`    ✓ ${templates.length} 个 Prompt 模板`);

  // ---------- 4. 默认管理员账号 ----------
  // 用真 bcrypt 哈希一个可登录的默认密码,部署后必须立即改密
  // 密码优先从 env(ADMIN_DEFAULT_PASSWORD)读,否则用 'admin123!@#' (字符长 + 含大写/符号)
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD ?? 'admin123!@#';
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  console.log('  → 创建默认管理员(admin / admin@starsalign.local)');
  const existingAdmin = await prisma.user.findUnique({
    where: { email: 'admin@starsalign.local' },
  });
  await prisma.user.upsert({
    where: { email: 'admin@starsalign.local' },
    create: {
      email: 'admin@starsalign.local',
      username: 'admin',
      displayName: '管理员',
      passwordHash,
      isAdmin: true,
      locale: 'zh-CN',
    },
    // 已存在则不覆盖密码(避免重跑 seed 把用户改过的密码冲掉)
    update: {},
  });
  if (!existingAdmin) {
    // 仅 dev / 未显式设 env 时打印明文密码,生产环境只提示用 env 注入,避免日志泄漏
    const isProd = process.env.NODE_ENV === 'production';
    const usedEnv = !!process.env.ADMIN_DEFAULT_PASSWORD;
    console.log('');
    console.log('   ════════════════════════════════════════════');
    if (isProd && !usedEnv) {
      console.log('   ⚠️  生产环境未设 ADMIN_DEFAULT_PASSWORD,用了内置默认密码');
      console.log('   ⚠️  请用 scripts/set-admin-password 立即重置');
    } else if (!isProd) {
      console.log(`   默认管理员密码: ${adminPassword}`);
      console.log('   ⚠️  生产环境务必立即登录后修改密码');
    } else {
      console.log('   ✓ 默认管理员已用 ADMIN_DEFAULT_PASSWORD 初始化(密码不回显)');
    }
    console.log('   ════════════════════════════════════════════');
    console.log('');
  } else {
    console.log('   (admin 已存在,保留原密码)');
  }

  // ---------- 5. 系统级默认设置 ----------
  console.log('  → 创建系统级默认设置');
  const systemSettings = [
    {
      key: 'system.locale.default',
      value: 'zh-CN',
      category: 'general',
      description: '系统默认语言（zh-CN | en）',
    },
    {
      key: 'system.brand.name_cn',
      value: '星垣工坊',
      category: 'branding',
      description: '品牌中文名',
    },
    {
      key: 'system.brand.name_en',
      value: 'StarsAlign Studio',
      category: 'branding',
      description: '品牌英文名',
    },
    {
      key: 'system.brand.tagline_cn',
      value: '群星垒垣，万剧汇聚',
      category: 'branding',
      description: '品牌中文 slogan',
    },
    {
      key: 'system.gacha.max_attempts',
      value: '5',
      category: 'feature_flag',
      description: '单个镜头最大允许抽卡次数（防失控）',
    },
    {
      key: 'system.budget.warn_pct',
      value: '80',
      category: 'feature_flag',
      description: '预算预警百分比（80% 黄色，100% 红色）',
    },
    {
      key: 'auth.allowSignup',
      value: 'false',
      category: 'security',
      description: '是否允许公开注册(默认关闭,防任何人创建账号;本地/团队部署可改 true)',
    },
    // Phase 1.5 P0-5(主次重审 v2.1):中转站素材库 asset:// 引用机制配置
    {
      key: 'relay.assets.default_group_id',
      value: '0',
      category: 'feature_flag',
      description:
        '中转站素材库默认 group_id(0 = 关闭素材库同步)。若你用的中转站支持素材库 API(可上传文件拿 asset:// 引用,跨调用复用),配 token 后到该站后台创建 group,拿到 group_id 后填这里启用。同一 token 共享素材库。',
    },

    // ----- 模型用途绑定(admin 后台 /admin/bindings 显式选择,默认空)-----
    // 设计原则(二十收工后用户反馈):不 hardcode 任何 provider 作为默认值。
    // 业务调用读 binding,空时抛 PRECONDITION_FAILED 引导 admin 显式配。
    // 测试调试场景仍可走 input.providerOverride / input.modelId 绕过 binding。
    {
      key: 'binding.script.analysis.modelId',
      value: '',
      category: 'model_binding',
      description: '剧本分析使用的 LLM modelId(必须 admin 显式选,例:claude-sonnet-4-5 / relay-claude-sonnet-4-5 / relay-deepseek-chat 等任意 active text provider)',
    },
    {
      key: 'binding.storyboard.generation.modelId',
      value: '',
      category: 'model_binding',
      description: '分镜生成(剧本→单镜列表)使用的 LLM modelId(必须 admin 显式选)',
    },
    {
      key: 'binding.storyboard.prompt.modelId',
      value: '',
      category: 'model_binding',
      description: '【预留 Phase 2】分镜提示词二次优化 LLM(当前 compileShotGroupVideoPrompt 用模板拼接,未调 LLM。Phase 2 加 LLM 优化时启用此 binding)',
    },
    {
      key: 'binding.script.docx.parser',
      value: 'mammoth',
      category: 'model_binding',
      description: 'docx 解析引擎(mammoth | docx2md)— 这是库选择不是 provider,保留默认值',
    },
    {
      // 四八收工:灵感创作 LLM 绑定 — admin 在 /admin/bindings 选模型
      key: 'binding.inspiration.generation.modelId',
      value: '',
      category: 'model_binding',
      description: '灵感创作(想法→多集剧本大纲/展开)使用的 LLM modelId(必须 admin 显式选,任意 active text provider)',
    },

    // ----- 分镜业务参数 -----
    // W1-W5 audit P2 followup(P2-4):storyboard.maxDurationS vs shot.video.maxDurationS 命名澄清
    //   - storyboard.maxDurationS = mergeShots 算法把若干 shot 合成一个 ShotGroup 时的上限(15s),
    //     用于"导演侧排序后这一组送视频模型"的拆分边界
    //   - shot.video.maxDurationS = 单次 aigc.generateVideo 调用 Seedance 等模型时硬上限(10s),
    //     是 Provider API 一次能生成的物理上限
    //   两者不同语义:storyboard.* 决定"合多大",shot.video.* 决定"发多大",不要相互覆盖。
    {
      key: 'storyboard.maxDurationS',
      value: '15',
      category: 'general',
      description: 'mergeShots 合并组单段时长上限（秒）— 区别于 shot.video.maxDurationS(Provider 单次调用硬上限)',
    },
    {
      key: 'storyboard.defaultShotDurationS',
      value: '3',
      category: 'general',
      description: '生成分镜时单镜默认时长（秒）',
    },
    // ----- W4 资产工坊 model 绑定(admin 显式选,默认空) -----
    {
      key: 'binding.asset.breakdown.modelId',
      value: '',
      category: 'model_binding',
      description: '资产拆解使用的 LLM modelId(剧本→人物/场景/道具结构化)— 必须 admin 显式选',
    },
    {
      key: 'binding.asset.image.providerId',
      value: '',
      category: 'model_binding',
      description: '资产主形象 / 三视图生成使用的 Image Provider — 必须 admin 显式选(例:nano-banana-pro / relay-doubao-seedream-4-0 / gpt-image-2 等)',
    },
    {
      key: 'binding.asset.panorama.providerId',
      value: '',
      category: 'model_binding',
      description: '场景 360° 全景图生成使用的 Image Provider — 必须 admin 显式选',
    },
    {
      key: 'binding.asset.compliance.providerId',
      value: '',
      category: 'model_binding',
      description: '人物合规检查使用的 Compliance Provider(返回 complianceId)— 必须 admin 显式选',
    },

    // ----- W4 资产业务参数 -----
    {
      key: 'asset.breakdown.maxCharacters',
      value: '20',
      category: 'general',
      description: '单次拆解最多识别人物数(防 LLM 输出爆炸)',
    },
    {
      key: 'asset.threeView.angles',
      value: '正面,侧面,背面',
      category: 'general',
      description: '人物三视图默认角度(逗号分隔)',
    },
    {
      key: 'asset.compliance.requireForVideo',
      value: 'true',
      category: 'feature_flag',
      description: '视频生成前是否强制要求人物已通过合规检查',
    },

    // ----- W5.0 视频生成 model 绑定(admin 显式选,默认空) -----
    {
      key: 'binding.shot.video.providerId',
      value: '',
      category: 'model_binding',
      description: '分镜视频生成使用的 Video Provider — 必须 admin 显式选(例:seedance-2.0 / relay-doubao-seedance-1-0-pro / relay-doubao-seedance-2-0 等)',
    },

    // ----- W5.0 视频生成业务参数 -----
    {
      key: 'shot.video.maxDurationS',
      value: '15',
      category: 'general',
      description: '单次 aigc.generateVideo 调用 Provider 的硬上限(秒)— 2026-05-27 业务上限提到 15s',
    },
    {
      key: 'shot.video.defaultAspectRatio',
      value: '9:16',
      category: 'general',
      description: '视频默认宽高比(短剧竖屏 9:16,横屏改 16:9)',
    },
    {
      key: 'shot.video.dailyBudgetCny',
      value: '500',
      category: 'general',
      description: '单项目单日视频生成预算上限(元),超限拒绝新抽卡(BUDGET_BLOCKED)',
    },
    {
      // 漏洞审查:文本生成每日预算守卫(inspiration.ts checkTextBudget 读)。默认 0=不限,
      //   各机可在系统设置调;db:sync 增量补缺(不覆盖各机值)
      key: 'text.generate.dailyBudgetCny',
      value: '0',
      category: 'general',
      description: '单项目单日文本生成(大纲/分镜/灵感展开等 LLM)预算上限(元),0=不限,超限拒新请求(TOO_MANY_REQUESTS)',
    },
  ];
  for (const s of systemSettings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      create: s,
      // 增量:已存在的 KEY 不动(保留各机 binding 值 / 已配参数);只补新增的 KEY
      update: ADDITIVE ? {} : { value: s.value, description: s.description, category: s.category },
    });
  }
  console.log(`    ✓ ${systemSettings.length} 条系统设置`);

  console.log('\n✅ 种子数据初始化完成\n');
  console.log('   默认管理员: admin@starsalign.local(初始密码见上方,务必尽快改密)');
  console.log('   AI Provider API Key 默认未设置 — 请登录后在 Admin → AI Provider 后台配置');
  console.log('   该步骤通过 AES-256-GCM 加密存储到数据库，无需写入 .env 文件\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
