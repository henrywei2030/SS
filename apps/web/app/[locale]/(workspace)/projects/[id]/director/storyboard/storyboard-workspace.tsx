'use client';
import * as React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

import { trpc } from '@/lib/trpc/client';

import { EpisodeSidebar } from './episode-sidebar';
import { TopBar } from './top-bar';
import { ScriptPane } from './script-pane';
import { ShotsPane } from './shots-pane';

type Tab = 'script' | 'shots';

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
  // tab fallback 链:URL 显式 script/shots 优先,否则用 initialTab(SSR 注入),否则默认 'shots'
  const tab: Tab =
    rawTab === 'script' ? 'script' : rawTab === 'shots' ? 'shots' : initialTab;
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

  return (
    <div
      className="grid h-[calc(100vh-2.75rem)] grid-cols-[260px_1fr] gap-0 overflow-hidden bg-[hsl(var(--color-background))]"
      style={{ ['--storyboard-fs' as string]: `${fontSize}px` }}
    >
      {/* 左栏：分集列表 */}
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

      {/* 右侧：顶部 bar + tab 内容 */}
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
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
        <div className="min-h-0 flex-1 overflow-auto">
          {!selectedEpisodeId ? (
            <EmptyEpisodeState projectId={projectId} locale={locale} />
          ) : tab === 'script' ? (
            <ScriptPane episodeId={selectedEpisodeId} />
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
