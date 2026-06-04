/**
 * 一次性配置脚本(mac-mini 四九收工)— 把 mac-mini 的 provider/binding/prompt 配置
 * 从「直连(无 key 死配置)」迁到「moyu 中转站」+ 补齐灵感创作所需 prompt/binding。
 *
 * 背景(三遍检查结论):
 *  - mac-mini DB 是旧 seed:缺 3 prompt(script_analysis_main / inspiration_outline /
 *    inspiration_episode)+ inspiration binding
 *  - 9 个 binding 全指向 7 个直连死 provider(无 key),唯一能用的 moyu-claude-opus-4-6
 *    没被引用 → 整个 LLM 链路跑不通
 *
 * 本脚本(全加性,不删任何东西 —— 删直连留到验证后单独做):
 *  1. 建 2 个 moyu 中转 provider:moyu-gpt-image-2(IMAGE)/ moyu-doubao-seedance-2-0(VIDEO)
 *     (复制 admin.provider.createFromCatalog 的 defaultParams 输出,relayProviderId=moyu)
 *  2. 补 3 个缺失 prompt 模板(内容逐字复制自 seed.ts)
 *  3. 改 10 个 binding 指向中转 provider(TEXT→opus / IMAGE→gpt-image / VIDEO→seedance)
 *     + 新增 inspiration binding。compliance / docx 不动。
 *
 * 用法:pnpm exec tsx --env-file=.env.local scripts/config-inspiration-relay.mjs
 */
import { prisma } from '../packages/db/src/index.js';

