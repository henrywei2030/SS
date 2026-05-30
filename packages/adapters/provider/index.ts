/**
 * Provider 注册中心 — 按需懒加载，DB 优先
 *
 * 加载流程：
 *   1. 业务调用 await getVideoProvider('seedance-2.0')
 *   2. 查 ProviderConfig 表
 *   3. 优先用 apiKeyEnc 解密；为空则 fallback 到 env (apiKeyRef)
 *   4. 构造 Provider 实例，缓存（key = providerId + updatedAt 时间戳）
 *   5. 当用户在 Admin UI 修改 API Key（updatedAt 变了），缓存自动失效
 *
 * 这样 API Key 完全由后台管理，env 仅作私有部署的兜底通道。
 */
import { ProviderError } from '@ss/shared';

export * from './types.js';
export { BaseProvider } from './base.js';
export { SeedanceProvider } from './seedance.js';
export { ClaudeTextProvider } from './claude.js';
export { MockVideoProvider } from './mock-video.js';
export { OpenAICompatTextProvider } from './openai-compat.js';
export { OpenAICompatImageProvider } from './openai-compat-image.js';
// Phase 1.5 P0-5:OpenAI 兼容中转站素材库 asset:// 引用机制
export { RelayAssetProvider, getRelayAssetProvider, getRelayDefaultGroupId } from './relay-asset.js';
export type { RelayAsset, RelayAssetType, RelayAssetStatus, RelayCreateAssetOpts } from './relay-asset.js';

import { prisma } from '@ss/db';

import { decryptSecret, encryptSecret, maskSecret } from '../src/crypto.js';
import { SeedanceProvider } from './seedance.js';
import { ClaudeTextProvider } from './claude.js';
import { MockVideoProvider } from './mock-video.js';
import { OpenAICompatTextProvider } from './openai-compat.js';
import { OpenAICompatImageProvider } from './openai-compat-image.js';
import type {
  IVideoProvider,
  IImageProvider,
  ITextProvider,
  IComplianceProvider,
} from './types.js';

interface CacheEntry<T> {
  instance: T;
  cacheKey: string; // providerId + updatedAt
}

const cache = {
  video: new Map<string, CacheEntry<IVideoProvider>>(),
  image: new Map<string, CacheEntry<IImageProvider>>(),
  text: new Map<string, CacheEntry<ITextProvider>>(),
  compliance: new Map<string, CacheEntry<IComplianceProvider>>(),
};

// ---------------------------------------------------------------------------
// 内部工具：从 ProviderConfig 取得明文 API Key
// ---------------------------------------------------------------------------

interface ResolvedConfig {
  providerId: string;
  apiUrl: string;
  apiKey: string;
  unitPriceCny: number;
  unitName: string;
  defaultParams: Record<string, unknown>;
  maxConcurrent: number;
  cacheKey: string;
  // Phase 1.5 P0-2 2 倍率(主次重审 v2.1)
  modelRate?: number;
  outputRate?: number;
}

