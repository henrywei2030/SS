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

  // 当前选中 — 从 URL 实时读，跟随 router.replace 立即生效
  const epFromUrl = searchParams.get('ep');
  const tabFromUrl = searchParams.get('tab') === 'script' ? 'script' : 'shots';
  const selectedEpisodeId =
    epFromUrl ?? initialEpisodeId ?? episodes?.[0]?.id;
  const tab: Tab = tabFromUrl ?? initialTab;

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
    <div className="grid h-[calc(100vh-2.75rem)] grid-cols-[260px_1fr] gap-0 bg-[hsl(var(--color-background))]">
      {/* 左栏：分集列表 */}
      <EpisodeSidebar
        episodes={episodes ?? []}
        selectedId={selectedEpisodeId}
        onSelect={selectEpisode}
      />

      {/* 右侧：顶部 bar + tab 内容 */}
      <div className="flex flex-col overflow-hidden">
        <TopBar
          projectId={projectId}
          episodeId={selectedEpisodeId}
          episodeNumber={selectedEpisode?.number}
          tab={tab}
          onTabChange={selectTab}
          onAfterAction={() => void refetchEpisodes()}
        />
        <div className="flex-1 overflow-auto">
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
