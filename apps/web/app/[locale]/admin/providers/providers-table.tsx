'use client';
import { useTranslations } from 'next-intl';
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import * as React from 'react';

import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCny, cn } from '@/lib/utils';

// ============================================================================
// 类型
// ============================================================================

type Provider = {
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

type RelayProvider = {
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

type CatalogModel = {
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

type Catalog = {
  name: string;
  displayName: string;
  defaultApiUrl: string;
  totalModels: number;
  defaultCount: number;
  candidateCount: number;
  models: Partial<Record<string, CatalogModel[]>>;
};

const KIND_ORDER = ['TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'COMPLIANCE'] as const;
const KIND_META: Record<string, { emoji: string; label: string }> = {
  TEXT: { emoji: '💬', label: 'LLM 文本模型' },
  IMAGE: { emoji: '🎨', label: '图像模型' },
  VIDEO: { emoji: '🎬', label: '视频模型' },
  AUDIO: { emoji: '🎵', label: '音频模型' },
  COMPLIANCE: { emoji: '🛡️', label: '合规模型' },
  EMBEDDING: { emoji: '🧠', label: 'Embedding' },
};

// ============================================================================
// 主组件
// ============================================================================

export function ProvidersTable(): React.ReactElement {
  const { data: providers, refetch: refetchProviders } =
    trpc.admin.provider.list.useQuery();
  const { data: relays, refetch: refetchRelays } =
    trpc.admin.relay.list.useQuery();
  const { data: catalogs } = trpc.admin.catalog.list.useQuery();

  const onAnyChange = (): void => {
    void refetchProviders();
    void refetchRelays();
  };

  // 按 kind 分类所有 provider(中转站 + 直连一起)
  const providersByKind = React.useMemo(() => {
    if (!providers) return {} as Record<string, Provider[]>;
    const map: Record<string, Provider[]> = {};
    for (const p of providers) {
      (map[p.kind] ??= []).push(p as Provider);
    }
    for (const k of Object.keys(map)) {
      map[k]!.sort((a, b) => {
        // 中转站在前,直连在后
        const aRelay = a.relayProviderId !== null ? 0 : 1;
        const bRelay = b.relayProviderId !== null ? 0 : 1;
        if (aRelay !== bRelay) return aRelay - bRelay;
        return a.providerId.localeCompare(b.providerId);
      });
    }
    return map;
  }, [providers]);

  if (!providers || !relays || !catalogs) {
    return <Card className="h-96 animate-pulse" />;
  }

  return (
    <div className="space-y-8">
      {/* 1. 中转站凭证列表(顶部) */}
      <RelayCredentialsSection
        relays={relays as RelayProvider[]}
        catalogs={catalogs as Catalog[]}
        onChange={onAnyChange}
      />

      {/* 2. 模型按 kind 分类(中转站精选 + 候选下拉 + 直连内嵌) */}
      <ModelsSection
        providersByKind={providersByKind}
        relays={relays as RelayProvider[]}
        catalogs={catalogs as Catalog[]}
        onChange={onAnyChange}
      />
    </div>
  );
}

// ============================================================================
// Section 1: 中转站凭证列表
// ============================================================================

function RelayCredentialsSection({
  relays,
  catalogs,
  onChange,
}: {
  relays: RelayProvider[];
  catalogs: Catalog[];
  onChange: () => void;
}): React.ReactElement {
  const [showAdd, setShowAdd] = React.useState(false);
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base">📦</span>
          <h2 className="text-base font-semibold">中转站凭证 · Relay Credentials</h2>
          <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
            每个凭证 = 1 token 共享多模型 · 当前 {relays.length} 个
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(true)} className="gap-1.5">
          <Plus className="size-4" />
          添加中转站
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {relays.map((r) => (
          <RelayCard key={r.id} relay={r} onChange={onChange} />
        ))}
      </div>

      {showAdd && (
        <AddRelayDialog
          catalogs={catalogs}
          existingNames={relays.map((r) => r.name)}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            onChange();
            setShowAdd(false);
          }}
        />
      )}
    </section>
  );
}