async function loadConfig(providerId: string): Promise<ResolvedConfig> {
  // Phase 1.5.1:include relayProvider 关联,中转站凭证用
  const row = await prisma.providerConfig.findUnique({
    where: { providerId },
    include: { relayProvider: true },
  });
  // r5:精确区分 not configured / inactive,给前端可执行的提示
  if (!row) {
    throw new Error(
      `Provider "${providerId}" 不存在于 ProviderConfig — 检查 /admin/bindings 选的 modelId 是否拼写正确,或在 /admin/providers 从中转站 catalog 添加该模型`,
    );
  }
  if (!row.isActive) {
    throw new Error(
      `Provider "${providerId}" (${row.displayName}) 已停用 — 去 /admin/providers 找到该模型卡片点 Toggle 开关启用`,
    );
  }

  let apiKey = '';
  let apiUrl: string;
  let cacheKeyExtra = '';
  // r8 audit P1:decrypt 失败语义化 — 区分"密钥损坏"vs"未配置"两种 0 apiKey 状态
  let decryptFailed = false;

  // Phase 1.5.1:relayProviderId 非空 → 从 RelayProvider 拉 apiKey/apiUrl
  if (row.relayProviderId && row.relayProvider) {
    if (!row.relayProvider.isActive) {
      throw new Error(
        `Provider ${providerId} 关联的中转站 "${row.relayProvider.name}" 已停用 — 去 /admin/providers 启用`,
      );
    }
    if (row.relayProvider.apiKeyEnc) {
      try {
        apiKey = decryptSecret(row.relayProvider.apiKeyEnc);
      } catch (e) {
        decryptFailed = true;
        console.error(
          `[providers] decrypt relayProvider key failed for ${row.relayProvider.name}:`,
          e,
        );
      }
    }
    apiUrl = row.relayProvider.apiUrl ?? '';
    cacheKeyExtra = `relay|${row.relayProvider.id}|${row.relayProvider.apiKeyUpdatedAt?.getTime() ?? 0}|${row.relayProvider.updatedAt.getTime()}`;
  } else {
    // 直连 Provider:apiKey/apiUrl 从 ProviderConfig 自己的字段拉
    if (row.apiKeyEnc) {
      try {
        apiKey = decryptSecret(row.apiKeyEnc);
      } catch (e) {
        decryptFailed = true;
        console.error(`[providers] decrypt failed for ${providerId}:`, e);
      }
    }
    if (!apiKey && row.apiKeyRef) {
      apiKey = process.env[row.apiKeyRef] ?? '';
    }
    apiUrl =
      row.apiUrl ??
      process.env[`${row.providerId.toUpperCase().replace(/-/g, '_')}_API_URL`] ??
      '';
    cacheKeyExtra = `direct|${row.apiKeyUpdatedAt?.getTime() ?? 0}`;
  }

  if (!apiKey) {
    // r8 audit P1:decrypt 失败明确告知,跟"未配置"两种状态分开
    if (decryptFailed) {
      throw new Error(
        `Provider ${providerId} 的 API Key 解密失败 — 可能 APP_MASTER_KEY 已改 / 数据库迁移丢密钥 / 密文损坏。` +
        `去 /admin/providers 重新配置 Token`,
      );
    }
    const hint = row.relayProviderId
      ? `去 /admin/providers 顶部"${row.relayProvider?.displayName ?? '中转站'}"卡片配 Token`
      : `去 /admin/providers 设置 ${providerId} 的独立 API Key (或配 env ${row.apiKeyRef ?? 'N/A'})`;
    throw new Error(`Provider ${providerId} 未配置 API Key. ${hint}`);
  }

  return {
    providerId: row.providerId,
    apiUrl,
    apiKey,
    unitPriceCny: Number(row.unitPriceCny),
    unitName: row.unitName,
    defaultParams: (row.defaultParams ?? {}) as Record<string, unknown>,
    maxConcurrent: row.maxConcurrent,
    cacheKey: `${row.providerId}|${row.updatedAt.getTime()}|${cacheKeyExtra}`,
    // Phase 1.5 P0-2:2 倍率(modelRate 非空时 OpenAICompatTextProvider 优先用,否则 unitPriceCny)
    modelRate: row.modelRate != null ? Number(row.modelRate) : undefined,
    outputRate: row.outputRate != null ? Number(row.outputRate) : undefined,
  };
}

// ---------------------------------------------------------------------------
// 公开 API：按需取 Provider
// ---------------------------------------------------------------------------

/**
 * 获取视频 Provider(W5.4 多 provider 开放架构)
 *
 * 选择优先级:
 *   1. ProviderConfig 表里有这条记录且 isActive=true → 用真 Provider(SeedanceProvider 等)
 *   2. 没记录 / 无 key / inactive → fallback 到 MockVideoProvider(返公开样片,让 UI 跑通)
 *
 * 加新厂商(Kling / HappyHorse / 本地模型)流程:
 *   1. 写 `packages/adapters/provider/<name>.ts` 实现 IVideoProvider 接口
 *   2. 在 `constructVideoProvider` 加 `if (cfg.providerId.startsWith('xxx-')) return new XxxProvider(...)`
 *   3. seed.ts 加 ProviderConfig 一行(displayName / unitPriceCny / apiUrl 等)
 *   4. /admin/providers 录入 API Key
 *   5. SystemSetting `binding.shot.video.providerId` 切到 'xxx-...'(或前端 input 覆盖)
 *
 * aigcRouter / generateVideo 接口不变,业务层无感知。
 */