async function main() {
  // ---- 0. 找 moyu 中转站 ----
  const moyu = await prisma.relayProvider.findUnique({ where: { name: 'moyu' } });
  if (!moyu) throw new Error('❌ moyu 中转站不存在,先在 /admin/providers 配 moyu 中转站 + Token');
  if (!moyu.apiKeyEnc) throw new Error('❌ moyu 中转站没配 Token,先去 /admin/providers 配');
  console.log(`✓ moyu 中转站: ${moyu.id}（有 Token）\n`);

  // ---- 1. 建 2 个中转 provider(IMAGE + VIDEO),复制 createFromCatalog 输出 ----
  const providers = [
    {
      providerId: 'moyu-gpt-image-2',
      displayName: `GPT-Image-2(via ${moyu.displayName})`,
      kind: 'IMAGE',
      unitPriceCny: '0.3',
      unitName: 'image',
      modelRate: '50.4',
      outputRate: '3.75',
      defaultParams: { defaultModel: 'gpt-image-2', source: 'relay', protocol: 'openai-compat' },
    },
    {
      providerId: 'moyu-doubao-seedance-2-0',
      displayName: `Seedance 2.0(via ${moyu.displayName})`,
      kind: 'VIDEO',
      unitPriceCny: '1.2',
      unitName: 'second',
      modelRate: null,
      outputRate: null,
      defaultParams: {
        defaultModel: 'doubao-seedance-2-0-260128',
        source: 'relay',
        endpointStyle: 'relay',
        maxDuration: 15,
        minDuration: 4,
        defaultDuration: 5,
        supportedResolutions: ['480p', '720p'],
        defaultResolution: '720p',
        supportsAudio: true,
        supportsWebSearch: true,
        supportsRefVideo: true,
        supportsRefAudio: true,
      },
    },
  ];
  for (const p of providers) {
    await prisma.providerConfig.upsert({
      where: { providerId: p.providerId },
      create: {
        providerId: p.providerId,
        displayName: p.displayName,
        kind: p.kind,
        apiUrl: null,
        apiKeyEnc: null,
        apiKeyMasked: null,
        unitPriceCny: p.unitPriceCny,
        unitName: p.unitName,
        maxConcurrent: 5,
        rateLimitRpm: 60,
        defaultParams: p.defaultParams,
        modelRate: p.modelRate,
        outputRate: p.outputRate,
        isActive: true,
        relayProviderId: moyu.id,
      },
      update: {
        isActive: true,
        relayProviderId: moyu.id,
        defaultParams: p.defaultParams,
        kind: p.kind,
      },
    });
    console.log(`✓ provider: ${p.providerId}（${p.kind}，走 moyu，active）`);
  }

  // ---- 2. 补 3 个缺失 prompt 模板(内容逐字复制 seed.ts）----
  const prompts = [
    {
      slug: 'script_analysis_main',
      name: '剧本 8 维分析',
      description: '生成 hook/suspense/twist/climax/conflict/dialogue/pace/urgency + 曲线 + 制作计划',
      content:
        '你是经验丰富的短剧编剧 + 制作人。任务:为一集剧本输出 8 维评分(hook/suspense/twist/climax/conflict/dialogue/pace/urgency 各 0-10)+ overall + summary + highlights + issues + curve(每集 8-15 点)+ productionPlan(每镜 priority S/A/B/C)。输出严格 JSON,不要 markdown 包裹。',
    },
    {
      slug: 'inspiration_outline',
      name: '灵感创作 · 分集大纲',
      description: '想法/灵感 → 多集短剧分集大纲(JSON:title + episodes[number/title/synopsis])',
      content:
        '你是资深短剧编剧。根据用户提供的"想法/灵感"和可选参数,产出一部多集竖屏短剧的分集大纲。\n要求:\n- 剧名简洁有钩子;每集标题 + 一句话梗概(冲突/反转/悬念)\n- 集数:若用户给了目标集数就严格按它,否则默认 12 集\n- 节奏紧凑,每集留钩子,符合短剧"强冲突/快反转"特征\n只输出 JSON,不要任何解释或 markdown,格式:\n{"title":"剧名","episodes":[{"number":1,"title":"集标题","synopsis":"本集梗概"}]}',
    },
    {
      slug: 'inspiration_episode',
      name: '灵感创作 · 单集展开',
      description: '剧名 + 本集大纲 → 该集完整剧本(分镜结构 画面/声音,纯文本)',
      content:
        '你是资深短剧编剧。根据剧名、整体想法和"本集大纲",把这一集展开为可直接拍摄的完整剧本。\n要求:\n- 用"分镜"组织:每个分镜含【画面】(场景+动作描述)、【声音】(台词/旁白/OS)\n- 台词口语化、有张力,符合短剧风格;每集 6-12 个分镜\n- 只写本集内容,不要写其他集\n输出纯文本剧本(不要 JSON),开头用"第N集:集标题"。',
    },
  ];
  for (const t of prompts) {
    await prisma.promptTemplate.upsert({
      where: { slug_versionTag: { slug: t.slug, versionTag: 'v1' } },
      create: {
        slug: t.slug,
        versionTag: 'v1',
        category: 'SCRIPT_STORYBOARD',
        name: t.name,
        description: t.description,
        content: t.content,
        varsJson: {},
      },
      update: { name: t.name, description: t.description, content: t.content },
    });
    console.log(`✓ prompt: ${t.slug}`);
  }

  // ---- 3. 改 binding 指向中转 provider + 加 inspiration binding ----
  const bindings = [
    ['binding.script.analysis.modelId', 'moyu-claude-opus-4-6', '剧本 8 维分析 LLM'],
    ['binding.storyboard.generation.modelId', 'moyu-claude-opus-4-6', '分镜生成 LLM'],
    ['binding.storyboard.prompt.modelId', 'moyu-claude-opus-4-6', '分镜提示词 LLM'],
    ['binding.asset.breakdown.modelId', 'moyu-claude-opus-4-6', '资产拆解 LLM'],
    ['binding.inspiration.generation.modelId', 'moyu-claude-opus-4-6', '灵感创作(想法→多集剧本)LLM'],
    ['binding.asset.image.providerId', 'moyu-gpt-image-2', '资产图片生成'],
    ['binding.asset.panorama.providerId', 'moyu-gpt-image-2', '全景场景生成'],
    ['binding.shot.video.providerId', 'moyu-doubao-seedance-2-0', '分镜视频生成'],
  ];
  for (const [key, value, desc] of bindings) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value, category: 'model_binding', description: desc },
      update: { value }, // 只改 value,保留原 description
    });
    console.log(`✓ binding: ${key} → ${value}`);
  }

  console.log('\n✅ 配置完成（全加性，未删任何直连 provider）');
  console.log('   下一步:真打验证灵感创作 → 确认能跑通后,再删 6 个直连死 provider');
}

main()
  .catch((e) => {
    console.error('❌ 失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