function RelayCard({
  relay,
  onChange,
}: {
  relay: RelayProvider;
  onChange: () => void;
}): React.ReactElement {
  const [editingKey, setEditingKey] = React.useState(false);
  const [editingUrl, setEditingUrl] = React.useState(false);
  const [newUrl, setNewUrl] = React.useState(relay.apiUrl ?? '');
  const [newKey, setNewKey] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);

  // Audit 修(F-P0-3):打开编辑时同步当前 relay.apiUrl(防 stale closure)
  React.useEffect(() => {
    if (editingUrl) setNewUrl(relay.apiUrl ?? '');
  }, [editingUrl, relay.apiUrl]);

  const setApiKey = trpc.admin.relay.setApiKey.useMutation({
    onSuccess: () => {
      setNewKey('');
      setEditingKey(false);
      onChange();
    },
  });
  const clearApiKey = trpc.admin.relay.clearApiKey.useMutation({ onSuccess: onChange });
  const updateRelay = trpc.admin.relay.update.useMutation({
    onSuccess: () => {
      setEditingUrl(false);
      onChange();
    },
  });
  const deleteRelay = trpc.admin.relay.delete.useMutation({ onSuccess: onChange });

  const toggleActive = (): void => {
    updateRelay.mutate({ id: relay.id, isActive: !relay.isActive });
  };

  return (
    <Card className={cn('p-4', !relay.isActive && 'opacity-60')}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">🏷 {relay.displayName}</span>
            {relay.isActive ? (
              <Badge variant="success" className="text-[10px]">已启用</Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">停用</Badge>
            )}
            {relay.catalogKey && (
              <Badge variant="default" className="text-[10px]">
                catalog: {relay.catalogKey}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 font-mono text-xs text-[hsl(var(--color-muted-foreground))]">
            {relay.name}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ToggleSwitch checked={relay.isActive} onChange={toggleActive} loading={updateRelay.isPending} />
          {relay.attachedProviderCount === 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (confirm(`删除中转站 "${relay.displayName}"?(没有关联模型,安全)`))
                  deleteRelay.mutate({ id: relay.id, confirmDelete: true });
              }}
              disabled={deleteRelay.isPending}
              className="size-7 p-0 text-red-600"
              aria-label="删除"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* apiUrl */}
      <div className="mt-2 text-xs">
        <span className="text-[hsl(var(--color-muted-foreground))]">URL:</span>{' '}
        {editingUrl ? (
          <div className="mt-1 flex gap-1">
            <Input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://your-relay/v1"
              className="h-7 font-mono text-xs"
            />
            <Button
              size="sm"
              onClick={() => updateRelay.mutate({ id: relay.id, apiUrl: newUrl })}
              disabled={!newUrl || updateRelay.isPending}
              className="h-7 px-2"
            >
              保存
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingUrl(false)} className="h-7 px-2">
              取消
            </Button>
          </div>
        ) : (
          <span className="cursor-pointer font-mono hover:underline" onClick={() => setEditingUrl(true)}>
            {relay.apiUrl || <span className="text-red-500">未设置(点击编辑)</span>}
          </span>
        )}
      </div>

      {/* apiKey */}
      <div className="mt-2 text-xs">
        <span className="text-[hsl(var(--color-muted-foreground))]">Key:</span>{' '}
        {editingKey ? (
          <div className="mt-1 flex gap-1">
            <div className="flex-1 flex gap-1">
              <Input
                type={showKey ? 'text' : 'password'}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="sk-..."
                className="h-7 font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowKey((v) => !v)}
                className="h-7 px-2"
                aria-label={showKey ? '隐藏' : '显示'}
              >
                {showKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              </Button>
            </div>
            <Button
              size="sm"
              onClick={() => setApiKey.mutate({ id: relay.id, apiKey: newKey })}
              disabled={newKey.length < 8 || setApiKey.isPending}
              className="h-7 px-2"
            >
              保存
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingKey(false)} className="h-7 px-2">
              取消
            </Button>
          </div>
        ) : relay.apiKeyConfigured ? (
          <>
            <span className="font-mono">{relay.apiKeyMasked}</span>
            <Button size="sm" variant="ghost" onClick={() => setEditingKey(true)} className="ml-2 h-6 px-2">
              更换
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (confirm('清除 API Key?所有关联模型将无法用'))
                  clearApiKey.mutate({ id: relay.id });
              }}
              className="h-6 px-2 text-red-600"
              disabled={clearApiKey.isPending}
            >
              清除
            </Button>
          </>
        ) : (
          <>
            <span className="text-red-500">未配置</span>
            <Button size="sm" variant="outline" onClick={() => setEditingKey(true)} className="ml-2 h-6 px-2 gap-1">
              <KeyRound className="size-3" /> 设置
            </Button>
          </>
        )}
      </div>

      <div className="mt-2 text-xs text-[hsl(var(--color-muted-foreground))]">
        关联 {relay.attachedProviderCount} 个模型({relay.attachedActiveCount} 启用)
        {relay.apiKeyUpdatedAt &&
          ` · ${new Date(relay.apiKeyUpdatedAt).toLocaleString()}`}
      </div>
      {setApiKey.error && (
        <p className="mt-2 text-xs text-red-600">{setApiKey.error.message}</p>
      )}
      {updateRelay.error && (
        <p className="mt-2 text-xs text-red-600">{updateRelay.error.message}</p>
      )}
      {/* Audit 修(F-P1-1):clearApiKey 错误也显示 */}
      {clearApiKey.error && (
        <p className="mt-2 text-xs text-red-600">{clearApiKey.error.message}</p>
      )}
      {deleteRelay.error && (
        <p className="mt-2 text-xs text-red-600">{deleteRelay.error.message}</p>
      )}
    </Card>
  );
}