export async function getVideoProvider(id: string): Promise<IVideoProvider> {
  const cfg = await loadConfig(id).catch(() => null);

  // W5.4:配置缺失 / 无 key / inactive → dev fallback Mock,让 UI 端到端可演示
  // 四十收工 P1:prod 不静默 Mock — 否则配置损坏时 worker 写 Mock 样片标 SUCCESS + 按
  //   unitPriceCny=0 错误退费,用户以为生成了真视频(真金白银错觉)。prod 应抛错让用户去
  //   /admin/providers 修配置(跟 getTextProvider 抛错语义一致)。
  if (!cfg) {
    if (process.env.NODE_ENV === 'production') {
      throw new ProviderError(
        id,
        `视频 Provider "${id}" 配置缺失 / 无 API Key / 已停用 — 去 /admin/providers 检查(生产环境不 fallback Mock)`,
      );
    }
    const cacheKey = `${id}-mock-noconfig`;
    const hit = cache.video.get(id);
    if (hit && hit.cacheKey === cacheKey) return hit.instance;
    const instance = new MockVideoProvider({ providerId: id, unitPriceCny: 0 });
    cache.video.set(id, { instance, cacheKey });
    return instance;
  }

  const hit = cache.video.get(id);
  if (hit && hit.cacheKey === cfg.cacheKey) return hit.instance;
  const instance = constructVideoProvider(cfg);
  cache.video.set(id, { instance, cacheKey: cfg.cacheKey });
  return instance;
}

import { MockImageProvider } from './mock-image.js';
export { MockImageProvider } from './mock-image.js';

export async function getImageProvider(id: string): Promise<IImageProvider> {
  // 第 21 轮 audit:真接入路径
  //   - protocol='openai-compat' → OpenAICompatImageProvider(中转站 seedream / FLUX / DALL-E)
  //   - 否则 → MockImageProvider 兜底(picsum.photos,dev 永远可用)
  const cfg = await loadConfig(id).catch(() => null);
  const unitPriceCny = cfg?.unitPriceCny ?? 0;

  // protocol = 'openai-compat':真接入中转站 / OpenAI 兼容图像 endpoint
  if (cfg && (cfg.defaultParams.protocol as string | undefined) === 'openai-compat') {
    const cacheKey = cfg.cacheKey;
    const hit = cache.image.get(id);
    if (hit && hit.cacheKey === cacheKey) return hit.instance;

    const defaultModel =
      (cfg.defaultParams.defaultModel as string | undefined) ?? cfg.providerId;
    const instance = new OpenAICompatImageProvider({
      apiUrl: cfg.apiUrl,
      apiKey: cfg.apiKey,
      defaultModel,
      unitPriceCny: cfg.unitPriceCny,
      displayName: cfg.defaultParams.displayName as string | undefined,
      maxConcurrent: cfg.maxConcurrent,
      defaultSize: cfg.defaultParams.defaultSize as string | undefined,
    });
    cache.image.set(id, { instance, cacheKey });
    return instance;
  }

  // 四十收工 P1:走到 Mock 兜底说明无真实图像 provider(无 cfg / 无 key / inactive / protocol 非 openai-compat)。
  //   prod 不静默 Mock(假成功 + 错误退费风险),抛错让用户去 /admin/providers 修;dev 保持 Mock 演示。
  if (process.env.NODE_ENV === 'production') {
    throw new ProviderError(
      id,
      `图像 Provider "${id}" 未真实接入(配置缺失 / 无 key / protocol 非 openai-compat)— 去 /admin/providers 检查(生产环境不 fallback Mock)`,
    );
  }
  // Mock 兜底(dev 演示用,picsum 占位图)
  const hit = cache.image.get(id);
  const cacheKey = `${id}-mock-${cfg?.cacheKey ?? 'noconfig'}`;
  if (hit && hit.cacheKey === cacheKey) return hit.instance;

  const instance = new MockImageProvider({ providerId: id, unitPriceCny });
  cache.image.set(id, { instance, cacheKey });
  return instance;
}

