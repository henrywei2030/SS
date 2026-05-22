/**
 * Seed 脚本 — 初始化系统默认数据
 * 运行: pnpm db:seed
 */
import { PrismaClient, StyleKind, PromptCategory, ProviderKind } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 StarsAlign Studio · 星垣工坊 · 种子数据初始化\n');

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
      update: s,
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
      defaultParams: { maxDuration: 10, defaultDuration: 5 },
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
      defaultParams: { maxDuration: 5, defaultDuration: 5 },
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
  ];

  for (const p of providers) {
    await prisma.providerConfig.upsert({
      where: { providerId: p.providerId },
      create: p as never,
      update: p as never,
    });
  }
  console.log(`    ✓ ${providers.length} 个 Provider`);

  // ---------- 3. 提示词模板（核心几个） ----------
  console.log('  → 创建核心 Prompt 模板');
  const templates = [
    {
      category: PromptCategory.ASSET_BREAKDOWN,
      slug: 'asset_step_base',
      versionTag: 'v1',
      name: '资产拆解（Base）',
      description: '多步拆解的基础系统提示词',
      content: '你是专业影视美术指导。任务：从剧本中拆解人物/场景/道具资产。\n\n核心原则：\n1. 仅基于剧本原文，不主观臆测\n2. 同人物不同时期拆为不同资产（如"陈雪 - 不良时期"、"陈雪 - 疗伤期"）\n3. 性别、年龄、身高、身材、发型、特征、着装 100% 严格依据原文\n4. 出场集数需精确到第几集第几场（如"01-1, 02-3, 12-第二阶法术"）',
      varsJson: {},
    },
    {
      category: PromptCategory.SCRIPT_STORYBOARD,
      slug: 'storyboard_main',
      versionTag: 'v1',
      name: '剧本分镜生成',
      description: '基于剧本生成线性分镜的提示词',
      content: '你是经验丰富的导演。任务：将剧本拆解为线性分镜。\n\n要求：\n1. 每个镜头标注：景别、机位角度、镜头内容、视频提示词\n2. 镜头时长按 1-10 秒拆分（默认 5 秒），便于视频模型生成\n3. 优先级 S/A/B/C：爽点/反转=S，冲突高潮=A，叙事推进=B，过渡=C\n4. 引用人物/场景/道具时使用 @资产名 占位符',
      varsJson: { maxDurationS: { type: 'number', default: 10 } },
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
  ];

  for (const t of templates) {
    await prisma.promptTemplate.upsert({
      where: { slug_versionTag: { slug: t.slug, versionTag: t.versionTag } },
      create: t as never,
      update: t as never,
    });
  }
  console.log(`    ✓ ${templates.length} 个 Prompt 模板`);

  // ---------- 4. 默认管理员账号 ----------
  // 占位 — 实际密码哈希由 auth adapter 处理；这里使用 bcrypt 占位字符串
  console.log('  → 创建默认管理员（admin / admin@starsalign.local）');
  await prisma.user.upsert({
    where: { email: 'admin@starsalign.local' },
    create: {
      email: 'admin@starsalign.local',
      username: 'admin',
      displayName: '管理员',
      passwordHash: '$2b$10$placeholder.hash.replaced.by.first.login.flow',
      isAdmin: true,
      locale: 'zh-CN',
    },
    update: {},
  });

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

    // ----- 模型用途绑定（让后台一处切换，所有调用统一）-----
    {
      key: 'binding.script.analysis.modelId',
      value: 'claude-sonnet-4-5',
      category: 'model_binding',
      description: '剧本分析使用的 LLM modelId（W2.7 Story Compass）',
    },
    {
      key: 'binding.storyboard.generation.modelId',
      value: 'claude-sonnet-4-5',
      category: 'model_binding',
      description: '分镜生成（剧本→单镜列表）使用的 LLM modelId',
    },
    {
      key: 'binding.storyboard.prompt.modelId',
      value: 'claude-sonnet-4-5',
      category: 'model_binding',
      description: '分镜提示词生成（单镜→视频 prompt 含台词/OS）使用的 LLM modelId',
    },
    {
      key: 'binding.script.docx.parser',
      value: 'mammoth',
      category: 'model_binding',
      description: 'docx 解析引擎（mammoth | docx2md）',
    },

    // ----- 分镜业务参数 -----
    {
      key: 'storyboard.maxDurationS',
      value: '15',
      category: 'general',
      description: '合并组单段最大时长（秒），按视频 Provider maxDuration 上限',
    },
    {
      key: 'storyboard.defaultShotDurationS',
      value: '3',
      category: 'general',
      description: '生成分镜时单镜默认时长（秒）',
    },
    {
      key: 'storyboard.autoMergeOnGenerate',
      value: 'true',
      category: 'feature_flag',
      description: '生成分镜时是否自动按 maxDurationS 预合并组',
    },
  ];
  for (const s of systemSettings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      create: s,
      update: { value: s.value, description: s.description, category: s.category },
    });
  }
  console.log(`    ✓ ${systemSettings.length} 条系统设置`);

  console.log('\n✅ 种子数据初始化完成\n');
  console.log('   默认管理员: admin@starsalign.local（首次登录设置密码）');
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