// ============================================================================
// Section 2: 模型按 kind 分类(中转站精选 + 候选下拉 + 直连内嵌)
// ============================================================================

function ModelsSection({
  providersByKind,
  relays,
  catalogs,
  onChange,
}: {
  providersByKind: Record<string, Provider[]>;
  relays: RelayProvider[];
  catalogs: Catalog[];
  onChange: () => void;
}): React.ReactElement {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-base">🌐</span>
        <h2 className="text-base font-semibold">模型列表 · Models</h2>
        <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
          按类别分组 · 启用后才出现在 /admin/bindings 候选
        </span>
      </div>

      <div className="space-y-4">
        {KIND_ORDER.map((kind) => {
          const list = providersByKind[kind] ?? [];
          const relayList = list.filter((p) => p.relayProviderId !== null);
          const directList = list.filter((p) => p.relayProviderId === null);
          const meta = KIND_META[kind] ?? { emoji: '🔧', label: kind };
          // 如果该类别完全没模型 + 无可加 catalog 也无添加直连 → 跳过显示
          const hasCatalogModels = catalogs.some((c) => (c.models[kind] ?? []).length > 0);
          if (list.length === 0 && !hasCatalogModels) return null;
          return (
            <Card key={kind} className="overflow-hidden">
              <div className="border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-secondary)/0.3)] px-4 py-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span>{meta.emoji}</span>
                  <span>{meta.label}</span>
                  <span className="text-xs font-normal text-[hsl(var(--color-muted-foreground))]">
                    · {list.length} 个 · {list.filter((p) => p.isActive).length} 启用
                  </span>
                </div>
              </div>

              {/* 中转站子区 */}
              {relayList.length > 0 && (
                <div className="border-b border-[hsl(var(--color-border)/0.5)]">
                  {relayList.map((p) => (
                    <ModelRow key={p.providerId} provider={p} onChange={onChange} />
                  ))}
                </div>
              )}

              {/* 从 catalog 添加中转站模型 — Audit r22.1 修(遍 5):用 defaultModel 反推匹配 catalog modelId
                  (旧 prefix 反推不稳健:1.5.1 之前的 relay-* migrated 后 prefix 是 'relay-' 不是 'moyu-')
                  defaultModel 在 createFromCatalog 时一定 set(=m.modelId),migration 旧 relay-* 也保留了
                  defaultParams.defaultModel,所以这个反推稳健 */}
              {hasCatalogModels && relays.length > 0 && (
                <CatalogAddRow
                  kind={kind}
                  relays={relays}
                  catalogs={catalogs}
                  existingModelIdsByRelay={(() => {
                    const map = new Map<string, Set<string>>();
                    for (const p of list) {
                      if (!p.relayProviderId || !p.defaultModel) continue;
                      const existing = map.get(p.relayProviderId) ?? new Set<string>();
                      existing.add(p.defaultModel);
                      map.set(p.relayProviderId, existing);
                    }
                    return map;
                  })()}
                  onChange={onChange}
                />
              )}

              {/* 直连子区(amber 高亮) */}
              {directList.length > 0 && (
                <div className="border-t-4 border-amber-500/40 bg-amber-500/5">
                  <div className="px-4 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    ⭐ 直连(独立 API Key)
                  </div>
                  {directList.map((p) => (
                    <ModelRow key={p.providerId} provider={p} onChange={onChange} isDirect />
                  ))}
                </div>
              )}

              {/* 添加直连按钮 */}
              <AddDirectRow kind={kind} onChange={onChange} />
            </Card>
          );
        })}
      </div>
    </section>
  );
}