export async function getTextProvider(id: string): Promise<ITextProvider> {
  const cfg = await loadConfig(id);
  // 简单缓存：每个 providerId 一个实例（修改 key 后通过 cacheKey 失效）
  const hit = textInstances.get(id);
  if (hit && hit.cacheKey === cfg.cacheKey) return hit.instance;
  const instance = constructTextProvider(cfg);
  textInstances.set(id, { instance, cacheKey: cfg.cacheKey });
  return instance;
}

const textInstances = new Map<string, { instance: ITextProvider; cacheKey: string }>();

function constructTextProvider(cfg: ResolvedConfig): ITextProvider {
  // 第 21 轮 audit:protocol='openai-compat' 优先(任意 OpenAI 兼容中转站 / Poe / OpenRouter / OpenAI 直连)
  // defaultParams.protocol 由 admin 后台 / seed.ts 显式声明,不依赖 URL parsing
  const protocol = cfg.defaultParams.protocol as string | undefined;
  if (protocol === 'openai-compat') {
    const defaultModel =
      (cfg.defaultParams.defaultModel as string | undefined) ?? cfg.providerId;
    return new OpenAICompatTextProvider({
      apiUrl: cfg.apiUrl,
      apiKey: cfg.apiKey,
      defaultModel,
      unitPriceCny: cfg.unitPriceCny,
      inputUnitPriceCny: cfg.defaultParams.inputUnitPriceCny as number | undefined,
      outputUnitPriceCny: cfg.defaultParams.outputUnitPriceCny as number | undefined,
      displayName: cfg.defaultParams.displayName as string | undefined,
      maxConcurrent: cfg.maxConcurrent,
      // Phase 1.5 P0-2:2 倍率优先(modelRate 非空时跳过 inputUnitPrice/outputUnitPrice)
      modelRate: cfg.modelRate,
      outputRate: cfg.outputRate,
    });
  }
  // Anthropic 直连原生协议
  if (cfg.providerId.startsWith('claude')) {
    return new ClaudeTextProvider({
      apiUrl: cfg.apiUrl || 'https://api.anthropic.com/v1',
      apiKey: cfg.apiKey,
      defaultModel: cfg.providerId,
      unitPriceCny: cfg.unitPriceCny,
    });
  }
  if (cfg.providerId.startsWith('doubao')) {
    // 豆包使用 OpenAI 兼容协议 — 推荐通过任意 OpenAI 兼容中转站,设 protocol='openai-compat'
    throw new Error(
      'Doubao text provider:请改用 protocol="openai-compat" 配置(走任意 OpenAI 兼容中转站或直连 ARK OpenAI 兼容 endpoint)',
    );
  }
  throw new Error(`No text provider class for: ${cfg.providerId}`);
}

export async function getComplianceProvider(id: string): Promise<IComplianceProvider> {
  // Phase 1: 未实现，留待 W4 人物合规接入火山引擎
  void id;
  throw new Error('Compliance provider not implemented yet (W4 milestone)');
}

// ---------------------------------------------------------------------------
// 构造器：把 ResolvedConfig 映射到具体 Provider 类
// ---------------------------------------------------------------------------

/**
 * 视频 Provider 构造器 — switch 模式,每加一个厂商加一个 if 分支
 *
 * Convention:providerId 用厂商前缀(`seedance-` / `kling-` / `happyhorse-` / `local-`)
 * 区分,后缀是模型版本(`seedance-2.0` / `kling-1.5` / `happyhorse-pro` / `local-mistral-vlm`)
 *
 * 例:接入 Kling
 *   ```ts
 *   if (cfg.providerId.startsWith('kling')) {
 *     return new KlingProvider({
 *       apiUrl: cfg.apiUrl || 'https://api.kling.com/v1',
 *       apiKey: cfg.apiKey,
 *       defaultModel: cfg.providerId,
 *       maxDuration: Number(cfg.defaultParams.maxDuration ?? 10),
 *       unitPriceCny: cfg.unitPriceCny,
 *     });
 *   }
 *   ```
 *
 * 例:接入本地模型(无 key,跑 localhost)
 *   ```ts
 *   if (cfg.providerId.startsWith('local-')) {
 *     return new LocalVideoProvider({
 *       apiUrl: cfg.apiUrl || 'http://localhost:8000',
 *       defaultModel: cfg.providerId,
 *       unitPriceCny: 0,  // 本地无 token 成本
 *     });
 *   }
 *   ```
 *
 * 完全找不到匹配 → 返 MockVideoProvider 兜底(而不是抛错),让 dev 环境永远可用。
 */
