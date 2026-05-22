'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

type EpisodeBrief = {
  id: string;
  number: number;
  title: string | null;
  status: string;
  publishedAt: Date | null;
  publishedVersion: number;
  sceneCount: number;
  shotCount: number;
  groupCount: number;
};

interface Props {
  episodes: EpisodeBrief[];
  selectedId?: string;
  onSelect: (episodeId: string) => void;
}

export function EpisodeSidebar({ episodes, selectedId, onSelect }: Props): React.ReactElement {
  return (
    <aside className="flex h-full flex-col border-r border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))]">
      <div className="flex h-11 items-center justify-between border-b border-[hsl(var(--color-border))] px-3">
        <h2 className="text-sm font-medium">分集列表</h2>
        <Badge variant="secondary" className="text-[10px]">
          {episodes.length} 集
        </Badge>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {episodes.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-[hsl(var(--color-muted-foreground))]">
            还没有任何集
          </div>
        ) : (
          episodes.map((ep) => (
            <button
              key={ep.id}
              onClick={() => onSelect(ep.id)}
              className={cn(
                'mb-1 flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors',
                selectedId === ep.id
                  ? 'border-[hsl(var(--color-accent))] bg-[hsl(var(--color-accent)/0.08)]'
                  : 'border-transparent hover:bg-[hsl(var(--color-secondary)/0.5)]',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">第 {ep.number} 集</span>
                <EpisodeStatusBadge ep={ep} />
              </div>
              {ep.title && (
                <span className="truncate text-[11px] text-[hsl(var(--color-muted-foreground))]">
                  {ep.title}
                </span>
              )}
              <div className="flex flex-wrap gap-2 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                <span>{ep.sceneCount} 场</span>
                <span>{ep.shotCount} 镜</span>
                {ep.groupCount > 0 && <span>{ep.groupCount} 组</span>}
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

function EpisodeStatusBadge({ ep }: { ep: EpisodeBrief }): React.ReactElement {
  if (ep.publishedAt) {
    return (
      <Badge variant="success" className="px-1 text-[9px]">
        已发布
      </Badge>
    );
  }
  if (ep.shotCount > 0) {
    return (
      <Badge variant="default" className="px-1 text-[9px]">
        已分镜
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="px-1 text-[9px]">
      草稿
    </Badge>
  );
}
