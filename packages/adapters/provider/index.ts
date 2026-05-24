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
export * from './types.js';
export { BaseProvider } from './base.js';
export { SeedanceProvider } from './seedance.js';
export { ClaudeTextProvider } from './claude.js';
export { MockVideoProvider } from './mock-video.js';
export { OpenAICompatTextProvider } from './openai-compat.js';
export { OpenAICompatImageProvider } from './openai-compat-image.js';

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
}

async function loadConfig(providerId: string): Promise<ResolvedConfig> {
  const row = await prisma.providerConfig.findUnique({
    where: { providerId },
  });
  if (!row || !row.isActive) {
    throw new Error(`Provider not configured or inactive: ${providerId}`);
  }

  let apiKey = '';
  if (row.apiKeyEnc) {
    try {
      apiKey = decryptSecret(row.apiKeyEnc);
    } catch (e) {
      console.error(`[providers] decrypt failed for ${providerId}:`, e);
    }
  }
  if (!apiKey && row.apiKeyRef) {
    apiKey = process.env[row.apiKeyRef] ?? '';
  }
  if (!apiKey) {
    throw new Error(
      `Provider ${providerId} has no API key. Set it in Admin UI or env (${row.apiKeyRef ?? 'N/A'}).`,
    );
  }

  // 默认 URL fallback
  const apiUrl =
    row.apiUrl ??
    process.env[`${row.providerId.toUpperCase().replace(/-/g, '_')}_API_URL`] ??
    '';

  return {
    providerId: row.providerId,
    apiUrl,
    apiKey,
    unitPriceCny: Number(row.unitPriceCny),
    unitName: row.unitName,
    defaultParams: (row.defaultParams ?? {}) as Record<string, unknown>,
    maxConcurrent: row.maxConcurrent,
    cacheKey: `${row.providerId}|${row.updatedAt.getTime()}|${row.apiKeyUpdatedAt?.getTime() ?? 0}`,
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

  // W5.4:配置缺失 / 无 key / inactive → fallback Mock,让 UI 端到端可演示
  if (!cfg) {
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
  //   - protocol='openai-compat' → OpenAICompatImageProvider(moyu seedream / FLUX / DALL-E)
  //   - 否则 → MockImageProvider 兜底(picsum.photos,dev 永远可用)
  const cfg = await loadConfig(id).catch(() => null);
  const unitPriceCny = cfg?.unitPriceCny ?? 0;

  // protocol = 'openai-compat':真接入 moyu / OpenAI 兼容图像 endpoint
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

  // Mock 兜底(无 cfg / 无 key / inactive / 无 protocol 声明)
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
  // 第 21 轮 audit:protocol='openai-compat' 优先(moyu / Poe / OpenRouter / OpenAI / 任意 OpenAI 兼容站)
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
    // 豆包使用 OpenAI 兼容协议 — 推荐通过 moyu / 任意 OpenAI 兼容中转,设 protocol='openai-compat'
    throw new Error(
      'Doubao text provider:请改用 protocol="openai-compat" 配置(走 moyu 中转或直连 ARK OpenAI 兼容 endpoint)',
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
  //   - 'moyu' → moyu /v1/video/generations 中转(prompt+duration+ratio 简化结构)
  //   - 'ark'  → Volcengine ARK 原生 /contents/generations/tasks(content+parameters 结构)
  // 默认 'ark'(backward compat)
  const endpointStyle = (cfg.defaultParams.endpointStyle as 'ark' | 'moyu' | undefined) ?? 'ark';
  const defaultModel =
    (cfg.defaultParams.defaultModel as string | undefined) ?? cfg.providerId;

  if (cfg.providerId.startsWith('seedance') || cfg.providerId.startsWith('doubao-seedance') || cfg.providerId.startsWith('moyu-doubao-seedance')) {
    return new SeedanceProvider({
      apiUrl: cfg.apiUrl || (endpointStyle === 'moyu' ? 'https://www.moyu.info/v1' : 'https://ark.cn-beijing.volces.com/api/v3'),
      apiKey: cfg.apiKey,
      defaultModel,
      fastModel: cfg.defaultParams.fastModel as string | undefined,
      maxDuration: Number(cfg.defaultParams.maxDuration ?? 10),
      unitPriceCny: cfg.unitPriceCny,
      endpointStyle,
    });
  }
  // TODO Phase 2:Kling / HappyHorse / 本地模型按上述注释模板接入
  console.warn(
    `[providers] no concrete class for ${cfg.providerId}, falling back to MockVideoProvider`,
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
  apiKeySource: 'db' | 'env' | 'none';
  apiKeyUpdatedAt: Date | null;
  apiKeyUpdatedBy: string | null;
  unitPriceCny: number;
  unitName: string;
  maxConcurrent: number;
  rateLimitRpm: number;
  healthScore: number;
  lastErrorAt: Date | null;
}

/** 列出所有 Provider 的配置摘要（永不返回明文 Key） */
export async function listProviderConfigs(): Promise<ProviderSummary[]> {
  const rows = await prisma.providerConfig.findMany({
    orderBy: [{ kind: 'asc' }, { providerId: 'asc' }],
  });
  return rows.map((r) => {
    const hasDbKey = !!r.apiKeyEnc;
    const hasEnvKey = !!(r.apiKeyRef && process.env[r.apiKeyRef]);
    return {
      providerId: r.providerId,
      displayName: r.displayName,
      kind: r.kind,
      isActive: r.isActive,
      apiUrl: r.apiUrl,
      apiKeyMasked: r.apiKeyMasked,
      apiKeyConfigured: hasDbKey || hasEnvKey,
      apiKeySource: hasDbKey ? 'db' : hasEnvKey ? 'env' : 'none',
      apiKeyUpdatedAt: r.apiKeyUpdatedAt,
      apiKeyUpdatedBy: r.apiKeyUpdatedBy,
      unitPriceCny: Number(r.unitPriceCny),
      unitName: r.unitName,
      maxConcurrent: r.maxConcurrent,
      rateLimitRpm: r.rateLimitRpm,
      healthScore: r.healthScore,
      lastErrorAt: r.lastErrorAt,
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
  await prisma.providerConfig.update({
    where: { providerId },
    data: { isActive, apiKeyUpdatedBy: updatedBy },
  });
  cache.video.delete(providerId);
  cache.image.delete(providerId);
  cache.text.delete(providerId);
  cache.compliance.delete(providerId);
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
