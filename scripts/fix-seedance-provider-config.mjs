/**
 * 2026-05-27 audit r13 修复脚本
 *
 * 任务:
 *   1. 读所有 VIDEO ProviderConfig(尤其 seedance 系列)
 *   2. 对照 catalog 重建 defaultParams(加 minDuration / supportedResolutions / supports* 等新字段)
 *   3. isActive=true(让 capabilities 不 fallback Mock)
 *   4. 确保 binding.shot.video.providerId 指向 active 的 Seedance 2.0 Fast(用户当前选的)
 *
 * 跑法:pnpm --filter @ss/db exec tsx ../../scripts/fix-seedance-provider-config.mjs
 *  或: node --import tsx scripts/fix-seedance-provider-config.mjs
 */
import { PrismaClient } from '../packages/db/node_modules/@prisma/client/default.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogPath = resolve(__dirname, '../packages/shared/data/relay-catalogs.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

const prisma = new PrismaClient();

async function main() {
  console.log('=== 1/4 当前 Video ProviderConfig 现状 ===');
  const videoConfigs = await prisma.providerConfig.findMany({
    where: { kind: 'VIDEO' },
    include: { relayProvider: true },
  });
  for (const c of videoConfigs) {
    const dp = c.defaultParams ?? {};
    console.log(
      `  ${c.providerId} (isActive=${c.isActive}) defaultModel=${dp.defaultModel} maxDuration=${dp.maxDuration} relay=${c.relayProvider?.name ?? '-'}`,
    );
  }

  console.log('\n=== 2/4 RelayProvider 现状 ===');
  const relays = await prisma.relayProvider.findMany();
  for (const r of relays) {
    console.log(
      `  ${r.name} (isActive=${r.isActive}) apiKeyConfigured=${!!r.apiKeyEnc} apiUrl=${r.apiUrl}`,
    );
  }

  console.log('\n=== 3/4 用 catalog 重建 seedance 系列 defaultParams + 启用 ===');
  const moyuVideo = catalog.moyu?.models?.VIDEO ?? [];
  let updated = 0;
  for (const cfg of videoConfigs) {
    const dp = cfg.defaultParams ?? {};
    const defaultModel = dp.defaultModel ?? cfg.providerId;
    // catalog 用 modelId 精确匹配
    const found =
      moyuVideo.find((m) => m.modelId === defaultModel) ??
      moyuVideo.find((m) => cfg.providerId.endsWith(m.providerIdSuffix));
    if (!found) {
      console.log(`  - skip ${cfg.providerId}(无 catalog 匹配)`);
      continue;
    }
    const newParams = {
      ...dp,
      defaultModel: found.modelId,
      endpointStyle: found.endpointStyle ?? 'relay',
      source: 'relay',
      maxDuration: found.maxDuration,
      ...(found.minDuration !== undefined && { minDuration: found.minDuration }),
      ...(found.defaultDuration !== undefined && { defaultDuration: found.defaultDuration }),
      ...(found.supportedResolutions && { supportedResolutions: found.supportedResolutions }),
      ...(found.defaultResolution && { defaultResolution: found.defaultResolution }),
      ...(found.supportsAudio !== undefined && { supportsAudio: found.supportsAudio }),
      ...(found.supportsWebSearch !== undefined && { supportsWebSearch: found.supportsWebSearch }),
      ...(found.supportsRefVideo !== undefined && { supportsRefVideo: found.supportsRefVideo }),
      ...(found.supportsRefAudio !== undefined && { supportsRefAudio: found.supportsRefAudio }),
    };
    // 删旧字段 maxDurationS / minDurationS(无 S 才是新规范)
    delete newParams.maxDurationS;
    delete newParams.minDurationS;
    await prisma.providerConfig.update({
      where: { providerId: cfg.providerId },
      data: {
        defaultParams: newParams,
        isActive: true,
        // 用 catalog displayName 重建(确保 via {relayName} 后缀)
        displayName: `${found.displayName}(via ${cfg.relayProvider?.displayName ?? cfg.relayProvider?.name ?? '中转站'})`,
        // unitPriceCny 也用 catalog(用户老 seed 可能 0.7,catalog 现在是 0.7 一致)
        unitPriceCny: (found.unitPriceCny ?? 0).toString(),
      },
    });
    console.log(
      `  ✓ ${cfg.providerId} → maxDuration=${newParams.maxDuration} resolutions=${JSON.stringify(newParams.supportedResolutions)} isActive=true`,
    );
    updated++;
  }
  console.log(`  共更新 ${updated} 条`);

  console.log('\n=== 4/4 确认 binding.shot.video.providerId 指向 Seedance 2.0 Fast ===');
  const targetSuffix = 'seedance-2-0-fast-260128';
  const activeSeedance = await prisma.providerConfig.findFirst({
    where: {
      kind: 'VIDEO',
      isActive: true,
      providerId: { contains: 'seedance-2-0-fast' },
    },
  });
  if (!activeSeedance) {
    console.log('  ⚠️ 没找到 active seedance-2-0-fast,跳过 binding 更新');
  } else {
    const current = await prisma.systemSetting.findUnique({
      where: { key: 'binding.shot.video.providerId' },
    });
    if (current?.value === activeSeedance.providerId) {
      console.log(`  ✓ binding 已经指向 ${activeSeedance.providerId},无需改`);
    } else {
      await prisma.systemSetting.upsert({
        where: { key: 'binding.shot.video.providerId' },
        update: { value: activeSeedance.providerId },
        create: {
          key: 'binding.shot.video.providerId',
          value: activeSeedance.providerId,
          category: 'model_binding',
          description: '视频生成使用的 Provider modelId(2026-05-27 audit r13 自动设)',
        },
      });
      console.log(
        `  ✓ binding 从 "${current?.value ?? '空'}" 改为 ${activeSeedance.providerId}`,
      );
    }
  }

  // 额外:shot.video.maxDurationS 这个 SystemSetting 也升 15
  const maxDurSetting = await prisma.systemSetting.findUnique({
    where: { key: 'shot.video.maxDurationS' },
  });
  if (maxDurSetting && maxDurSetting.value !== '15') {
    await prisma.systemSetting.update({
      where: { key: 'shot.video.maxDurationS' },
      data: { value: '15' },
    });
    console.log(`  ✓ shot.video.maxDurationS "${maxDurSetting.value}" → "15"`);
  } else if (!maxDurSetting) {
    console.log(`  - shot.video.maxDurationS 不存在(seed 时应该建)`);
  } else {
    console.log(`  ✓ shot.video.maxDurationS 已经是 15`);
  }

  console.log('\n=== Done ===');
  console.log('下一步:重启 web + worker(让 adapter cache 失效),refresh AIGC 页测试');
}

main()
  .catch((e) => {
    console.error('Script failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
