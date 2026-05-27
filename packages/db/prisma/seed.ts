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

  for (const p of providers) {
    await prisma.providerConfig.upsert({
      where: { providerId: p.providerId },
      create: p as never,
      update: p as never,
    });
  }
  console.log(`    ✓ ${providers.length} 个 Provider`);

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
      content: '你是经验丰富的导演。任务：将剧本拆解为线性分镜。\n\n要求：\n1. 每个镜头标注：景别、机位角度、镜头内容、视频提示词\n2. 镜头时长按 1-15 秒拆分（默认 5 秒），便于视频模型生成\n3. 优先级 S/A/B/C：爽点/反转=S，冲突高潮=A，叙事推进=B，过渡=C\n4. 引用人物/场景/道具时使用 @资产名 占位符',
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
    {
      key: 'storyboard.autoMergeOnGenerate',
      value: 'true',
      category: 'feature_flag',
      description: '生成分镜时是否自动按 maxDurationS 预合并组',
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
