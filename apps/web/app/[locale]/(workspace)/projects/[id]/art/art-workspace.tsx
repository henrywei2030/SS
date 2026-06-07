'use client';
import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  User,
  Mountain,
  Package,
  Palette,
  Plus,
  Sparkles,
  Loader2,
  ListChecks,
  Activity,
} from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { AssetCard } from './asset-card';
import { AssetEditDialog } from './asset-edit-dialog';
import { ArtBatchGenerate, type BatchTarget } from './art-batch-generate';
import { BreakdownDialog } from './breakdown-dialog';
import { GapDetectionDialog } from './gap-detection-dialog';
import type { Slot } from './asset-edit-shared';

type AssetType = 'CHARACTER' | 'SCENE' | 'PROP' | 'STYLE_REFERENCE';

const TYPES: Array<{ value: AssetType; label: string; icon: React.ElementType }> = [
  { value: 'CHARACTER', label: '人物', icon: User },
  { value: 'SCENE', label: '场景', icon: Mountain },
  { value: 'PROP', label: '道具', icon: Package },
  { value: 'STYLE_REFERENCE', label: '风格参考', icon: Palette },
];

// 各类型「主图」槽位 — 同步生成 / 缺图判定用(对齐网格 hero 取图逻辑)
const PRIMARY_SLOT: Record<AssetType, Slot> = {
  CHARACTER: 'portrait',
  SCENE: 'scene_main',
  PROP: 'main',
  STYLE_REFERENCE: 'main',
};

// 五六收工:同步闸筛选(剧本拆解 syncToArt 翻转 syncedToArtAt)。默认 all 不回归,
//   让美术工坊能选「只看剧本拆解已同步过来的」/「未同步(美术侧直接建的)」。
type SyncFilter = 'all' | 'synced' | 'unsynced';
const SYNC_FILTERS: Array<{ value: SyncFilter; label: string; title: string }> = [
  { value: 'all', label: '全部', title: '显示全部资产(含美术侧直接新建的)' },
  { value: 'synced', label: '已同步', title: '只看从「剧本拆解」同步过来的资产' },
  { value: 'unsynced', label: '未同步', title: '只看还没同步的资产(多为美术侧直接新建)' },
];

interface Props {
  projectId: string;
  locale: string;
  initialType: AssetType;
}

