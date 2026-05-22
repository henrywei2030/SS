'use client';
import * as React from 'react';
import {
  Loader2,
  Merge,
  Split,
  Trash2,
  ArrowUp,
  ArrowDown,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  episodeId: string;
}

type Shot = {
  id: string;
  episodeId: string;
  sceneId: string | null;
  groupId: string | null;
  number: string;
  framing: string | null;
  angle: string | null;
  content: string;
  prompt: string;
  durationS: number;
  priority: 'S' | 'A' | 'B' | 'C' | null;
  positionIdx: number;
  status: string;
};

type Group = {
  id: string;
  episodeId: string;
  number: string;
  positionIdx: number;
  durationS: number;
  prompt: string;
  status: string;
  publishedAt: Date | null;
  shots: Shot[];
};

export function ShotsPane({ episodeId }: Props): React.ReactElement {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.storyboard.listShots.useQuery({
    episodeId,
    grouped: true,
  });

  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  // 切集时清空选中
  React.useEffect(() => {
    setSelected(new Set());
  }, [episodeId]);

  const groups = ((data && 'groups' in data ? data.groups : undefined) ?? []) as Group[];
  const ungrouped = ((data && 'ungrouped' in data ? data.ungrouped : undefined) ?? []) as Shot[];

  // 按 positionIdx 取扁平 shots 数组,供向上/向下合并 lookup
  const flatShots = React.useMemo(() => {
    const all: Shot[] = [];
    for (const g of groups) all.push(...g.shots);
    all.push(...ungrouped);
    return [...all].sort((a, b) => a.positionIdx - b.positionIdx);
  }, [groups, ungrouped]);

  const toggleSelected = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const invalidate = (): void => {
    void utils.storyboard.listShots.invalidate({ episodeId, grouped: true });
    void utils.storyboard.listEpisodes.invalidate();
  };

  // -------- mutations --------
  const mergeShots = trpc.storyboard.mergeShots.useMutation({
    onSuccess: (g) => {
      toast.success(`合并完成 → 组 ${g.number}`);
      setSelected(new Set());
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const splitGroup = trpc.storyboard.splitGroup.useMutation({
    onSuccess: (r) => {
      toast.success(`已拆分,${r.shotCount} 镜回到独立`);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteShot = trpc.storyboard.deleteShot.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // -------- 合并辅助 --------
  const doMergeShots = (shotIds: string[]): void => {
    if (shotIds.length < 2) {
      toast.error('至少选 2 个镜头才能合并');
      return;
    }
    mergeShots.mutate({ shotIds });
  };

  const mergeUpFromSelection = (): void => {
    if (selected.size !== 1) {
      toast.error('"向上合并"需要选 1 个镜头作为锚点');
      return;
    }
    const anchorId = Array.from(selected)[0]!;
    const idx = flatShots.findIndex((s) => s.id === anchorId);
    if (idx <= 0) {
      toast.error('已是首镜,无法向上合并');
      return;
    }
    const prev = flatShots[idx - 1]!;
    doMergeShots([prev.id, anchorId]);
  };

  const mergeDownFromSelection = (): void => {
    if (selected.size !== 1) {
      toast.error('"向下合并"需要选 1 个镜头作为锚点');
      return;
    }
    const anchorId = Array.from(selected)[0]!;
    const idx = flatShots.findIndex((s) => s.id === anchorId);
    if (idx < 0 || idx >= flatShots.length - 1) {
      toast.error('已是末镜,无法向下合并');
      return;
    }
    const next = flatShots[idx + 1]!;
    doMergeShots([anchorId, next.id]);
  };

  const mergeSelected = (): void => {
    // 选中的 shotIds 按 positionIdx 排序
    const ids = flatShots
      .filter((s) => selected.has(s.id))
      .map((s) => s.id);
    doMergeShots(ids);
  };

  const deleteSelected = (): void => {
    if (selected.size === 0) return;
    if (!confirm(`确定删除选中的 ${selected.size} 个分镜?`)) return;
    for (const id of selected) {
      deleteShot.mutate({ shotId: id });
    }
    setSelected(new Set());
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-[hsl(var(--color-muted-foreground))]" />
      </div>
    );
  }

  if (groups.length === 0 && ungrouped.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <div className="max-w-md text-center text-sm text-[hsl(var(--color-muted-foreground))]">
          本集还没有分镜。点击顶部&quot;生成分镜&quot;按钮，系统会读取当前剧本调 LLM 拆镜并预合并组。
        </div>
      </div>
    );
  }

  const hasSelection = selected.size > 0;
  const mutating = mergeShots.isPending || splitGroup.isPending || deleteShot.isPending;

  return (
    <div className="flex h-full flex-col">
      {/* 选中操作栏 */}
      {hasSelection && (
        <div className="flex items-center gap-2 border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-accent)/0.08)] px-4 py-2">
          <Badge variant="default" className="gap-1">
            <span className="font-mono">{selected.size}</span> 选中
          </Badge>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            onClick={mergeUpFromSelection}
            disabled={mutating || selected.size !== 1}
            className="gap-1"
            title="把选中镜头与上一镜合并为一组"
          >
            <ArrowUp className="size-3.5" />
            向上合并
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={mergeDownFromSelection}
            disabled={mutating || selected.size !== 1}
            className="gap-1"
            title="把选中镜头与下一镜合并为一组"
          >
            <ArrowDown className="size-3.5" />
            向下合并
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={mergeSelected}
            disabled={mutating || selected.size < 2}
            className="gap-1"
            title="把所有选中镜头合并为一组(2+)"
          >
            <Merge className="size-3.5" />
            勾选合并
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={deleteSelected}
            disabled={mutating}
            className="gap-1"
          >
            <Trash2 className="size-3.5" />
            删除
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
            className="gap-1"
          >
            <X className="size-3.5" />
            清空
          </Button>
        </div>
      )}

      {/* 分镜表 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] text-xs text-[hsl(var(--color-muted-foreground))]">
            <tr>
              <th className="w-8 px-2 py-2"></th>
              <th className="w-20 px-3 py-2 text-left font-medium">镜号</th>
              <th className="w-28 px-3 py-2 text-left font-medium">拍摄角度景别</th>
              <th className="px-3 py-2 text-left font-medium">剧本内容</th>
              <th className="px-3 py-2 text-left font-medium">提示词(含台词/OS)</th>
              <th className="w-24 px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows
                key={g.id}
                group={g}
                selected={selected}
                onToggleSelect={toggleSelected}
                onSplit={() => splitGroup.mutate({ groupId: g.id })}
                disabled={mutating}
              />
            ))}
            {ungrouped.length > 0 && groups.length > 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="border-t border-[hsl(var(--color-border))] bg-[hsl(var(--color-secondary)/0.3)] px-3 py-1.5 text-[11px] text-[hsl(var(--color-muted-foreground))]"
                >
                  未分组({ungrouped.length})
                </td>
              </tr>
            )}
            {ungrouped.map((s) => (
              <ShotRow
                key={s.id}
                shot={s}
                selected={selected.has(s.id)}
                onToggleSelect={() => toggleSelected(s.id)}
                disabled={mutating}
                indent={false}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 组 + 组内单镜
// ---------------------------------------------------------------------------

function GroupRows({
  group,
  selected,
  onToggleSelect,
  onSplit,
  disabled,
}: {
  group: Group;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onSplit: () => void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <>
      {/* 组头行 */}
      <tr className="border-t-2 border-[hsl(var(--color-border))] bg-[hsl(var(--color-secondary)/0.2)]">
        <td className="px-2 py-2" />
        <td className="px-3 py-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-sm font-semibold">{group.number}</span>
            <span className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
              {group.durationS.toFixed(1)}s · {group.shots.length} 镜
            </span>
            <StatusBadge status={group.status} />
          </div>
        </td>
        <td className="px-3 py-2 text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]" colSpan={2}>
          组
        </td>
        <td className="max-w-[400px] px-3 py-2 text-xs leading-relaxed">
          <div className="line-clamp-3 whitespace-pre-wrap text-[hsl(var(--color-muted-foreground))]">
            {group.prompt}
          </div>
        </td>
        <td className="px-3 py-2 text-right">
          <Button
            size="sm"
            variant="outline"
            onClick={onSplit}
            disabled={disabled}
            className="gap-1"
            title="拆分本组,组内分镜回到独立状态"
          >
            <Split className="size-3.5" />
            拆分
          </Button>
        </td>
      </tr>

      {/* 组内子镜 */}
      {group.shots.map((s) => (
        <ShotRow
          key={s.id}
          shot={s}
          selected={selected.has(s.id)}
          onToggleSelect={() => onToggleSelect(s.id)}
          disabled={disabled}
          indent
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// 单镜行
// ---------------------------------------------------------------------------

function ShotRow({
  shot,
  selected,
  onToggleSelect,
  disabled,
  indent,
}: {
  shot: Shot;
  selected: boolean;
  onToggleSelect: () => void;
  disabled: boolean;
  indent: boolean;
}): React.ReactElement {
  return (
    <tr
      className={cn(
        'border-b border-[hsl(var(--color-border)/0.5)] align-top transition-colors',
        selected && 'bg-[hsl(var(--color-accent)/0.06)]',
      )}
    >
      <td className="px-2 py-2 align-middle">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          disabled={disabled}
          className="size-4 cursor-pointer accent-[hsl(var(--color-accent))]"
        />
      </td>
      <td className={cn('px-3 py-2 font-mono text-xs', indent && 'pl-6')}>
        <div className="flex flex-col gap-0.5">
          <span>{shot.number}</span>
          <span className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
            {shot.durationS.toFixed(1)}s
          </span>
          {shot.priority && (
            <Badge
              variant={shot.priority === 'S' ? 'destructive' : 'secondary'}
              className="w-fit px-1 text-[9px]"
            >
              {shot.priority}
            </Badge>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-xs">
        <span className="font-medium">{shot.framing}</span>{' '}
        <span className="text-[hsl(var(--color-muted-foreground))]">{shot.angle}</span>
      </td>
      <td className="px-3 py-2 text-xs leading-relaxed">{shot.content}</td>
      <td className="max-w-[400px] px-3 py-2 text-xs leading-relaxed">
        <div className="line-clamp-4 whitespace-pre-wrap text-[hsl(var(--color-muted-foreground))]">
          {shot.prompt}
        </div>
      </td>
      <td className="px-3 py-2 text-right text-[10px] text-[hsl(var(--color-muted-foreground))]">
        {/* W3.6 行内编辑入口 */}
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const variant: 'secondary' | 'success' | 'default' =
    status === 'PUBLISHED' ? 'success' : status === 'DRAFT' ? 'secondary' : 'default';
  return (
    <Badge variant={variant} className="w-fit text-[9px]">
      {status}
    </Badge>
  );
}