function constructVideoProvider(cfg: ResolvedConfig): IVideoProvider {
  // 第 21 轮 audit:endpointStyle 由 defaultParams 显式声明
  //   - 'relay' → 中转站 /v1/video/generations(OpenAI 兼容简化结构:prompt+duration+ratio)
  //   - 'ark'  → Volcengine ARK 原生 /contents/generations/tasks(content+parameters 结构)
  // 默认 'ark'(backward compat)
  const endpointStyle = (cfg.defaultParams.endpointStyle as 'ark' | 'relay' | undefined) ?? 'ark';
  const defaultModel =
    (cfg.defaultParams.defaultModel as string | undefined) ?? cfg.providerId;

  // 2026-05-27 audit r12 P0:adapter 路由原来只看 providerId.startsWith,
  // 但 admin 添加中转站模型时 providerId = `${relayName}-${suffix}`,
  // 任意 relayName(moyu / openrouter / poe / 自定义)都不命中 startsWith('seedance/doubao-seedance')
  // → fallback Mock(用户假装跑了 Seedance,实际返 sintel.mp4 样片 + 错单价)。
  // 改基于 defaultModel(catalog 规范化字段)判断,覆盖任意 relay 前缀。
  const adapterHint =
    typeof cfg.defaultParams.adapter === 'string'
      ? (cfg.defaultParams.adapter as string).toLowerCase()
      : null;
  const isSeedance =
    adapterHint === 'seedance' ||
    defaultModel.includes('seedance') ||
    cfg.providerId.startsWith('seedance') ||
    cfg.providerId.startsWith('doubao-seedance') ||
    cfg.providerId.startsWith('relay-doubao-seedance');

  if (isSeedance) {
    return new SeedanceProvider({
      apiUrl: cfg.apiUrl || (endpointStyle === 'relay' ? '' : 'https://ark.cn-beijing.volces.com/api/v3'),
      apiKey: cfg.apiKey,
      defaultModel,
      fastModel: cfg.defaultParams.fastModel as string | undefined,
      maxDuration: Number(cfg.defaultParams.maxDuration ?? 15),
      unitPriceCny: cfg.unitPriceCny,
      endpointStyle,
    });
  }
  // TODO Phase 2:Kling / HappyHorse / 本地模型按上述注释模板接入
  console.warn(
    `[providers] no concrete class for ${cfg.providerId} (defaultModel=${defaultModel}), falling back to MockVideoProvider`,
  );
  return new MockVideoProvider({
    providerId: cfg.providerId,
    unitPriceCny: cfg.unitPriceCny,
  });
}

// ---------------------------------------------------------------------------
// Admin 管理接口（W2 admin tRPC router 调这些函数）
// ---------------------------------------------------------------------------

export interface ProviderSummary {
  providerId: string;
  displayName: string;
  kind: string;
  isActive: boolean;
  apiUrl: string | null;
  apiKeyMasked: string | null;
  apiKeyConfigured: boolean;
  apiKeySource: 'db' | 'env' | 'relay' | 'none'; // 'relay':apiKey 来自 RelayProvider
  apiKeyUpdatedAt: Date | null;
  apiKeyUpdatedBy: string | null;
  unitPriceCny: number;
  unitName: string;
  maxConcurrent: number;
  rateLimitRpm: number;
  healthScore: number;
  lastErrorAt: Date | null;
  // Phase 1.5 P0-2 — 2 倍率(modelRate 非空时优先于 unitPriceCny)
  modelRate: number | null;
  outputRate: number | null;
  // Phase 1.5.1 — UI 展示用元数据(从 defaultParams 解出)
  defaultModel: string | null;
  source: 'relay' | 'subscription' | 'direct' | 'local' | null;
  // Phase 1.5.1 — 中转站凭证关联
  relayProviderId: string | null;
  relayProviderName: string | null;
  relayProviderDisplayName: string | null;
}