export function ArtWorkspace({ projectId, locale, initialType }: Props): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const typeFromUrl = (searchParams.get('type') as AssetType | null) ?? initialType;
  const currentType: AssetType = TYPES.some((t) => t.value === typeFromUrl)
    ? typeFromUrl
    : initialType;

  const [editingAssetId, setEditingAssetId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const [gapOpen, setGapOpen] = React.useState(false);
  const [syncFilter, setSyncFilter] = React.useState<SyncFilter>('all');

  const { data, isLoading, refetch } = trpc.asset.list.useQuery({
    projectId,
    type: currentType,
    syncFilter,
  });
  const assets = data?.assets;
  const mediaMap = data?.mediaMap ?? {};

  // W6 polish:batch 查所有 asset 的 binding(替原 AssetCard 内 N 次 useQuery)
  const assetIds = React.useMemo(() => assets?.map((a) => a.id) ?? [], [assets]);
  const { data: bindingsByAssetId } = trpc.asset.listBindingsByAssetIds.useQuery(
    { projectId, assetIds },
    { enabled: assetIds.length > 0 },
  );

  // 「同步生成」目标 — 当前分类下「缺主图」的资产(主图取图逻辑对齐下方网格 hero)
  const batchTargets: BatchTarget[] = React.useMemo(() => {
    if (!assets) return [];
    return assets
      .filter((a) => {
        const hero =
          a.type === 'CHARACTER'
            ? a.portraitMediaId
            : a.type === 'SCENE'
              ? a.sceneMainMediaId ?? a.mainMediaId
              : a.mainMediaId;
        return !hero;
      })
      .map((a) => ({ id: a.id, name: a.name, slot: PRIMARY_SLOT[a.type as AssetType] }));
  }, [assets]);

  const selectType = (t: AssetType): void => {
    const params = new URLSearchParams(window.location.search);
    params.set('type', t);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // 人物 — 优先按 archetypeKey 分组(同人物多变体),再按 characterRole 大类
  // 场景/道具/风格 — 平铺
  const grouped = React.useMemo(() => {
    if (!assets) return [];
    if (currentType !== 'CHARACTER') {
      return [{ label: '', items: assets, isArchetype: false }];
    }

    // 1. 找出 archetypeKey 多变体的(同 key 有 >= 2 个 asset),组成 archetype 分组
    const archetypeBuckets = new Map<string, typeof assets>();
    const singletons: typeof assets = [];
    for (const a of assets) {
      const key = a.archetypeKey?.trim();
      if (key) {
        const bucket = archetypeBuckets.get(key) ?? [];
        bucket.push(a);
        archetypeBuckets.set(key, bucket);
      } else {
        singletons.push(a);
      }
    }
    const archetypeGroups: Array<{ label: string; items: typeof assets; isArchetype: boolean }> = [];
    const singletonExtras: typeof assets = [];
    for (const [key, items] of archetypeBuckets.entries()) {
      if (items.length >= 2) {
        archetypeGroups.push({ label: `${key} · ${items.length} 变体`, items, isArchetype: true });
      } else {
        singletonExtras.push(...items);
      }
    }

    // 2. 单变体(含 archetypeKey 只有 1 个的 + 没填 archetypeKey 的)按 characterRole 大类
    const allSingletons = [...singletons, ...singletonExtras];
    const buckets: Record<string, typeof assets> = {
      主演: [],
      配角: [],
      群演: [],
      未分类: [],
    };
    for (const a of allSingletons) {
      const role = a.characterRole ?? '';
      if (role.startsWith('主演')) buckets['主演']!.push(a);
      else if (role.startsWith('配角')) buckets['配角']!.push(a);
      else if (role === '群演') buckets['群演']!.push(a);
      else buckets['未分类']!.push(a);
    }
    const roleGroups = Object.entries(buckets)
      .filter(([, items]) => items.length > 0)
      .map(([label, items]) => ({ label, items, isArchetype: false }));

    return [...archetypeGroups, ...roleGroups];
  }, [assets, currentType]);

  return (
    <div className="flex h-[calc(100vh-2.75rem)] flex-col bg-[hsl(var(--color-background))]">
      {/* 顶部 — 类型 tab + 操作按钮 */}
      <div className="flex h-11 items-center justify-between border-b border-[hsl(var(--color-border))] px-3">
        <div className="flex items-center gap-1">
          {TYPES.map((t) => {
            const Icon = t.icon;
            const active = currentType === t.value;
            const count = active ? (assets?.length ?? 0) : null;
            return (
              <button
                key={t.value}
                onClick={() => selectType(t.value)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded px-2.5 text-[13px]',
                  active
                    ? 'bg-[hsl(var(--color-accent)/0.12)] text-[hsl(var(--color-accent))]'
                    : 'text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]',
                )}
              >
                <Icon className="size-3.5" />
                {t.label}
                {active && count !== null && (
                  <Badge variant="secondary" className="ml-0.5 px-1 text-[9px]">
                    {count}
                  </Badge>
                )}
              </button>
            );
          })}
          {/* 五六收工:同步闸筛选(默认全部,非回归)*/}
          <span className="mx-1 h-4 w-px bg-[hsl(var(--color-border))]" />
          <div className="flex items-center gap-0.5">
            {SYNC_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setSyncFilter(f.value)}
                title={f.title}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[11px]',
                  syncFilter === f.value
                    ? 'bg-[hsl(var(--color-accent)/0.12)] text-[hsl(var(--color-accent))]'
                    : 'text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="gap-1.5 text-xs"
            title="资产-剧集 二次匹配审计"
          >
            <Link href={`/${locale}/projects/${projectId}/art/audit`}>
              <Activity className="size-3.5" />
              审计
            </Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            onClick={() => setGapOpen(true)}
          >
            <ListChecks className="size-3.5" />
            按集补充
          </Button>
          <ArtBatchGenerate
            type={currentType}
            targets={batchTargets}
            onDone={() => void refetch()}
          />
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setBreakdownOpen(true)}
          >
            <Sparkles className="size-3.5" />
            从剧本拆解
          </Button>
          <Button size="sm" variant="default" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            新建资产
          </Button>
        </div>
      </div>

      {/* 主区 */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-[hsl(var(--color-muted-foreground))]" />
          </div>
        ) : !assets || assets.length === 0 ? (
          <EmptyState
            type={currentType}
            syncFilter={syncFilter}
            onClearFilter={() => setSyncFilter('all')}
            onBreakdown={() => setBreakdownOpen(true)}
            onCreate={() => setCreating(true)}
          />
        ) : (
          <div className="space-y-4">
            {grouped.map((g) => (
              <div key={g.label || 'default'}>
                {g.label && (
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                    {g.label} · {g.items.length}
                  </h3>
                )}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
                  {g.items.map((a) => {
                    const heroMediaId =
                      a.type === 'CHARACTER'
                        ? a.portraitMediaId
                        : a.type === 'SCENE'
                          ? a.sceneMainMediaId ?? a.mainMediaId
                          : a.mainMediaId;
                    const heroUrl = heroMediaId
                      ? mediaMap[heroMediaId]?.cdnUrl ?? mediaMap[heroMediaId]?.storageKey
                      : null;
                    return (
                      <AssetCard
                        key={a.id}
                        asset={a}
                        heroUrl={heroUrl}
                        bindings={bindingsByAssetId?.[a.id] ?? []}
                        onClick={() => setEditingAssetId(a.id)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 弹窗 */}
      {editingAssetId && (
        <AssetEditDialog
          assetId={editingAssetId}
          onClose={() => setEditingAssetId(null)}
          onSaved={() => {
            setEditingAssetId(null);
            void refetch();
          }}
        />
      )}
      {creating && (
        <AssetEditDialog
          projectId={projectId}
          createType={currentType}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void refetch();
          }}
        />
      )}
      {breakdownOpen && (
        <BreakdownDialog
          projectId={projectId}
          onClose={() => setBreakdownOpen(false)}
          onSaved={() => {
            setBreakdownOpen(false);
            void refetch();
            toast.success('拆解完成,资产已入库');
          }}
        />
      )}
      {gapOpen && (
        <GapDetectionDialog
          projectId={projectId}
          onClose={() => setGapOpen(false)}
          onOpenBreakdown={() => {
            setGapOpen(false);
            setBreakdownOpen(true);
          }}
        />
      )}
    </div>
  );
}

function EmptyState({
  type,
  syncFilter,
  onClearFilter,
  onBreakdown,
  onCreate,
}: {
  type: AssetType;
  syncFilter: SyncFilter;
  onClearFilter: () => void;
  onBreakdown: () => void;
  onCreate: () => void;
}): React.ReactElement {
  const label =
    type === 'CHARACTER'
      ? '人物'
      : type === 'SCENE'
        ? '场景'
        : type === 'PROP'
          ? '道具'
          : '风格参考';

  // 五六收工:筛选下为空 — 明确告知是「筛选导致」而非没数据,给一键查看全部
  if (syncFilter !== 'all') {
    const filterLabel = syncFilter === 'synced' ? '已同步' : '未同步';
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="mb-3 text-sm font-medium">
          当前「{filterLabel}」筛选下没有{label}资产
        </div>
        <div className="mb-5 text-xs text-[hsl(var(--color-muted-foreground))]">
          可能有其他资产被筛选隐藏了 —— 点下方查看全部
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onClearFilter}>
          查看全部
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="mb-3 text-sm font-medium">还没有任何{label}资产</div>
      <div className="mb-5 text-xs text-[hsl(var(--color-muted-foreground))]">
        从剧本一键拆解,或手动新建
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="default" className="gap-1.5" onClick={onBreakdown}>
          <Sparkles className="size-3.5" />
          从剧本拆解
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onCreate}>
          <Plus className="size-3.5" />
          手动新建
        </Button>
      </div>
    </div>
  );
}