// ============================================================================
// 子组件:模型行(中转站 + 直连共用)
// ============================================================================

function ModelRow({
  provider,
  onChange,
  isDirect = false,
}: {
  provider: Provider;
  onChange: () => void;
  isDirect?: boolean;
}): React.ReactElement {
  const [editingKey, setEditingKey] = React.useState(false);
  const [newKey, setNewKey] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);

  const setActive = trpc.admin.provider.setActive.useMutation({ onSuccess: onChange });
  const setProviderKey = trpc.admin.provider.setApiKey.useMutation({
    onSuccess: () => {
      setNewKey('');
      setEditingKey(false);
      onChange();
    },
  });
  // Phase 1.5.2:删除按钮 — 从展示界面移除,放回下拉候选(下次可重新加)
  // 中转站模型:apiKey 在 RelayProvider 上,ProviderConfig 本身无 key → 可直接删
  // 直连模型 + 有 key:backend 会拒,用户需先在 SetApiKey 对话框清除 Key 再删
  const deleteProvider = trpc.admin.provider.delete.useMutation({
    onSuccess: onChange,
    onError: (err) => alert(err.message),
  });
  const handleDelete = (): void => {
    if (
      !confirm(
        `从列表移除 "${provider.displayName}"?\n(可下次从下拉重新添加 · 不会影响中转站凭证)`,
      )
    )
      return;
    deleteProvider.mutate({ providerId: provider.providerId, confirmDelete: true });
  };

  const priceLabel = formatModelPrice(provider);
  const canEnable = provider.apiKeyConfigured;

  return (
    <div className="flex flex-col gap-2 border-b border-[hsl(var(--color-border)/0.4)] px-4 py-3 last:border-b-0 hover:bg-[hsl(var(--color-secondary)/0.2)] sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{provider.displayName}</span>
          {provider.relayProviderDisplayName && (
            <Badge variant="default" className="text-[10px]">
              via {provider.relayProviderName}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 font-mono text-xs text-[hsl(var(--color-muted-foreground))]">
          {provider.providerId}
        </div>
        <div className="mt-1 text-xs text-[hsl(var(--color-muted-foreground))]">
          {priceLabel}
        </div>
        {/* 直连显示 apiUrl + apiKey */}
        {isDirect && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {provider.apiUrl && (
              <span className="font-mono text-[hsl(var(--color-muted-foreground))]">
                {provider.apiUrl}
              </span>
            )}
            {provider.apiKeyConfigured ? (
              <>
                <span className="font-mono">{provider.apiKeyMasked}</span>
                <Badge
                  variant={provider.apiKeySource === 'db' ? 'default' : 'warning'}
                  className="text-[10px]"
                >
                  {provider.apiKeySource === 'db' ? 'DB' : provider.apiKeySource}
                </Badge>
              </>
            ) : (
              <Badge variant="destructive" className="text-[10px]">未配 Key</Badge>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isDirect && (
          <>
            {editingKey ? (
              <div className="flex items-center gap-1">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="sk-..."
                  className="h-7 w-40 font-mono text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowKey((v) => !v)}
                  className="h-7 px-2"
                >
                  {showKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    setProviderKey.mutate({
                      providerId: provider.providerId,
                      apiKey: newKey,
                    })
                  }
                  disabled={newKey.length < 8 || setProviderKey.isPending}
                  className="h-7 px-2"
                >
                  保存
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingKey(false)}
                  className="h-7 px-2"
                >
                  取消
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingKey(true)}
                className="gap-1 h-7"
              >
                <KeyRound className="size-3.5" />
                {provider.apiKeyConfigured ? '更换' : '设置'}
              </Button>
            )}
          </>
        )}
        <span
          className={cn(
            'text-xs',
            provider.isActive
              ? 'font-medium text-green-700 dark:text-green-400'
              : 'text-[hsl(var(--color-muted-foreground))]',
          )}
        >
          {provider.isActive ? '已启用' : '停用'}
        </span>
        <ToggleSwitch
          checked={provider.isActive}
          disabled={!canEnable && !provider.isActive}
          loading={setActive.isPending}
          onChange={(v) =>
            setActive.mutate({ providerId: provider.providerId, isActive: v })
          }
        />
        {/* Phase 1.5.2:从展示移除(放回下拉候选) */}
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDelete}
          disabled={deleteProvider.isPending || provider.isActive}
          className="size-7 p-0 text-red-600 hover:text-red-700"
          aria-label="从列表移除"
          title={provider.isActive ? '请先停用再移除' : '从列表移除(下次可从下拉重新加)'}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// 子组件:从 catalog 添加(下拉 + 选模型 + 关联中转站)
// ============================================================================

function CatalogAddRow({
  kind,
  relays,
  catalogs,
  existingModelIdsByRelay,
  onChange,
}: {
  kind: string;
  relays: RelayProvider[];
  catalogs: Catalog[];
  existingModelIdsByRelay: Map<string, Set<string>>;
  onChange: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <div className="border-b border-[hsl(var(--color-border)/0.5)] px-4 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen(true)}
          className="gap-1.5 text-xs text-[hsl(var(--color-muted-foreground))]"
        >
          <Plus className="size-3.5" />
          从中转站候选库添加更多 {KIND_META[kind]?.label}
        </Button>
      </div>
      {open && (
        <CatalogPickerDialog
          kind={kind}
          relays={relays}
          catalogs={catalogs}
          existingModelIdsByRelay={existingModelIdsByRelay}
          onClose={() => setOpen(false)}
          onChange={onChange}
        />
      )}
    </>
  );
}

function CatalogPickerDialog({
  kind,
  relays,
  catalogs,
  existingModelIdsByRelay,
  onClose,
  onChange,
}: {
  kind: string;
  relays: RelayProvider[];
  catalogs: Catalog[];
  existingModelIdsByRelay: Map<string, Set<string>>;
  onClose: () => void;
  onChange: () => void;
}): React.ReactElement {
  const [selectedRelayId, setSelectedRelayId] = React.useState<string>(
    relays[0]?.id ?? '',
  );
  const selectedRelay = relays.find((r) => r.id === selectedRelayId);
  const catalog = catalogs.find((c) => c.name === selectedRelay?.catalogKey);
  const models = (catalog?.models[kind] ?? []) as CatalogModel[];

  const createFromCatalog = trpc.admin.provider.createFromCatalog.useMutation();

  // Audit r22.1 修(遍 5):existingModelIds 用 catalog.modelId 反推 ProviderConfig.defaultModel
  // (比 providerIdSuffix 拼前缀反推稳健;能正确去重历史 migrated 旧 relay-*)
  const existingModelIds =
    existingModelIdsByRelay.get(selectedRelayId) ?? new Set<string>();
  const filtered = models.filter((m) => !existingModelIds.has(m.modelId));

  // Audit r22.1 修(遍 3):成功后保持 dialog 开,只 refetch 让 filtered 立即去掉刚加的
  // 这样用户可以连续 [+ 添加] 多个候选,完成后点 "完成" 关闭
  const handleAdd = (suffix: string): void => {
    createFromCatalog.mutate(
      {
        relayProviderId: selectedRelayId,
        catalogKey: catalog!.name,
        providerIdSuffix: suffix,
      },
      {
        onSuccess: () => onChange(), // 触发 parent refetch,dialog 不关
      },
    );
  };

  // Audit r22.1(遍 4):catalog 价格按 kind 显示策略 — IMAGE/VIDEO 优先 unitPriceCny(用户更直观)
  // TEXT 优先 modelRate(per-token 计费)
  const formatCatalogPrice = (m: CatalogModel): string => {
    const isTokenKind = kind === 'TEXT' || kind === 'EMBEDDING';
    if (isTokenKind && m.modelRate != null) {
      return `¥${m.modelRate}/M · 输出 ${m.outputRate ?? 1}×`;
    }
    if (m.unitPriceCny != null && m.unitName) {
      return `¥${m.unitPriceCny}/${m.unitName}`;
    }
    if (m.modelRate != null) {
      return `¥${m.modelRate}/M · 输出 ${m.outputRate ?? 1}×`;
    }
    return '由中转站计费';
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {KIND_META[kind]?.emoji} 从中转站候选库添加 {KIND_META[kind]?.label}
          </DialogTitle>
          <DialogDescription>
            选模型 → 关联到某个中转站凭证 → 自动加入列表(默认停用,需手动启用)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label>关联中转站凭证</Label>
            <select
              value={selectedRelayId}
              onChange={(e) => setSelectedRelayId(e.target.value)}
              className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 py-1.5 text-sm"
            >
              {relays.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.displayName} ({r.name}) {r.catalogKey ? `[catalog: ${r.catalogKey}]` : ''}
                </option>
              ))}
            </select>
          </div>

          {!catalog && (
            <p className="rounded-md bg-amber-500/15 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              选中的中转站没有 catalog(catalogKey 为 null)— 改用"+ 添加直连"自定义
            </p>
          )}

          {catalog && filtered.length === 0 && (
            <p className="rounded-md bg-[hsl(var(--color-secondary))] px-3 py-2 text-xs text-[hsl(var(--color-muted-foreground))]">
              该类别下所有 catalog 模型已添加 ✓
            </p>
          )}

          {catalog && filtered.length > 0 && (
            <>
              {/* 三十六收工 UX 改造:显式候选总数 + 已添加数,防用户误以为列表不全 */}
              <div className="flex items-center justify-between rounded-md bg-[hsl(var(--color-secondary)/0.5)] px-3 py-2 text-xs">
                <span className="text-[hsl(var(--color-muted-foreground))]">
                  共 <strong className="text-[hsl(var(--color-foreground))]">{models.length}</strong> 个候选模型 ·
                  <strong className="text-[hsl(var(--color-foreground))]"> {filtered.length}</strong> 个可添加 ·
                  <strong className="text-[hsl(var(--color-foreground))]"> {models.length - filtered.length}</strong> 个已添加
                </span>
                {filtered.length > 5 && (
                  <span className="text-[hsl(var(--color-muted-foreground))]">↓ 向下滚动查看全部</span>
                )}
              </div>
              <div className="max-h-[60vh] overflow-y-auto rounded-md border border-[hsl(var(--color-border))]">
                {filtered.map((m) => (
                <div
                  key={m.providerIdSuffix}
                  className="flex items-center justify-between border-b border-[hsl(var(--color-border)/0.4)] px-3 py-2 last:border-b-0 hover:bg-[hsl(var(--color-secondary)/0.3)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{m.displayName}</span>
                      <Badge variant="default" className="text-[10px]">
                        {m.vendor}
                      </Badge>
                      {m.isDefault && (
                        <Badge variant="success" className="text-[10px]">
                          精选
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-[hsl(var(--color-muted-foreground))]">
                      {m.description}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-[hsl(var(--color-muted-foreground))]">
                      {m.modelId} · {formatCatalogPrice(m)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAdd(m.providerIdSuffix)}
                    disabled={createFromCatalog.isPending}
                    className="gap-1 shrink-0"
                  >
                    <Plus className="size-3.5" />
                    添加
                  </Button>
                </div>
              ))}
              </div>
            </>
          )}

          {createFromCatalog.error && (
            <p className="rounded-md bg-red-500/15 px-3 py-2 text-xs text-red-700">
              {createFromCatalog.error.message}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// 子组件:添加直连 Provider
// ============================================================================

function AddDirectRow({
  kind,
  onChange,
}: {
  kind: string;
  onChange: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <div className="border-t-4 border-amber-500/40 bg-amber-500/5 px-4 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen(true)}
          className="gap-1.5 text-xs text-amber-700 dark:text-amber-400"
        >
          <Sparkles className="size-3.5" />+ 添加直连 {KIND_META[kind]?.label}(独立 API Key)
        </Button>
      </div>
      {open && (
        <AddDirectDialog
          kind={kind}
          onClose={() => setOpen(false)}
          onSaved={() => {
            onChange();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function AddDirectDialog({
  kind,
  onClose,
  onSaved,
}: {
  kind: string;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  // Phase 1.5.2 简化(只 4 字段):displayName / baseUrl / apiKey / notes
  // providerId / protocol / 单价 / 单位 自动生成 — 用户后续可在 admin/api-usage 看真实消费
  const [displayName, setDisplayName] = React.useState('');
  const [apiUrl, setApiUrl] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);
  // Audit 修(F-P0-1):统一 saving 状态防三连 mutation 中按钮解禁导致重复点
  const [saving, setSaving] = React.useState(false);
  // Audit 修(F-P0-2):显式承接 setKey/setActive 失败信息(原代码 catch 静默吞)
  const [extraError, setExtraError] = React.useState<string | null>(null);

  const create = trpc.admin.provider.create.useMutation();
  const setKey = trpc.admin.provider.setApiKey.useMutation();
  const setActive = trpc.admin.provider.setActive.useMutation();

  // 自动生成 providerId:displayName slug + kind 后缀(防重)
  const autoProviderId = React.useMemo(() => {
    const slug = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return slug ? `direct-${slug}` : '';
  }, [displayName]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setExtraError(null);
    try {
      const providerId = autoProviderId;
      await create.mutateAsync({
        providerId,
        displayName,
        kind: kind as 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'COMPLIANCE' | 'EMBEDDING',
        apiUrl,
        unitPriceCny: 0, // 直连默认 0(不入 cost ledger 精确计费,后续 admin/api-usage 看真实消费)
        unitName: 'ktoken',
        defaultParams: {
          protocol: 'openai-compat', // 99% 直连用 openai-compat 兼容协议
          source: 'direct',
          ...(notes ? { notes } : {}),
        },
      });
      if (apiKey.length >= 8) {
        try {
          await setKey.mutateAsync({ providerId, apiKey });
          await setActive.mutateAsync({ providerId, isActive: true });
        } catch (e) {
          // create 成功但 setKey/setActive 失败:UI 显示但不阻止"已创建"状态(用户可重设)
          setExtraError(
            `Provider 已创建但启用失败:${e instanceof Error ? e.message : String(e)} · 请去列表手动设置 Key + 启用`,
          );
        }
      }
      onSaved();
    } catch {
      // create.error 已显示
    } finally {
      setSaving(false);
    }
  };

  const canSubmit =
    displayName.length >= 1 &&
    apiUrl.length >= 1 &&
    autoProviderId.length >= 3 &&
    !saving;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>⭐ 添加直连 {KIND_META[kind]?.label}</DialogTitle>
          <DialogDescription>
            独立 API Key · 4 字段即可(其他参数自动生成)
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="d-name">显示名称 *</Label>
            <Input
              id="d-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Claude Opus 4.7(Anthropic 直连)"
              autoFocus
            />
            {autoProviderId && (
              <p className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                自动生成 providerId:<code className="font-mono">{autoProviderId}</code>
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="d-url">Base URL *</Label>
            <Input
              id="d-url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://api.anthropic.com/v1"
              className="font-mono text-xs"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="d-key">API Key</Label>
            <div className="flex gap-1">
              <Input
                id="d-key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-... (可空,创建后再设)"
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="shrink-0 px-2"
              >
                {showKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              </Button>
            </div>
            <p className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
              ≥ 8 字符立即启用 · 空则创建后停用状态(可后续设置)
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="d-notes">备注(可选)</Label>
            <Input
              id="d-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="¥10 月限额 / 主用 / 备用 / 等"
            />
          </div>

          {create.error && (
            <p className="rounded-md bg-red-500/15 px-3 py-2 text-xs text-red-700">
              {create.error.message}
            </p>
          )}
          {/* Audit 修(F-P0-2):setKey/setActive 失败也展示 */}
          {extraError && (
            <p className="rounded-md bg-amber-500/15 px-3 py-2 text-xs text-amber-700">
              {extraError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            创建{apiKey.length >= 8 ? ' + 启用' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// 子组件:添加中转站凭证
// ============================================================================

function AddRelayDialog({
  catalogs,
  existingNames,
  onClose,
  onSaved,
}: {
  catalogs: Catalog[];
  existingNames: string[];
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [name, setName] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [apiUrl, setApiUrl] = React.useState('');
  const [catalogKey, setCatalogKey] = React.useState('');
  const [notes, setNotes] = React.useState('');

  const create = trpc.admin.relay.create.useMutation({ onSuccess: onSaved });

  // 选 catalog 后自动填 displayName + apiUrl
  React.useEffect(() => {
    if (!catalogKey) return;
    const c = catalogs.find((x) => x.name === catalogKey);
    if (!c) return;
    if (!displayName) setDisplayName(c.displayName);
    if (!apiUrl) setApiUrl(c.defaultApiUrl);
    if (!name) setName(catalogKey);
  }, [catalogKey, catalogs, displayName, apiUrl, name]);

  const canSubmit =
    name.length >= 2 &&
    displayName.length >= 1 &&
    !existingNames.includes(name) &&
    !create.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>📦 添加中转站凭证</DialogTitle>
          <DialogDescription>
            添加新中转站后,可从其 catalog 选模型添加到列表 · 同 token 共享多模型
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>选择 catalog(可选,自动填默认 URL)</Label>
            <select
              value={catalogKey}
              onChange={(e) => setCatalogKey(e.target.value)}
              className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 py-1.5 text-sm"
            >
              <option value="">(自定义,无 catalog)</option>
              {catalogs.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.displayName} · {c.totalModels} 模型
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="r-name">name(唯一标识)</Label>
              <Input
                id="r-name"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                placeholder="moyu-prod / poe-personal"
                className="font-mono text-xs"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="r-display">显示名</Label>
              <Input
                id="r-display"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="主用 moyu / 备用 OpenRouter"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="r-url">Base URL</Label>
            <Input
              id="r-url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://your-relay/v1"
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
              创建后再去卡片上"设置 API Key"(分两步,防误存空 token)
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="r-notes">备注(可选)</Label>
            <Input
              id="r-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="¥10 月限额 / 备用 token / 等"
            />
          </div>

          {existingNames.includes(name) && (
            <p className="text-xs text-red-600">name "{name}" 已存在</p>
          )}
          {create.error && (
            <p className="rounded-md bg-red-500/15 px-3 py-2 text-xs text-red-700">
              {create.error.message}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() =>
              create.mutate({
                name,
                displayName,
                apiUrl: apiUrl || undefined,
                catalogKey: catalogKey || undefined,
                notes: notes || undefined,
              })
            }
            disabled={!canSubmit}
          >
            {create.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// 工具组件
// ============================================================================

function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  loading = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || loading}
      onClick={() => !disabled && !loading && onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-green-500' : 'bg-gray-400/40',
        (disabled || loading) && 'cursor-not-allowed opacity-50',
        !disabled && !loading && 'cursor-pointer',
      )}
    >
      <span
        className={cn(
          'inline-block size-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      >
        {loading && <Loader2 className="size-5 animate-spin p-0.5 text-gray-600" />}
      </span>
    </button>
  );
}

function formatModelPrice(p: Provider): React.ReactNode {
  if (p.modelRate != null && p.modelRate > 0) {
    const outputCost = p.modelRate * (p.outputRate ?? 1);
    return (
      <span>
        ¥{p.modelRate.toFixed(2)}/M 输入 · ¥{outputCost.toFixed(2)}/M 输出
        {p.outputRate != null && p.outputRate !== 1 && (
          <span className="ml-1 text-[hsl(var(--color-muted-foreground))]">
            (输出 {p.outputRate}×)
          </span>
        )}
      </span>
    );
  }
  if (p.unitPriceCny > 0) {
    return (
      <span>
        {formatCny(p.unitPriceCny)}/{p.unitName}
      </span>
    );
  }
  // Audit 修(F-P1-5):中转站模型 + 单价为 0 时不显示误导性 "¥0/ktoken"
  return (
    <span className="italic text-[hsl(var(--color-muted-foreground))]">
      {p.relayProviderId ? '由中转站计费(看运营商页)' : '免费 / 订阅制'}
    </span>
  );
}

