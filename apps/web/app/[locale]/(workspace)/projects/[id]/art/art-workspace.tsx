'use client';
import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  User,
  Mountain,
  Package,
  Palette,
  Plus,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { AssetCard } from './asset-card';
import { AssetEditDialog } from './asset-edit-dialog';
import { BreakdownDialog } from './breakdown-dialog';

type AssetType = 'CHARACTER' | 'SCENE' | 'PROP' | 'STYLE_REFERENCE';

const TYPES: Array<{ value: AssetType; label: string; icon: React.ElementType }> = [
  { value: 'CHARACTER', label: '人物', icon: User },
  { value: 'SCENE', label: '场景', icon: Mountain },
  { value: 'PROP', label: '道具', icon: Package },
  { value: 'STYLE_REFERENCE', label: '风格参考', icon: Palette },
];

interface Props {
  projectId: string;
  locale: string;
  initialType: AssetType;
}

export function ArtWorkspace({ projectId, initialType }: Props): React.ReactElement {
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

  const { data: assets, isLoading, refetch } = trpc.asset.list.useQuery({
    projectId,
    type: currentType,
  });

  const selectType = (t: AssetType): void => {
    const params = new URLSearchParams(window.location.search);
    params.set('type', t);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // 人物按 characterRole 分组(主演 / 配角 / 群演)
  const grouped = React.useMemo(() => {
    if (!assets) return [];
    if (currentType !== 'CHARACTER') {
      return [{ label: '', items: assets }];
    }
    const buckets: Record<string, typeof assets> = {
      '主演': [],
      '配角': [],
      '群演': [],
      '未分类': [],
    };
    for (const a of assets) {
      const role = a.characterRole ?? '';
      if (role.startsWith('主演')) buckets['主演']!.push(a);
      else if (role.startsWith('配角')) buckets['配角']!.push(a);
      else if (role === '群演') buckets['群演']!.push(a);
      else buckets['未分类']!.push(a);
    }
    return Object.entries(buckets)
      .filter(([, items]) => items.length > 0)
      .map(([label, items]) => ({ label, items }));
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
        </div>
        <div className="flex items-center gap-2">
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
      <div className="flex-1 overflow-auto p-5">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-[hsl(var(--color-muted-foreground))]" />
          </div>
        ) : !assets || assets.length === 0 ? (
          <EmptyState
            type={currentType}
            onBreakdown={() => setBreakdownOpen(true)}
            onCreate={() => setCreating(true)}
          />
        ) : (
          <div className="space-y-6">
            {grouped.map((g) => (
              <div key={g.label || 'default'}>
                {g.label && (
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                    {g.label} · {g.items.length}
                  </h3>
                )}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {g.items.map((a) => (
                    <AssetCard
                      key={a.id}
                      asset={a}
                      onClick={() => setEditingAssetId(a.id)}
                    />
                  ))}
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
    </div>
  );
}

function EmptyState({
  type,
  onBreakdown,
  onCreate,
}: {
  type: AssetType;
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