/** 列出所有 Provider 的配置摘要（永不返回明文 Key） */
export async function listProviderConfigs(): Promise<ProviderSummary[]> {
  const rows = await prisma.providerConfig.findMany({
    orderBy: [{ kind: 'asc' }, { providerId: 'asc' }],
    include: { relayProvider: true },
  });
  return rows.map((r) => {
    const dp = (r.defaultParams ?? {}) as Record<string, unknown>;
    const isRelay = r.relayProviderId !== null && r.relayProvider !== null;
    // 凭证优先级:RelayProvider(中转站) > ProviderConfig.apiKeyEnc(直连) > env(fallback)
    const hasRelayKey = isRelay && !!r.relayProvider?.apiKeyEnc;
    const hasDbKey = !!r.apiKeyEnc;
    const hasEnvKey = !!(r.apiKeyRef && process.env[r.apiKeyRef]);
    const configured = hasRelayKey || hasDbKey || hasEnvKey;
    const source: ProviderSummary['apiKeySource'] = hasRelayKey
      ? 'relay'
      : hasDbKey
        ? 'db'
        : hasEnvKey
          ? 'env'
          : 'none';
    // 中转站 provider 的 apiUrl / apiKeyMasked 显示从 RelayProvider 继承
    const effectiveApiUrl = isRelay ? (r.relayProvider?.apiUrl ?? null) : r.apiUrl;
    const effectiveMasked = isRelay
      ? (r.relayProvider?.apiKeyMasked ?? null)
      : r.apiKeyMasked;
    const effectiveUpdatedAt = isRelay
      ? (r.relayProvider?.apiKeyUpdatedAt ?? null)
      : r.apiKeyUpdatedAt;
    const effectiveUpdatedBy = isRelay
      ? (r.relayProvider?.apiKeyUpdatedBy ?? null)
      : r.apiKeyUpdatedBy;
    return {
      providerId: r.providerId,
      displayName: r.displayName,
      kind: r.kind,
      isActive: r.isActive,
      apiUrl: effectiveApiUrl,
      apiKeyMasked: effectiveMasked,
      apiKeyConfigured: configured,
      apiKeySource: source,
      apiKeyUpdatedAt: effectiveUpdatedAt,
      apiKeyUpdatedBy: effectiveUpdatedBy,
      unitPriceCny: Number(r.unitPriceCny),
      unitName: r.unitName,
      maxConcurrent: r.maxConcurrent,
      rateLimitRpm: r.rateLimitRpm,
      healthScore: r.healthScore,
      lastErrorAt: r.lastErrorAt,
      // Phase 1.5 P0-2 — 2 倍率
      modelRate: r.modelRate != null ? Number(r.modelRate) : null,
      outputRate: r.outputRate != null ? Number(r.outputRate) : null,
      // Phase 1.5.1 — UI 元数据
      defaultModel: (dp.defaultModel as string | undefined) ?? null,
      source: (dp.source as 'relay' | 'subscription' | 'direct' | 'local' | undefined) ?? null,
      // Phase 1.5.1 — 中转站凭证关联
      relayProviderId: r.relayProviderId,
      relayProviderName: r.relayProvider?.name ?? null,
      relayProviderDisplayName: r.relayProvider?.displayName ?? null,
    };
  });
}

/** 设置某 Provider 的 API Key（加密入库 + 自动脱敏） */
export async function setProviderApiKey(
  providerId: string,
  plaintext: string,
  updatedBy: string,
): Promise<void> {
  if (!plaintext || plaintext.length < 8) {
    throw new Error('API key too short (min 8 chars)');
  }
  const enc = encryptSecret(plaintext);
  const masked = maskSecret(plaintext);
  await prisma.providerConfig.update({
    where: { providerId },
    data: {
      apiKeyEnc: enc,
      apiKeyMasked: masked,
      apiKeyUpdatedAt: new Date(),
      apiKeyUpdatedBy: updatedBy,
    },
  });
  // 失效缓存
  cache.video.delete(providerId);
  cache.image.delete(providerId);
  cache.text.delete(providerId);
  cache.compliance.delete(providerId);
}

