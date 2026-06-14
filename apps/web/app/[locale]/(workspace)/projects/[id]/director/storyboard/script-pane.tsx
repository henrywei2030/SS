'use client';
import * as React from 'react';
import { Loader2, Edit3, Save, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
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

interface Props {
  episodeId: string;
  projectId: string;
}

// 需求2A:清空全部剧本(项目级)— 软删所有集 + 各集剧本,自动保护已发布/锁定/生成中的集
function ClearAllProjectButton({ projectId }: { projectId: string }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const utils = trpc.useUtils();
  const clear = trpc.script.deleteAllForProject.useMutation({
    onSuccess: (res) => {
      const skipped = res.skippedGenerating + res.skippedLocked;
      toast.success(
        `已清空 ${res.cleared} 集剧本${skipped > 0 ? ` · ${skipped} 集保留(分集列表锁定/生成中)` : ''}`,
      );
      setOpen(false);
      void utils.script.listVersions.invalidate();
      void utils.storyboard.listEpisodes.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 gap-1 text-xs text-[hsl(var(--color-danger))] hover:bg-[hsl(var(--color-danger)/0.1)] hover:text-[hsl(var(--color-danger))]"
        title="清空整个剧本子模块(所有集 + 分集列表),自动保护已发布/锁定/生成中的集"
      >
        <Trash2 className="size-3" />
        清空全部
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && !clear.isPending && setOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>清空全部剧本?</DialogTitle>
            <DialogDescription>
              软删本项目<b>所有集</b>的剧本 + 分集列表(级联清场景/分镜)。
              <br />
              仅<b>分集列表锁定</b>(🔒)及正在生成的集保留 — <b>含已发布的集也会清空</b>。
              <br />
              数据库 deletedAt 标记可手动恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={clear.isPending}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => clear.mutate({ projectId, confirmDelete: true })}
              disabled={clear.isPending}
            >
              {clear.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              确认清空全部
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ScriptPane({ episodeId, projectId }: Props): React.ReactElement {
  const { data: versions, isLoading, refetch } = trpc.script.listVersions.useQuery({ episodeId });
  const current = versions?.find((v) => v.isCurrent);
  const [selectedId, setSelectedId] = React.useState<string | undefined>();
  const [showDeleteAll, setShowDeleteAll] = React.useState(false);

  // 切集时重置选中版本,避免拿到上一集的 scriptId 显示串集
  React.useEffect(() => {
    setSelectedId(undefined);
  }, [episodeId]);

  // 若 selectedId 在新的 versions 列表里已不存在(被删除),也清掉
  React.useEffect(() => {
    if (selectedId && versions && !versions.some((v) => v.id === selectedId)) {
      setSelectedId(undefined);
    }
  }, [selectedId, versions]);

  const selectedVersionId = selectedId ?? current?.id;
  const selectedIsCurrent = !!current && selectedVersionId === current.id;

  const deleteAll = trpc.script.deleteAllForEpisode.useMutation({
    onSuccess: (res) => {
      toast.success(`已清空本集剧本(${res.deletedCount} 个版本删除)`);
      setShowDeleteAll(false);
      void refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-[hsl(var(--color-muted-foreground))]" />
      </div>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-12">
        <div className="max-w-md text-center text-sm text-[hsl(var(--color-muted-foreground))]">
          本集还没有剧本。点击顶部"上传剧本"按钮导入剧本文件。
        </div>
        {/* 需求2A:本集无剧本时也能清空全部(清其他集) */}
        <ClearAllProjectButton projectId={projectId} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 版本切换条 */}
      <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--color-border))] px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[hsl(var(--color-muted-foreground))]">版本</span>
          {versions.map((v) => (
            <VersionPill
              key={v.id}
              version={v}
              active={selectedVersionId === v.id}
              onClick={() => setSelectedId(v.id)}
              onAfterAction={() => void refetch()}
            />
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ClearAllProjectButton projectId={projectId} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDeleteAll(true)}
            className="h-7 gap-1 text-xs text-[hsl(var(--color-danger))] hover:bg-[hsl(var(--color-danger)/0.1)] hover:text-[hsl(var(--color-danger))]"
            title="清空本集所有剧本版本(集本身保留)"
          >
            <Trash2 className="size-3" />
            清空本集
          </Button>
        </div>
      </div>

      {/* 剧本内容 */}
      {selectedVersionId && (
        <ScriptContentView
          scriptId={selectedVersionId}
          episodeId={episodeId}
          isCurrent={selectedIsCurrent}
          onSaved={() => void refetch()}
        />
      )}

      <Dialog open={showDeleteAll} onOpenChange={(o) => !o && !deleteAll.isPending && setShowDeleteAll(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>清空本集所有剧本?</DialogTitle>
            <DialogDescription>
              将软删本集 {versions.length} 个版本的剧本(集本身保留,可重新上传)。
              <br />
              数据库 deletedAt 标记可手动恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDeleteAll(false)} disabled={deleteAll.isPending}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteAll.mutate({ episodeId, confirmDelete: true })}
              disabled={deleteAll.isPending}
            >
              {deleteAll.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              确认清空
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VersionPill({
  version,
  active,
  onClick,
  onAfterAction,
}: {
  version: {
    id: string;
    version: number;
    isCurrent: boolean;
    lockedAt: Date | null;
  };
  active: boolean;
  onClick: () => void;
  onAfterAction: () => void;
}): React.ReactElement {
  const setCurrent = trpc.script.setCurrentVersion.useMutation({
    onSuccess: () => {
      toast.success(`已切换到 V${version.version}`);
      onAfterAction();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <button
      onClick={onClick}
      onDoubleClick={() => !version.isCurrent && setCurrent.mutate({ scriptId: version.id })}
      title={
        version.isCurrent
          ? '当前版本'
          : '点击预览 · 双击设为当前版本'
      }
      className={`flex items-center gap-1 rounded-lg px-2 py-1 transition-colors ${
        active
          ? 'bg-[hsl(var(--color-accent)/0.12)] font-medium text-[hsl(var(--color-accent))] shadow-sm'
          : 'text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]'
      }`}
    >
      V{version.version}
      {version.isCurrent && (
        <Badge variant="success" className="px-1 text-[9px]">
          current
        </Badge>
      )}
      {version.lockedAt && (
        <Badge variant="secondary" className="px-1 text-[9px]">
          locked
        </Badge>
      )}
    </button>
  );
}

function ScriptContentView({
  scriptId,
  episodeId,
  isCurrent,
  onSaved,
}: {
  scriptId: string;
  episodeId: string;
  isCurrent: boolean;
  onSaved: () => void;
}): React.ReactElement {
  const { data, isLoading } = trpc.script.getById.useQuery({ scriptId });

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  // 切换 scriptId 时重置编辑状态
  React.useEffect(() => {
    setEditing(false);
    setDraft('');
  }, [scriptId]);

  const save = trpc.script.saveContent.useMutation({
    onSuccess: (res) => {
      if (res.created) {
        toast.success(`已保存为 V${res.script.version}`);
      } else {
        toast.info('内容未变化,未创建新版本');
      }
      setEditing(false);
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-[hsl(var(--color-muted-foreground))]" />
      </div>
    );
  }

  if (!data) return <></>;

  const startEdit = (): void => {
    setDraft(data.content);
    setEditing(true);
  };

  const cancelEdit = (): void => {
    setEditing(false);
    setDraft('');
  };

  const submitEdit = (): void => {
    if (draft.trim().length === 0) {
      toast.error('剧本内容不能为空');
      return;
    }
    save.mutate({ episodeId, content: draft });
  };

  return (
    <div className="flex flex-1 flex-col">
      {/* 工具条 */}
      <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-4 py-2 text-xs">
        <span className="text-[hsl(var(--color-muted-foreground))]">
          {editing
            ? `编辑中 · 保存将创建新版本(V${(data.version ?? 0) + 1})`
            : isCurrent
              ? '当前版本 · 可编辑'
              : '历史版本 · 只读(切到当前版本可编辑)'}
        </span>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={cancelEdit}
                disabled={save.isPending}
                className="h-7 gap-1 text-xs"
              >
                <X className="size-3" />
                取消
              </Button>
              <Button
                size="sm"
                onClick={submitEdit}
                disabled={save.isPending}
                className="h-7 gap-1 text-xs"
              >
                {save.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Save className="size-3" />
                )}
                保存
              </Button>
            </>
          ) : (
            isCurrent && (
              <Button
                variant="outline"
                size="sm"
                onClick={startEdit}
                className="h-7 gap-1 text-xs"
              >
                <Edit3 className="size-3" />
                编辑
              </Button>
            )
          )}
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-auto p-6">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={save.isPending}
            className="h-full min-h-[60vh] w-full resize-none rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] p-3 font-sans leading-[1.7] text-[hsl(var(--color-foreground))] focus:border-[hsl(var(--color-accent))] focus:outline-none"
            style={{ fontSize: 'var(--storyboard-fs, 15px)' }}
            placeholder="在此编辑剧本内容…"
          />
        ) : (
          <pre
            className="whitespace-pre-wrap font-sans leading-[1.7] text-[hsl(var(--color-foreground))]"
            style={{ fontSize: 'var(--storyboard-fs, 15px)' }}
          >
            {data.content}
          </pre>
        )}
      </div>
    </div>
  );
}
