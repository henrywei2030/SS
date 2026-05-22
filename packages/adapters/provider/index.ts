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

import { prisma } from '@ss/db';

import { decryptSecret, encryptSecret, maskSecret } from '../src/crypto.js';
import { SeedanceProvider } from './seedance.js';
import { ClaudeTextProvider } from './claude.js';
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

export async function getVideoProvider(id: string): Promise<IVideoProvider> {
  const cfg = await loadConfig(id);
  const hit = cache.video.get(id);
  if (hit && hit.cacheKey === cfg.cacheKey) return hit.instance;

  const instance = constructVideoProvider(cfg);
  cache.video.set(id, { instance, cacheKey: cfg.cacheKey });
  return instance;
}

import { MockImageProvider } from './mock-image.js';
export { MockImageProvider } from './mock-image.js';

export async function getImageProvider(id: string): Promise<IImageProvider> {
  // W4-MM.6 临时实现:全部用 MockImageProvider (picsum.photos 占位)
  // 真接入 NanoBanana / GPT Image / 豆包图像 时改这里的 switch
  const cfg = await loadConfig(id).catch(() => null);
  const unitPriceCny = cfg?.unitPriceCny ?? 0;

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
  if (cfg.providerId.startsWith('claude')) {
    return new ClaudeTextProvider({
      apiUrl: cfg.apiUrl || 'https://api.anthropic.com/v1',
      apiKey: cfg.apiKey,
      defaultModel: cfg.providerId,
      unitPriceCny: cfg.unitPriceCny,
    });
  }
  if (cfg.providerId.startsWith('doubao')) {
    // 豆包使用 OpenAI 兼容协议，复用 Claude 类的结构改造（Phase 2 完整实现）
    throw new Error('Doubao text provider implementation deferred to Phase 2');
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

function constructVideoProvider(cfg: ResolvedConfig): IVideoProvider {
  if (cfg.providerId.startsWith('seedance')) {
    return new SeedanceProvider({
      apiUrl: cfg.apiUrl || 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: cfg.apiKey,
      defaultModel: cfg.providerId,
      fastModel: 'seedance-2.0-fast',
      maxDuration: Number(cfg.defaultParams.maxDuration ?? 10),
      unitPriceCny: cfg.unitPriceCny,
    });
  }
  throw new Error(`No video provider class for: ${cfg.providerId}`);
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
