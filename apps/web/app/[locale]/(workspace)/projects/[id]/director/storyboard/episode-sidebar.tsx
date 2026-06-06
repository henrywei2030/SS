'use client';
import * as React from 'react';
import { Loader2, Trash2, Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type EpisodeBrief = {
  id: string;
  number: number;
  title: string | null;
  status: string;
  publishedAt: Date | null;
  publishedVersion: number;
  batchLocked: boolean;
  sceneCount: number;
  shotCount: number;
  groupCount: number;
  hasUnpublishedChanges: boolean;
};

interface Props {
  episodes: EpisodeBrief[];
  selectedId?: string;
  onSelect: (episodeId: string) => void;
  onAfterArchive?: (archivedId: string) => void;
}

export function EpisodeSidebar({
  episodes,
  selectedId,
  onSelect,
  onAfterArchive,
}: Props): React.ReactElement {
  const [pendingDelete, setPendingDelete] = React.useState<EpisodeBrief | null>(null);
  const utils = trpc.useUtils();

  const archive = trpc.storyboard.archiveEpisode.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`第 ${pendingDelete?.number} 集已删除`);
      setPendingDelete(null);
      void utils.storyboard.listEpisodes.invalidate();
      onAfterArchive?.(vars.episodeId);
    },
    onError: (e) => toast.error(e.message),
  });

  const setLock = trpc.storyboard.setBatchLock.useMutation({
    onSuccess: (res) => {
      toast.success(res.batchLocked ? '已锁定 — 批量生成将跳过本集' : '已解锁 — 可参与批量生成');
      void utils.storyboard.listEpisodes.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-r border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[hsl(var(--color-border))] px-3">
        <h2 className="text-sm font-medium">分集列表</h2>
        <Badge variant="secondary" className="text-[10px]">
          {episodes.length} 集
        </Badge>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {episodes.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-[hsl(var(--color-muted-foreground))]">
            还没有任何集
          </div>
        ) : (
          episodes.map((ep) => (
            <div
              key={ep.id}
              className={cn(
                'group relative mb-1 rounded-md border transition-colors',
                selectedId === ep.id
                  ? 'border-[hsl(var(--color-accent))] bg-[hsl(var(--color-accent)/0.08)]'
                  : ep.shotCount > 0
                    ? 'border-green-500/30 bg-green-500/5 hover:bg-green-500/10'
                    : 'border-transparent hover:bg-[hsl(var(--color-secondary)/0.5)]',
              )}
            >
              <button
                onClick={() => onSelect(ep.id)}
                className="flex w-full flex-col gap-1 px-3 py-2 pr-16 text-left"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1 text-sm font-medium">
                    第 {ep.number} 集
                    {ep.batchLocked && (
                      <Lock
                        className="size-3 text-amber-500"
                        aria-label="已锁定 · 批量生成跳过"
                      />
                    )}
                  </span>
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
              {/* hover 时显示操作按钮 — 锁定/解锁 + 删除(发布过的集不显示删除,需走 admin 归档) */}
              <div className="absolute right-1.5 top-1.5 hidden gap-0.5 group-hover:flex">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setLock.mutate({ episodeId: ep.id, locked: !ep.batchLocked });
                  }}
                  disabled={setLock.isPending}
                  title={
                    ep.batchLocked
                      ? '解锁 — 让本集参与批量生成'
                      : '锁定 — 批量生成将跳过本集(单集生成不影响)'
                  }
                  className={cn(
                    'flex size-6 items-center justify-center rounded text-[hsl(var(--color-muted-foreground))]',
                    ep.batchLocked
                      ? 'hover:bg-amber-500/10 hover:text-amber-500'
                      : 'hover:bg-blue-500/10 hover:text-blue-500',
                  )}
                >
                  {ep.batchLocked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
                </button>
                {!ep.publishedAt && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete(ep);
                    }}
                    title="删除本集(可恢复:数据库 deletedAt 标记)"
                    className="flex size-6 items-center justify-center rounded text-[hsl(var(--color-muted-foreground))] hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o && !archive.isPending) setPendingDelete(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除第 {pendingDelete?.number} 集?</DialogTitle>
            <DialogDescription>
              将级联软删本集所有 scene / shot / group / asset binding。
              {pendingDelete && pendingDelete.shotCount > 0 ? (
                <>
                  <br />
                  <span className="text-red-500">
                    本集已有 {pendingDelete.shotCount} 镜 / {pendingDelete.groupCount} 组,
                    删除后无法在此页面恢复(数据库 deletedAt 标记可手动还原)。
                  </span>
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPendingDelete(null)}
              disabled={archive.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() =>
                pendingDelete &&
                archive.mutate({ episodeId: pendingDelete.id, confirmDelete: true })
              }
              disabled={archive.isPending}
            >
              {archive.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function EpisodeStatusBadge({ ep }: { ep: EpisodeBrief }): React.ReactElement {
  // 草稿:还没生成任何分镜
  if (ep.shotCount === 0) {
    return (
      <Badge variant="secondary" className="px-1 text-[9px]">
        草稿
      </Badge>
    );
  }
  // 已发布:发布过且发布后无新改动(分镜/组全是 PUBLISHED)→ 已同步 AIGC
  if (ep.publishedAt && !ep.hasUnpublishedChanges) {
    return (
      <Badge variant="success" className="px-1 text-[9px]">
        已发布
      </Badge>
    );
  }
  // 分镜已生成:有分镜但未发布,或发布后又改了分镜/组(自动整合 / 重新生成)→ 待(重新)发布同步 AIGC
  return (
    <Badge variant="default" className="flex items-center gap-0.5 px-1 text-[9px]">
      <span className="size-1.5 rounded-full bg-blue-400" />分镜已生成
    </Badge>
  );
}
