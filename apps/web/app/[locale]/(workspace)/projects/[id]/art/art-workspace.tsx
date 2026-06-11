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
  Mic,
  LayoutGrid,
} from 'lucide-react';
import { toast } from 'sonner';

import { characterNeedsVoice } from '@ss/shared';
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
// 六八:总览视图(全类型 + 按出场集数筛选 + 对筛中缺图资产同步生成)
type ViewType = 'OVERVIEW' | AssetType;

const TYPES: Array<{ value: AssetType; label: string; icon: React.ElementType }> = [
  { value: 'CHARACTER', label: '人物', icon: User },
  { value: 'SCENE', label: '场景', icon: Mountain },
  { value: 'PROP', label: '道具', icon: Package },
  { value: 'STYLE_REFERENCE', label: '风格参考', icon: Palette },
];

// 各类型「主图」槽位 — 同步生成 / 缺图判定用(对齐网格 hero 取图逻辑)
const PRIMARY_SLOT: Record<AssetType, Slot> = {
  CHARACTER: 'portrait',
  SCENE: 'three_view',
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
  initialType: ViewType;
}

export function ArtWorkspace({ projectId, locale, initialType }: Props): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const typeFromUrl = (searchParams.get('type') as ViewType | null) ?? initialType;
  const currentType: ViewType =
    typeFromUrl === 'OVERVIEW' || TYPES.some((t) => t.value === typeFromUrl)
      ? typeFromUrl
      : initialType;
  const isOverview = currentType === 'OVERVIEW';

  const [editingAssetId, setEditingAssetId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const [gapOpen, setGapOpen] = React.useState(false);
  const [syncFilter, setSyncFilter] = React.useState<SyncFilter>('all');

  const { data, isLoading, refetch } = trpc.asset.list.useQuery({
    projectId,
    // 六八总览:不传 type = 全类型一把拉(list 本就支持可选 type)
    ...(isOverview ? {} : { type: currentType as AssetType }),
    syncFilter,
  });
  const assets = data?.assets;
  const mediaMap = data?.mediaMap ?? {};

  // 六八总览:出场集数筛选(单选/多选;空 = 全部)。数据源 Asset.episodes(拆解已填)
  const [selectedEpisodes, setSelectedEpisodes] = React.useState<Set<number>>(new Set());
  const episodeOptions = React.useMemo(() => {
    if (!isOverview || !assets) return [];
    const eps = new Set<number>();
    for (const a of assets) for (const e of a.episodes ?? []) eps.add(e);
    return Array.from(eps).sort((x, y) => x - y);
  }, [assets, isOverview]);
  const toggleEpisode = (n: number): void => {
    setSelectedEpisodes((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  // 视图内可见资产:总览 = 按选中集数过滤(任一命中);分类 tab = 原样
  const visibleAssets = React.useMemo(() => {
    if (!assets) return assets;
    if (!isOverview || selectedEpisodes.size === 0) return assets;
    return assets.filter((a) => (a.episodes ?? []).some((e) => selectedEpisodes.has(e)));
  }, [assets, isOverview, selectedEpisodes]);

  // W6 polish:batch 查所有 asset 的 binding(替原 AssetCard 内 N 次 useQuery)
  const assetIds = React.useMemo(() => assets?.map((a) => a.id) ?? [], [assets]);
  const { data: bindingsByAssetId } = trpc.asset.listBindingsByAssetIds.useQuery(
    { projectId, assetIds },
    { enabled: assetIds.length > 0 },
  );

  // 「同步生成」目标 — 视图内「缺主图」的资产。七二第八波:场景主资产=九宫格(threeView),
  //   缺九宫格即列入(不再看主视角);展示 hero 仍兜底旧 sceneMain 见下方网格。
  // 六八总览:作用于按集数筛选后的资产 → "这些集需要的资产一键补图"
  const batchTargets: BatchTarget[] = React.useMemo(() => {
    if (!visibleAssets) return [];
    return visibleAssets
      .filter((a) => {
        const hero =
          a.type === 'CHARACTER'
            ? a.portraitMediaId
            : a.type === 'SCENE'
              ? a.threeViewMediaId
              : a.mainMediaId;
        return !hero;
      })
      .map((a) => ({ id: a.id, name: a.name, slot: PRIMARY_SLOT[a.type as AssetType] }));
  }, [visibleAssets]);

  // 七二第六波(用户需求):「一键生成三视图」批量目标 — 人物 tab 下有形象图但缺三视图者,
  //   以已确认形象图(portrait)为参考图生图生成三视图(refImageIds=[portrait], strength=0.7),
  //   保证三视图与形象一致。复用 ArtBatchGenerate 的 3 并发池 + 进度/重试。
  const threeViewTargets: BatchTarget[] = React.useMemo(() => {
    if (currentType !== 'CHARACTER' || !visibleAssets) return [];
    return visibleAssets
      .filter((a) => a.type === 'CHARACTER' && a.portraitMediaId && !a.threeViewMediaId)
      .map((a) => ({
        id: a.id,
        name: a.name,
        slot: 'three_view' as Slot,
        refImageIds: [a.portraitMediaId as string],
        strength: 0.7,
      }));
  }, [visibleAssets, currentType]);

  // 六八:批量按设定生成声线 — 人物 tab 下「需要声线」(主演/配角,群演不需要)且缺的数量
  const voiceMissingCount = React.useMemo(
    () =>
      currentType === 'CHARACTER'
        ? (assets ?? []).filter(
            (a) => characterNeedsVoice(a.characterRole) && !a.voiceMediaId,
          ).length
        : 0,
    [assets, currentType],
  );
  // 六八:重算出场集 — 用剧本场次真相回填 Asset.episodes(分块拆解漏标修复,幂等)
  const recomputeEpMut = trpc.asset.recomputeEpisodes.useMutation({
    onSuccess: (r) => {
      toast.success(`出场集已重算:扫描 ${r.scanned} 个资产,补全 ${r.updated} 个`);
      void refetch();
    },
    onError: (e) => toast.error(`重算失败:${e.message}`),
  });

  const batchVoiceMut = trpc.asset.batchGenerateVoiceSamples.useMutation({
    onSuccess: (r) => {
      toast.info(
        r.queued > 0
          ? `已入队 ${r.queued} 个人物的声线生成(按设定推荐声线,本地免费${r.modelsReady ? '' : ',首次自动下载模型 ~850MB'}),完成后自动设为参考音频`
          : '没有缺声线的人物',
      );
    },
    onError: (e) => toast.error(`批量生成发起失败:${e.message}`),
  });

  const selectType = (t: ViewType): void => {
    const params = new URLSearchParams(window.location.search);
    params.set('type', t);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // 人物 — 优先按 archetypeKey 分组(同人物多变体),再按 characterRole 大类
  // 场景/道具/风格 — 平铺;总览 — 按类型分区
  const grouped = React.useMemo(() => {
    const assets = visibleAssets;
    if (!assets) return [];
    if (isOverview) {
      return TYPES.map((t) => ({
        label: t.label,
        items: assets.filter((a) => a.type === t.value),
        isArchetype: false,
      })).filter((g) => g.items.length > 0);
    }
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
  }, [visibleAssets, isOverview, currentType]);

  return (
    <div className="flex h-[calc(100vh-2.75rem)] flex-col bg-[hsl(var(--color-background))]">
      {/* 顶部 — 类型 tab + 操作按钮 */}
      <div className="flex h-11 items-center justify-between border-b border-[hsl(var(--color-border))] px-3">
        <div className="flex items-center gap-1">
          {/* 六八:资产总览 — 全类型 + 按出场集数筛选 + 对筛中缺图资产同步生成 */}
          <button
            onClick={() => selectType('OVERVIEW')}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded px-2.5 text-[13px]',
              isOverview
                ? 'bg-[hsl(var(--color-accent)/0.12)] text-[hsl(var(--color-accent))]'
                : 'text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]',
            )}
          >
            <LayoutGrid className="size-3.5" />
            总览
            {isOverview && (
              <Badge variant="secondary" className="ml-0.5 px-1 text-[9px]">
                {visibleAssets?.length ?? 0}
              </Badge>
            )}
          </button>
          <span className="mx-1 h-4 w-px bg-[hsl(var(--color-border))]" />
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
          {/* 六八:为缺声线人物批量按设定生成(推荐声线,本地零扣费,静默成功通知) */}
          {currentType === 'CHARACTER' && voiceMissingCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              disabled={batchVoiceMut.isPending}
              title="为所有还没有参考声线的人物按设定(声音描述/性别/年龄 → 推荐种子声线)本地生成,零扣费;完成后自动设为各自参考音频,视频生成时人到声到"
              onClick={() => batchVoiceMut.mutate({ projectId })}
            >
              {batchVoiceMut.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Mic className="size-3.5" />
              )}
              生成缺失声线 ({voiceMissingCount})
            </Button>
          )}
          {/* 七二第六波:一键根据人物形象图批量生成三视图(图生图,以形象图为参考保证一致) */}
          {currentType === 'CHARACTER' && threeViewTargets.length > 0 && (
            <ArtBatchGenerate
              type="CHARACTER"
              targets={threeViewTargets}
              onDone={() => void refetch()}
              buttonText="生成三视图"
              itemLabel="三视图"
            />
          )}
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

      {/* 六八总览:出场集数筛选条(单选/多选;空 = 全部集) */}
      {isOverview && episodeOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-[hsl(var(--color-border))] px-3 py-1.5">
          <span className="mr-1 text-[11px] text-[hsl(var(--color-muted-foreground))]">
            出场集数:
          </span>
          <button
            onClick={() => setSelectedEpisodes(new Set())}
            className={cn(
              'rounded px-1.5 py-0.5 text-[11px]',
              selectedEpisodes.size === 0
                ? 'bg-[hsl(var(--color-accent)/0.12)] text-[hsl(var(--color-accent))]'
                : 'text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]',
            )}
          >
            全部
          </button>
          {episodeOptions.map((n) => (
            <button
              key={n}
              onClick={() => toggleEpisode(n)}
              title="点击多选/取消"
              className={cn(
                'rounded px-1.5 py-0.5 text-[11px]',
                selectedEpisodes.has(n)
                  ? 'bg-[hsl(var(--color-accent)/0.12)] text-[hsl(var(--color-accent))]'
                  : 'text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]',
              )}
            >
              第{n}集
            </button>
          ))}
          {selectedEpisodes.size > 0 && (
            <span className="ml-2 text-[11px] text-[hsl(var(--color-muted-foreground))]">
              已选 {selectedEpisodes.size} 集 · 命中 {visibleAssets?.length ?? 0} 个资产
              {batchTargets.length > 0 && ` · 其中 ${batchTargets.length} 个缺主图(可同步生成)`}
            </span>
          )}
          <button
            onClick={() => recomputeEpMut.mutate({ projectId })}
            disabled={recomputeEpMut.isPending}
            title="用剧本场次真相(每场的人物/地点/原文)重新计算所有资产的出场集并补全(只增不删,分块拆解漏标时用)"
            className="ml-auto rounded border border-[hsl(var(--color-border))] px-1.5 py-0.5 text-[11px] text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)] disabled:opacity-50"
          >
            {recomputeEpMut.isPending ? '重算中…' : '重算出场集'}
          </button>
        </div>
      )}

      {/* 主区 */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-[hsl(var(--color-muted-foreground))]" />
          </div>
        ) : isOverview && selectedEpisodes.size > 0 && (visibleAssets?.length ?? 0) === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="text-sm font-medium">所选集数没有命中任何资产</div>
            <Button size="sm" variant="outline" onClick={() => setSelectedEpisodes(new Set())}>
              查看全部集数
            </Button>
          </div>
        ) : !visibleAssets || visibleAssets.length === 0 ? (
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
                <div
                  className={cn(
                    'grid gap-2.5',
                    // 六八:场景卡 16:9 缩略 + 名称在 150px 网格下太挤看不清 → 场景区放大
                    (isOverview ? g.label === '场景' : currentType === 'SCENE')
                      ? 'grid-cols-[repeat(auto-fill,minmax(240px,1fr))]'
                      : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]',
                  )}
                >
                  {g.items.map((a) => {
                    const heroMediaId =
                      a.type === 'CHARACTER'
                        ? a.portraitMediaId
                        : a.type === 'SCENE'
                          ? a.threeViewMediaId ?? a.sceneMainMediaId ?? a.mainMediaId
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
          createType={isOverview ? 'CHARACTER' : currentType}
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
  type: ViewType;
  syncFilter: SyncFilter;
  onClearFilter: () => void;
  onBreakdown: () => void;
  onCreate: () => void;
}): React.ReactElement {
  const label =
    type === 'OVERVIEW'
      ? ''
      : type === 'CHARACTER'
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