/** 清除某 Provider 的 API Key（退回到 env fallback 或不可用） */
export async function clearProviderApiKey(providerId: string, updatedBy: string): Promise<void> {
  await prisma.providerConfig.update({
    where: { providerId },
    data: {
      apiKeyEnc: null,
      apiKeyMasked: null,
      apiKeyUpdatedAt: new Date(),
      apiKeyUpdatedBy: updatedBy,
    },
  });
  cache.video.delete(providerId);
  cache.image.delete(providerId);
  cache.text.delete(providerId);
  cache.compliance.delete(providerId);
}

/** 启停某 Provider */
export async function setProviderActive(
  providerId: string,
  isActive: boolean,
  updatedBy: string,
): Promise<void> {
  // Audit 修(P0-1):isActive 变更跟 apiKey 无关,不污染 apiKeyUpdatedBy(只在 setApiKey 写)
  await prisma.providerConfig.update({
    where: { providerId },
    data: { isActive },
  });
  void updatedBy; // 保留参数兼容旧 caller,但不写入 apiKey 字段
  cache.video.delete(providerId);
  cache.image.delete(providerId);
  cache.text.delete(providerId);
  cache.compliance.delete(providerId);
}

// ---------------------------------------------------------------------------
// Phase 1.5.1 中转站凭证 multi-credential(2026-05-25 升级)
// ---------------------------------------------------------------------------
// 设计:RelayProvider 表(moyu / poe / openrouter / 自定义)独立管理凭证。
// 1 个 RelayProvider = 1 个 apiUrl + 1 个 token + 关联多个 ProviderConfig。
// loadConfig 中 relayProviderId 非空时,从 RelayProvider 拉 apiKey/apiUrl。
// ---------------------------------------------------------------------------

export interface RelayProviderSummary {
  id: string;
  name: string;
  displayName: string;
  apiUrl: string | null;
  catalogKey: string | null;
  apiKeyMasked: string | null;
  apiKeyUpdatedAt: Date | null;
  apiKeyUpdatedBy: string | null;
  apiKeyConfigured: boolean;
  isActive: boolean;
  notes: string | null;
  attachedProviderCount: number; // 关联的 ProviderConfig 数
  attachedActiveCount: number; // 关联的 active ProviderConfig 数
  createdAt: Date;
  updatedAt: Date;
}

function invalidateRelayProviderCache(relayProviderId: string): void {
  // 失效所有关联到该 RelayProvider 的 ProviderConfig 缓存
  // 简化:扫所有 cache key 不可行(key 是 providerId),需 DB 查后 invalidate
  // 性能 OK:cache 失效是 set 操作 + 数量有限
  // 真实现:cache 内不存 relayProviderId,只能 invalidate 整个 cache
  cache.video.clear();
  cache.image.clear();
  cache.text.clear();
  cache.compliance.clear();
  void relayProviderId;
}

