'use client';
import { Plus } from 'lucide-react';
import * as React from 'react';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import { AddDirectRow } from './providers-add-direct';
import { AddRelayDialog } from './providers-add-relay';
import { CatalogAddRow } from './providers-catalog-picker';
import { ModelRow } from './providers-model-row';
import { RelayCard } from './providers-relay-card';
import type { Catalog, Provider, RelayProvider } from './providers-shared';
import { KIND_META, KIND_ORDER } from './providers-shared';

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
