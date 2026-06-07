'use client';
import { Plus } from 'lucide-react';
import * as React from 'react';

import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { Catalog, CatalogModel, RelayProvider } from './providers-shared';
import { KIND_META } from './providers-shared';

// ============================================================================
// 子组件:从 catalog 添加(下拉 + 选模型 + 关联中转站)
// ============================================================================

export function CatalogAddRow({
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