/** 列出所有中转站凭证 */
export async function listRelayProviders(): Promise<RelayProviderSummary[]> {
  const rows = await prisma.relayProvider.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      providers: {
        select: { isActive: true },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    displayName: r.displayName,
    apiUrl: r.apiUrl,
    catalogKey: r.catalogKey,
    apiKeyMasked: r.apiKeyMasked,
    apiKeyUpdatedAt: r.apiKeyUpdatedAt,
    apiKeyUpdatedBy: r.apiKeyUpdatedBy,
    apiKeyConfigured: !!r.apiKeyEnc,
    isActive: r.isActive,
    notes: r.notes,
    attachedProviderCount: r.providers.length,
    attachedActiveCount: r.providers.filter((p) => p.isActive).length,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/** 创建中转站凭证 */
export async function createRelayProvider(opts: {
  name: string;
  displayName: string;
  apiUrl?: string;
  catalogKey?: string;
  notes?: string;
  updatedBy: string;
}): Promise<RelayProviderSummary> {
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(opts.name)) {
    throw new Error('name 必须 kebab-case(小写字母+数字+-,首末非 -)');
  }
  const created = await prisma.relayProvider.create({
    data: {
      name: opts.name,
      displayName: opts.displayName,
      apiUrl: opts.apiUrl,
      catalogKey: opts.catalogKey,
      notes: opts.notes,
      isActive: true,
      apiKeyUpdatedBy: opts.updatedBy,
    },
  });
  return {
    id: created.id,
    name: created.name,
    displayName: created.displayName,
    apiUrl: created.apiUrl,
    catalogKey: created.catalogKey,
    apiKeyMasked: null,
    apiKeyUpdatedAt: null,
    apiKeyUpdatedBy: created.apiKeyUpdatedBy,
    apiKeyConfigured: false,
    isActive: created.isActive,
    notes: created.notes,
    attachedProviderCount: 0,
    attachedActiveCount: 0,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

/** 更新中转站凭证(基本字段) */
export async function updateRelayProvider(
  id: string,
  data: {
    displayName?: string;
    apiUrl?: string;
    notes?: string;
    isActive?: boolean;
  },
  updatedBy: string,
): Promise<void> {
  // Audit 修(P0-1):displayName/apiUrl/notes/isActive 变更不污染 apiKeyUpdatedBy(只 setApiKey 写)
  // Audit 修(P1-4):停用中转站时级联停用所有关联 ProviderConfig(否则 UI 显示假启用)
  await prisma.$transaction(async (tx) => {
    await tx.relayProvider.update({
      where: { id },
      data,
    });
    if (data.isActive === false) {
      await tx.providerConfig.updateMany({
        where: { relayProviderId: id, isActive: true },
        data: { isActive: false },
      });
    }
  });
  void updatedBy;
  invalidateRelayProviderCache(id);
}

/** 设置中转站 API Key */
export async function setRelayProviderApiKey(
  id: string,
  plaintext: string,
  updatedBy: string,
): Promise<void> {
  if (!plaintext || plaintext.length < 8) {
    throw new Error('API key too short (min 8 chars)');
  }
  const enc = encryptSecret(plaintext);
  const masked = maskSecret(plaintext);
  await prisma.relayProvider.update({
    where: { id },
    data: {
      apiKeyEnc: enc,
      apiKeyMasked: masked,
      apiKeyUpdatedAt: new Date(),
      apiKeyUpdatedBy: updatedBy,
    },
  });
  invalidateRelayProviderCache(id);
}

/** 清除中转站 API Key */
export async function clearRelayProviderApiKey(
  id: string,
  updatedBy: string,
): Promise<void> {
  await prisma.relayProvider.update({
    where: { id },
    data: {
      apiKeyEnc: null,
      apiKeyMasked: null,
      apiKeyUpdatedAt: new Date(),
      apiKeyUpdatedBy: updatedBy,
    },
  });
  invalidateRelayProviderCache(id);
}

/** 删除中转站凭证(拒删:还有关联 active ProviderConfig 的) */
export async function deleteRelayProvider(id: string): Promise<void> {
  const cfg = await prisma.relayProvider.findUnique({
    where: { id },
    include: { providers: { select: { providerId: true, isActive: true } } },
  });
  if (!cfg) throw new Error('RelayProvider not found');
  const activeCount = cfg.providers.filter((p) => p.isActive).length;
  if (activeCount > 0) {
    throw new Error(
      `中转站 "${cfg.name}" 还有 ${activeCount} 个 active 模型关联,先停用所有模型再删`,
    );
  }
  // Audit 修(P1-1):删除前级联停用关联的非 active provider(防 onDelete:SetNull 后 UI 显示假启用)
  // 实际上上面已 check activeCount=0,这里是防御性双保险
  await prisma.$transaction(async (tx) => {
    await tx.providerConfig.updateMany({
      where: { relayProviderId: id },
      data: { isActive: false },
    });
    // onDelete: SetNull 会把 relayProviderId 自动设 null
    await tx.relayProvider.delete({ where: { id } });
  });
  invalidateRelayProviderCache(id);
}

/** 调试用：列出已注册 + 已缓存 */
export function debugProviders(): { kind: string; id: string; cached: boolean }[] {
  const out: { kind: string; id: string; cached: boolean }[] = [];
  for (const [id] of cache.video) out.push({ kind: 'video', id, cached: true });
  for (const [id] of cache.image) out.push({ kind: 'image', id, cached: true });
  for (const [id] of cache.text) out.push({ kind: 'text', id, cached: true });
  for (const [id] of cache.compliance) out.push({ kind: 'compliance', id, cached: true });
  return out;
}

/** 测试用：清空所有缓存 */
export function resetProviderCache(): void {
  cache.video.clear();
  cache.image.clear();
  cache.text.clear();
  cache.compliance.clear();
}
