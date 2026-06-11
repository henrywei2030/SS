/**
 * 中转站模型 catalog 静态数据访问层(Phase 1.5.1 · 2026-05-25)
 *
 * 数据源:packages/shared/data/relay-catalogs.json
 * - 用户在 admin UI 选 catalog 某条 model → 创建 ProviderConfig 行,关联到对应 RelayProvider
 * - JSON 静态:中转站发新模型 → 更新 JSON → 用户刷 UI 看到下拉新选项
 *
 * 不存 DB:148 个模型 catalog 在 DB 是死数据(用户实际只用少数)
 */

// 用 import assertion 加载 JSON(Node ESM 标准)
// 注:Next.js 编译 server-side 时支持 JSON 模块导入
import catalog from '../data/relay-catalogs.json' with { type: 'json' };

export type RelayModelKind = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'COMPLIANCE';

export interface RelayCatalogModel {
  modelId: string; // 中转站的模型 id(透传给 provider.generate)
  providerIdSuffix: string; // 拼 providerId 用('claude-sonnet-4-5' → 'moyu-claude-sonnet-4-5')
  displayName: string;
  vendor: string; // 'Anthropic' / 'OpenAI' / 'Google' / '豆包/字节跳动' / etc
  description: string;
  // LLM 计费(优先):modelRate × inputUnits/1M + modelRate × outputRate × outputUnits/1M
  modelRate?: number;
  outputRate?: number;
  group?: string; // 中转站的"分组"(如 'Lite-Claude' / 'default')
  // Image / Video / Audio 计费:unitPriceCny × outputUnits
  unitPriceCny?: number;
  unitName?: 'second' | 'image' | 'ktoken' | 'request' | 'frame';
  // Provider 实现路由
  protocol?: 'openai-compat' | 'anthropic-native' | 'volcengine-native';
  endpointStyle?: 'ark' | 'relay'; // Seedance 用
  /** F5a 泛化路由(七二):'relay-video' = 走 relay 平铺视频协议(seedance 适配器 relay 分支),
   * kling/wan/happyhorse 等中转站视频模型用;与 endpointStyle:'relay' 配套 */
  adapter?: 'relay-video';
  defaultSize?: string; // Image 用
  // Video 时长(秒)
  maxDuration?: number;
  minDuration?: number;
  defaultDuration?: number;
  // 2026-05-27 audit r13:Video 能力声明(对照 moyu docs 真实模型规格)
  supportedResolutions?: Array<'480p' | '720p' | '1080p'>;
  defaultResolution?: '480p' | '720p' | '1080p';
  supportsAudio?: boolean;
  supportsWebSearch?: boolean;
  supportsRefVideo?: boolean;
  supportsRefAudio?: boolean;
  // Embedding 单请求输入条数上限(通义 v4 经 moyu 实测 ≤10,七二 gate 真打发现)
  embeddingBatchSize?: number;
  // UI 精选标记
  isDefault: boolean;
}

export interface RelayCatalogEntry {
  displayName: string;
  defaultApiUrl: string;
  models: Partial<Record<RelayModelKind, RelayCatalogModel[]>>;
}

type CatalogShape = Record<string, RelayCatalogEntry>;

// JSON 含 $schema / $description 元数据(以 $ 开头),过滤
const catalogTyped = catalog as unknown as CatalogShape & {
  $schema?: string;
  $description?: string;
};

/** 列出所有已知中转站 key('moyu' / 'poe' / 'openrouter') */
export function listKnownRelays(): string[] {
  return Object.keys(catalogTyped).filter((k) => !k.startsWith('$'));
}

/** 取某中转站完整元数据 */
export function getRelayCatalog(name: string): RelayCatalogEntry | null {
  if (name.startsWith('$')) return null;
  const entry = catalogTyped[name];
  return entry ?? null;
}

/** 取某中转站某类别的所有模型 */
export function getRelayModels(
  name: string,
  kind: RelayModelKind,
): RelayCatalogModel[] {
  const entry = getRelayCatalog(name);
  if (!entry) return [];
  return entry.models[kind] ?? [];
}

/** 在 catalog 中找单个 model(by providerIdSuffix) */
export function findRelayModel(
  name: string,
  providerIdSuffix: string,
): { kind: RelayModelKind; model: RelayCatalogModel } | null {
  const entry = getRelayCatalog(name);
  if (!entry) return null;
  for (const kind of Object.keys(entry.models) as RelayModelKind[]) {
    const list = entry.models[kind] ?? [];
    const found = list.find((m) => m.providerIdSuffix === providerIdSuffix);
    if (found) return { kind, model: found };
  }
  return null;
}

/** 用于 admin UI 列出 catalog 的简化结构(不含 $meta) */
export interface RelayCatalogSummary {
  name: string;
  displayName: string;
  defaultApiUrl: string;
  totalModels: number;
  defaultCount: number;
  candidateCount: number;
  models: Partial<Record<RelayModelKind, RelayCatalogModel[]>>;
}

export function listCatalogSummaries(): RelayCatalogSummary[] {
  return listKnownRelays().map((name) => {
    const entry = catalogTyped[name]!;
    const allModels = (Object.values(entry.models) as RelayCatalogModel[][])
      .flat()
      .filter(Boolean);
    return {
      name,
      displayName: entry.displayName,
      defaultApiUrl: entry.defaultApiUrl,
      totalModels: allModels.length,
      defaultCount: allModels.filter((m) => m.isDefault).length,
      candidateCount: allModels.filter((m) => !m.isDefault).length,
      models: entry.models,
    };
  });
}
