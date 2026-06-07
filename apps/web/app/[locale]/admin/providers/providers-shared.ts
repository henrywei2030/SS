// ============================================================================
// 类型
// ============================================================================

export type Provider = {
  providerId: string;
  displayName: string;
  kind: string;
  isActive: boolean;
  apiUrl: string | null;
  apiKeyMasked: string | null;
  apiKeyConfigured: boolean;
  apiKeySource: 'db' | 'env' | 'relay' | 'none';
  apiKeyUpdatedAt: Date | null;
  apiKeyUpdatedBy: string | null;
  unitPriceCny: number;
  unitName: string;
  modelRate: number | null;
  outputRate: number | null;
  defaultModel: string | null;
  source: 'relay' | 'subscription' | 'direct' | 'local' | null;
  relayProviderId: string | null;
  relayProviderName: string | null;
  relayProviderDisplayName: string | null;
};

export type RelayProvider = {
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
  attachedProviderCount: number;
  attachedActiveCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CatalogModel = {
  modelId: string;
  providerIdSuffix: string;
  displayName: string;
  vendor: string;
  description: string;
  modelRate?: number;
  outputRate?: number;
  unitPriceCny?: number;
  unitName?: string;
  group?: string;
  protocol?: string;
  endpointStyle?: string;
  isDefault: boolean;
};

export type Catalog = {
  name: string;
  displayName: string;
  defaultApiUrl: string;
  totalModels: number;
  defaultCount: number;
  candidateCount: number;
  models: Partial<Record<string, CatalogModel[]>>;
};

export const KIND_ORDER = ['TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'COMPLIANCE'] as const;
export const KIND_META: Record<string, { emoji: string; label: string }> = {
  TEXT: { emoji: '💬', label: 'LLM 文本模型' },
  IMAGE: { emoji: '🎨', label: '图像模型' },
  VIDEO: { emoji: '🎬', label: '视频模型' },
  AUDIO: { emoji: '🎵', label: '音频模型' },
  COMPLIANCE: { emoji: '🛡️', label: '合规模型' },
  EMBEDDING: { emoji: '🧠', label: 'Embedding' },
};
