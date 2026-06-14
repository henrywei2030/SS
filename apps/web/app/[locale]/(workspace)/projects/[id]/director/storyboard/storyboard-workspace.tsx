'use client';
import * as React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

import { trpc } from '@/lib/trpc/client';

import { EpisodeSidebar } from './episode-sidebar';
import { TopBar } from './top-bar';
import { ScriptPane } from './script-pane';
import { ShotsPane } from './shots-pane';
import { InspirationPane } from './inspiration-pane';
import { ScriptBreakdownPane } from './script-breakdown-pane';

// 五六收工:加 'breakdown' tab(剧本拆解三栏文字界面 — 资产列表 / 档案编辑 / 关联)
type Tab = 'inspiration' | 'script' | 'breakdown' | 'shots';

interface Props {
  projectId: string;
  locale: string;
  initialEpisodeId?: string;
  initialTab: Tab;
}

const FONT_SIZE_KEY = 'storyboard.fontSize';
const FONT_SIZES = [11, 12, 13, 14, 15, 16, 17, 18] as const;
type FontSize = (typeof FONT_SIZES)[number];

function readFontSize(): FontSize {
  if (typeof window === 'undefined') return 15;
  const stored = Number(window.localStorage.getItem(FONT_SIZE_KEY));
  return (FONT_SIZES as readonly number[]).includes(stored) ? (stored as FontSize) : 15;
}

export function StoryboardWorkspace({
  projectId,
  locale,
  initialEpisodeId,
  initialTab,
}: Props): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data: episodes, refetch: refetchEpisodes } =
    trpc.storyboard.listEpisodes.useQuery({ projectId });

  const [fontSize, setFontSize] = React.useState<FontSize>(15);
  React.useEffect(() => {
    setFontSize(readFontSize());
  }, []);
  const changeFontSize = (delta: 1 | -1): void => {
    const idx = FONT_SIZES.indexOf(fontSize);
    const next = FONT_SIZES[Math.max(0, Math.min(FONT_SIZES.length - 1, idx + delta))]!;
    setFontSize(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(FONT_SIZE_KEY, String(next));
    }
  };

  // 当前选中 — 从 URL 实时读，跟随 router.replace 立即生效
  const epFromUrl = searchParams.get('ep');
  const rawTab = searchParams.get('tab');
  // tab fallback 链:URL 显式四 tab 之一优先,否则用 initialTab(SSR 注入),否则默认 'shots'
  // 五六收工:加 'breakdown' 分支(剧本拆解三栏)
  const tab: Tab =
    rawTab === 'inspiration'
      ? 'inspiration'
      : rawTab === 'script'
        ? 'script'
        : rawTab === 'breakdown'
          ? 'breakdown'
          : rawTab === 'shots'
            ? 'shots'
            : initialTab;
  const selectedEpisodeId =
    epFromUrl ?? initialEpisodeId ?? episodes?.[0]?.id;

  const selectedEpisode = React.useMemo(
    () => episodes?.find((e) => e.id === selectedEpisodeId),
    [episodes, selectedEpisodeId],
  );

  // URL 写入 — 用 functional 风格读 latest searchParams,避免连续 patch 丢更新
  const updateUrl = React.useCallback(
    (patch: { ep?: string; tab?: Tab }): void => {
      const params = new URLSearchParams(window.location.search);
      if (patch.ep !== undefined) params.set('ep', patch.ep);
      if (patch.tab !== undefined) params.set('tab', patch.tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  const selectEpisode = (id: string): void => updateUrl({ ep: id });
  const selectTab = (t: Tab): void => updateUrl({ tab: t });

  // 五七-2:分集列表仅 剧本管理 / 分镜工坊 需要(灵感创作/剧本拆解项目级)
  const showSidebar = tab !== 'inspiration' && tab !== 'breakdown';

  return (
    // 五七-2 布局重构:顶部 TopBar(4 tab + 操作)提到全宽行,tab 永远最左对齐;
    //   分集列表移到下方 grid 内,不再把 tab 挤右。外层 flex-col。
    <div
      className="flex h-[calc(100vh-2.75rem)] flex-col overflow-hidden bg-[hsl(var(--color-background))]"
      style={{ ['--storyboard-fs' as string]: `${fontSize}px` }}
    >
      <TopBar
        projectId={projectId}
        episodeId={selectedEpisodeId}
        episodeNumber={selectedEpisode?.number}
        tab={tab}
        onTabChange={selectTab}
        fontSize={fontSize}
        onFontSizeChange={changeFontSize}
        onAfterAction={() => void refetchEpisodes()}
      />

      <div
        className={`grid min-h-0 flex-1 gap-0 overflow-hidden ${
          showSidebar ? 'grid-cols-[260px_1fr]' : 'grid-cols-1'
        }`}
      >
        {/* 左栏：分集列表 — 仅 剧本管理 / 分镜工坊 */}
        {showSidebar && (
          <EpisodeSidebar
            episodes={episodes ?? []}
            selectedId={selectedEpisodeId}
            onSelect={selectEpisode}
            onAfterArchive={(archivedId) => {
              // 删的是当前选中集 → 清 URL 上的 ep,让 selectedId 落到第一集
              if (archivedId === selectedEpisodeId) {
                const params = new URLSearchParams(window.location.search);
                params.delete('ep');
                router.replace(`${pathname}?${params.toString()}`, { scroll: false });
              }
            }}
          />
        )}

        <div className="min-h-0 overflow-auto">
          {tab === 'inspiration' ? (
            // 灵感创作是项目级(不依赖选中集)— 想法 → LLM 生成多集剧本草稿
            <InspirationPane projectId={projectId} />
          ) : tab === 'breakdown' ? (
            // 五六收工:剧本拆解 = 项目级三栏文字界面(资产列表 + 档案编辑 + 关联)
            <ScriptBreakdownPane projectId={projectId} />
          ) : !selectedEpisodeId ? (
            <EmptyEpisodeState projectId={projectId} locale={locale} />
          ) : tab === 'script' ? (
            <ScriptPane episodeId={selectedEpisodeId} projectId={projectId} />
          ) : (
            <ShotsPane episodeId={selectedEpisodeId} />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyEpisodeState({
  projectId: _projectId,
  locale: _locale,
}: {
  projectId: string;
  locale: string;
}): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center p-12">
      <div className="max-w-md text-center">
        <h2 className="mb-2 text-lg font-medium">本项目暂无集数</h2>
        <p className="text-sm text-[hsl(var(--color-muted-foreground))]">
          先上传 docx 剧本或追加集数，即可开始拆分镜。
          可在顶部"上传 docx"按钮（剧本 tab）操作。
        </p>
      </div>
    </div>
  );
}
