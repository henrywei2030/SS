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
  Pencil,
  Music,
} from 'lucide-react';
import { toast } from 'sonner';

import { normalizePrompt } from '@ss/shared';

import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { ShotEditDialog } from './edit-dialog';

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
  // W7 followup:movement / lighting 4 大预设字段补全
  movement: string | null;
  lighting: string | null;
  // 六八:四维电影级 — 音效设计
  sound: string | null;
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

// ---------------------------------------------------------------------------
// 六八:可拖拽列宽 — 镜号 / 拍摄角度景别 / 剧本内容 三列可拖,提示词列吃剩余宽度。
// localStorage 持久化;表格 table-fixed 让宽度生效,窄屏靠外层 overflow-auto 横滚。
// ---------------------------------------------------------------------------

const COL_WIDTH_KEY = 'ss.storyboard.colWidths';
const COL_WIDTH_DEFAULTS = { num: 72, dims: 240, content: 288 };
type ColWidths = typeof COL_WIDTH_DEFAULTS;

function loadColWidths(): ColWidths {
  if (typeof window === 'undefined') return COL_WIDTH_DEFAULTS;
  try {
    const j = JSON.parse(localStorage.getItem(COL_WIDTH_KEY) ?? '{}') as Partial<ColWidths>;
    return { ...COL_WIDTH_DEFAULTS, ...j };
  } catch {
    return COL_WIDTH_DEFAULTS;
  }
}

function ColResizer({
  onDrag,
  onDone,
}: {
  onDrag: (dx: number) => void;
  onDone: () => void;
}): React.ReactElement {
  const startX = React.useRef(0);
  const handleDown = (e: React.PointerEvent): void => {
    e.preventDefault();
    startX.current = e.clientX;
    const move = (ev: PointerEvent): void => {
      onDrag(ev.clientX - startX.current);
      startX.current = ev.clientX;
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onDone();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <span
      onPointerDown={handleDown}
      title="拖动调整列宽"
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize select-none hover:bg-[hsl(var(--color-accent)/0.35)]"
    />
  );
}

export function ShotsPane({ episodeId }: Props): React.ReactElement {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.storyboard.listShots.useQuery({
    episodeId,
    grouped: true,
  });

  // 六八:列宽状态(拖拽实时更新,松手持久化)
  const [colW, setColW] = React.useState<ColWidths>(loadColWidths);
  const dragCol = (key: keyof ColWidths) => (dx: number) =>
    setColW((w) => ({ ...w, [key]: Math.max(56, Math.min(640, w[key] + dx)) }));
  const persistColW = (): void => {
    setColW((w) => {
      try {
        localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(w));
      } catch {
        /* 隐私模式等存不了就算了,会话内仍生效 */
      }
      return w;
    });
  };

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [editingShot, setEditingShot] = React.useState<Shot | null>(null);

  // 切集时清空选中
  React.useEffect(() => {
    setSelected(new Set());
    setEditingShot(null);
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

  // 三十九收工 perf:flatShots id→index Map,消除多处 findIndex 的 O(n) 扫描
  //   canMergeUp/canMergeDownForShot 在每行 render 调用 → 原 O(n²),现 O(1) lookup
  const flatShotIndexMap = React.useMemo(
    () => new Map(flatShots.map((s, i) => [s.id, i] as const)),
    [flatShots],
  );
  const idxOf = (id: string): number => flatShotIndexMap.get(id) ?? -1;

  // 用户反馈:拆分组后子镜应回到原位置,不能堆底部
  // groups 和 ungrouped 混排,组的"代表位置"取 group.shots[0].positionIdx
  // (即组内首个 shot 的位置 — 这样组始终落在组内首镜的本该位置)
  type MixedRow = { kind: 'group'; data: Group; pos: number } | { kind: 'shot'; data: Shot; pos: number };
  const mixedRows = React.useMemo<MixedRow[]>(() => {
    const rows: MixedRow[] = [];
    for (const g of groups) {
      const firstPos = g.shots[0]?.positionIdx ?? Number.MAX_SAFE_INTEGER;
      rows.push({ kind: 'group', data: g, pos: firstPos });
    }
    for (const s of ungrouped) {
      rows.push({ kind: 'shot', data: s, pos: s.positionIdx });
    }
    return rows.sort((a, b) => a.pos - b.pos);
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
    // 用户反馈 r3:分镜改动需同步到 AIGC — AIGC 直接 query 活表,只需让其 react-query cache 失效
    void utils.aigc.listGroups.invalidate({ episodeId });
    void utils.aigc.getGroupDetail.invalidate();
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
    // 去重(防止 shot 被同时算两次,如锚点 shot 同时也是组内 shot)
    mergeShots.mutate({ shotIds: Array.from(new Set(shotIds)) });
  };

  // 用户反馈:散镜 3 向上合并组 1-2 应该追加进组(变 1-3),而不是新建 2-3 让镜 1 落单
  // 把 shot 展开为其所在组的所有 shotIds(无组时仅返回自身),并入合并
  // r7 audit P2-B2:groupId 指向已删除组时静默 fallback 会丢数据,改为 warn 提示
  const expandToGroupShotIds = (shot: Shot): string[] => {
    if (!shot.groupId) return [shot.id];
    const g = groups.find((x) => x.id === shot.groupId);
    if (!g) {
      console.warn(`[shots-pane] shot ${shot.id} groupId=${shot.groupId} 指向不存在的组,可能数据不一致`);
      return [shot.id];
    }
    return g.shots.map((s) => s.id);
  };

  const mergeUpFromSelection = (): void => {
    if (selected.size !== 1) {
      toast.error('"向上合并"需要选 1 个镜头作为锚点');
      return;
    }
    const anchorId = Array.from(selected)[0]!;
    const idx = idxOf(anchorId);
    if (idx <= 0) {
      toast.error('已是首镜,无法向上合并');
      return;
    }
    const prev = flatShots[idx - 1]!;
    const anchor = flatShots[idx]!;
    doMergeShots([...expandToGroupShotIds(prev), ...expandToGroupShotIds(anchor)]);
  };

  const mergeDownFromSelection = (): void => {
    if (selected.size !== 1) {
      toast.error('"向下合并"需要选 1 个镜头作为锚点');
      return;
    }
    const anchorId = Array.from(selected)[0]!;
    const idx = idxOf(anchorId);
    if (idx < 0 || idx >= flatShots.length - 1) {
      toast.error('已是末镜,无法向下合并');
      return;
    }
    const next = flatShots[idx + 1]!;
    const anchor = flatShots[idx]!;
    doMergeShots([...expandToGroupShotIds(anchor), ...expandToGroupShotIds(next)]);
  };

  // Phase 1.5.3 精炼 9:每行 ↑↓ 按钮直接合并(不需勾选)
  const mergeUpForShot = (shotId: string): void => {
    const idx = idxOf(shotId);
    if (idx <= 0) {
      toast.error('已是首镜,无法向上合并');
      return;
    }
    const prev = flatShots[idx - 1]!;
    const curr = flatShots[idx]!;
    doMergeShots([...expandToGroupShotIds(prev), ...expandToGroupShotIds(curr)]);
  };
  const mergeDownForShot = (shotId: string): void => {
    const idx = idxOf(shotId);
    if (idx < 0 || idx >= flatShots.length - 1) {
      toast.error('已是末镜,无法向下合并');
      return;
    }
    const next = flatShots[idx + 1]!;
    const curr = flatShots[idx]!;
    doMergeShots([...expandToGroupShotIds(curr), ...expandToGroupShotIds(next)]);
  };
  const canMergeUpForShot = (shotId: string): boolean => {
    const idx = idxOf(shotId);
    return idx > 0;
  };
  const canMergeDownForShot = (shotId: string): boolean => {
    const idx = idxOf(shotId);
    return idx >= 0 && idx < flatShots.length - 1;
  };

  const mergeSelected = (): void => {
    // 选中的 shotIds 按 positionIdx 排序
    const ids = flatShots
      .filter((s) => selected.has(s.id))
      .map((s) => s.id);
    doMergeShots(ids);
  };

  const deleteSelected = async (): Promise<void> => {
    if (selected.size === 0) return;
    if (!confirm(`确定删除选中的 ${selected.size} 个分镜?`)) return;
    // 改 Promise.allSettled,避免串行 N 次 mutation + invalidate 风暴
    // 用 mutateAsync 等所有 settle 后再统一 invalidate
    const ids = Array.from(selected);
    const results = await Promise.allSettled(
      ids.map((id) => deleteShot.mutateAsync({ shotId: id })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      toast.error(`删除完成,${failed} 个失败`);
    } else {
      toast.success(`已删除 ${ids.length} 个分镜`);
    }
    setSelected(new Set());
    invalidate();
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

      {/* 分镜表 — 字号由 storyboard-workspace 注入的 --storyboard-fs 控制
       *  主体 td 不写 fontSize 类直接继承 table;辅助元素用 em 相对联动 */}
      <div className="flex-1 overflow-auto">
        {/* 六八:table-fixed + 可拖列宽(镜号/拍摄角度景别/剧本内容),提示词列吃剩余宽度;
         *  min-w 兜底窄屏 — 容器 overflow-auto 横滚,宽屏自适应铺满 */}
        <table
          className="w-full min-w-[720px] table-fixed"
          style={{ fontSize: 'var(--storyboard-fs, 15px)' }}
        >
          <thead className="sticky top-0 border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] text-[length:0.85em] text-[hsl(var(--color-muted-foreground))]">
            <tr>
              <th className="w-8 px-2 py-2"></th>
              <th
                style={{ width: colW.num }}
                className="relative border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2 text-left font-medium"
              >
                镜号
                <ColResizer onDrag={dragCol('num')} onDone={persistColW} />
              </th>
              <th
                style={{ width: colW.dims }}
                className="relative border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2 text-left font-medium"
              >
                拍摄角度景别 · 音效
                <ColResizer onDrag={dragCol('dims')} onDone={persistColW} />
              </th>
              <th
                style={{ width: colW.content }}
                className="relative border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2 text-left font-medium"
              >
                剧本内容
                <ColResizer onDrag={dragCol('content')} onDone={persistColW} />
              </th>
              {/* 提示词:不设宽度,吃所有剩余空间 — 用户要求最宽 */}
              <th className="border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2 text-left font-medium">提示词(含台词/OS)</th>
              <th className="w-20 border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {/* 用户反馈:拆分组后子镜应按 positionIdx 顺序排回组之间(不再底部聚集)
             *  groups 用 group.shots[0].positionIdx 作代表位 + ungrouped 用 shot.positionIdx
             *  排序混合渲染,组和散镜按真实位置插队展示 */}
            {mixedRows.map((row) =>
              row.kind === 'group' ? (
                <GroupRow
                  key={`g-${row.data.id}`}
                  group={row.data}
                  onSplit={() => splitGroup.mutate({ groupId: row.data.id })}
                  onSaved={invalidate}
                  disabled={mutating}
                />
              ) : (
                <ShotRow
                  key={`s-${row.data.id}`}
                  shot={row.data}
                  selected={selected.has(row.data.id)}
                  onToggleSelect={() => toggleSelected(row.data.id)}
                  onEdit={() => setEditingShot(row.data)}
                  onMergeUp={() => mergeUpForShot(row.data.id)}
                  onMergeDown={() => mergeDownForShot(row.data.id)}
                  canMergeUp={canMergeUpForShot(row.data.id)}
                  canMergeDown={canMergeDownForShot(row.data.id)}
                  onDelete={() => {
                    if (confirm(`确定删除分镜 ${row.data.number}?`)) {
                      deleteShot.mutate({ shotId: row.data.id });
                    }
                  }}
                  onSaved={invalidate}
                  disabled={mutating}
                  indent={false}
                />
              ),
            )}
          </tbody>
        </table>
      </div>

      {editingShot && (
        <ShotEditDialog
          shot={editingShot}
          onClose={() => setEditingShot(null)}
          onSaved={() => {
            setEditingShot(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 合并组单行 — 不再展开子镜,组级 prompt 完整显示 + inline 编辑
// 子镜数据仍在 DB,拆分后回到 ungrouped 区可独立编辑
// ---------------------------------------------------------------------------

function GroupRow({
  group,
  onSplit,
  onSaved,
  disabled,
}: {
  group: Group;
  onSplit: () => void;
  onSaved: () => void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <tr className="border-t-2 border-[hsl(var(--color-border))] bg-[hsl(var(--color-secondary)/0.2)]">
      <td className="px-2 py-2 align-top" />
      <td className="border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2 align-top">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[length:1.05em] font-semibold">{group.number}</span>
          <span className="text-[length:0.7em] text-[hsl(var(--color-muted-foreground))]">
            {group.durationS.toFixed(1)} s · {group.shots.length} 镜合并
          </span>
          <StatusBadge status={group.status} />
        </div>
      </td>
      <td className="border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2 align-top">
        <div className="flex flex-col gap-1 text-[hsl(var(--color-muted-foreground))]">
          {group.shots.map((s, i) => (
            <div key={s.id} className="leading-relaxed">
              <span className="mr-1 font-mono text-[length:0.7em]">[{i + 1}]</span>
              <span>{s.framing ?? ''}</span>
              {s.angle && <span className="ml-1">{s.angle}</span>}
              {s.movement && <span className="ml-1">· 运镜:{s.movement}</span>}
              {s.lighting && <span className="ml-1">· 光线:{s.lighting}</span>}
              {/* 六八:组内镜时长也可改(服务端自动重算组总时长) */}
              <span className="ml-1">
                ·{' '}
                <DurationEditor
                  shotId={s.id}
                  value={s.durationS}
                  disabled={disabled}
                  onSaved={onSaved}
                />
              </span>
              {s.sound && (
                <div className="flex items-center gap-1 text-[length:0.82em] text-[hsl(var(--color-muted-foreground))]/75">
                  <Music className="size-3 shrink-0" />
                  {s.sound}
                </div>
              )}
            </div>
          ))}
        </div>
      </td>
      <td className="border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2 align-top">
        <div className="flex flex-col gap-1 text-[hsl(var(--color-muted-foreground))]">
          {group.shots.map((s, i) => (
            <div key={s.id} className="whitespace-pre-wrap leading-relaxed">
              <span className="mr-1 font-mono text-[length:0.7em]">[{i + 1}]</span>
              {s.content}
            </div>
          ))}
        </div>
      </td>
      <td className="border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2 align-top">
        <GroupPromptEditor
          groupId={group.id}
          initialPrompt={group.prompt}
          disabled={disabled}
          onSaved={onSaved}
        />
      </td>
      <td className="border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2 text-right align-top">
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={onSplit}
            disabled={disabled}
            className="gap-1"
            title="拆分本组,组内分镜回到独立状态(数据保留)"
          >
            <Split className="size-3.5" />
            拆分
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// 组级提示词 inline 编辑器
// 默认显示 textarea(自适应高度) · hover/focus 显边框 · 有改动时显保存/取消按钮
// 保存调 storyboard.updateGroup(无 diffNote,inline 场景不收集修改原因)
// ---------------------------------------------------------------------------

// 2026-05-27 audit r12:normalizePrompt 抽到 @ss/shared(server + 前端共用避免漂移)
// 见 packages/shared/src/prompt-utils.ts

function GroupPromptEditor({
  groupId,
  initialPrompt,
  disabled,
  onSaved,
}: {
  groupId: string;
  initialPrompt: string;
  disabled: boolean;
  onSaved: () => void;
}): React.ReactElement {
  const [value, setValue] = React.useState(() => normalizePrompt(initialPrompt));
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // 上游 prompt 变化(refetch 后)同步本地 state · 同时 normalize 空行
  React.useEffect(() => {
    setValue(normalizePrompt(initialPrompt));
  }, [initialPrompt]);

  // 自适应高度:每次内容变化重算
  const autoResize = React.useCallback((): void => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  React.useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  const update = trpc.storyboard.updateGroup.useMutation({
    onSuccess: () => {
      toast.success('已保存 · 改动已记录到 PromptEdit 训练集');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const dirty = value !== normalizePrompt(initialPrompt);

  const handleSave = (): void => {
    if (!dirty) return;
    update.mutate({
      groupId,
      patch: { prompt: value },
    });
  };
  const handleCancel = (): void => {
    // r7 audit:用 normalized 值恢复,与 dirty 判断的基准一致
    // 否则取消后 dirty 立刻误判为 true(因 initialPrompt 含未 normalize 的双换行)
    setValue(normalizePrompt(initialPrompt));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled || update.isPending}
        rows={1}
        className={cn(
          'w-full resize-none rounded border bg-transparent px-2 py-1.5 leading-relaxed whitespace-pre-wrap',
          'font-sans text-[hsl(var(--color-muted-foreground))]',
          'border-transparent hover:border-[hsl(var(--color-border))] focus:border-[hsl(var(--color-accent))] focus:bg-[hsl(var(--color-background))] focus:text-[hsl(var(--color-foreground))] focus:outline-none',
          dirty && 'border-[hsl(var(--color-accent))] bg-[hsl(var(--color-background))] text-[hsl(var(--color-foreground))]',
        )}
        style={{ fontSize: 'inherit' }}
        placeholder="组级提示词 · 直接编辑此文本"
        aria-label="组级提示词"
      />
      {/* 保存按钮永远显示 — 用户反馈 dirty 状态太隐蔽看不到入口
       *  · 无改动时:仅显示字数 + "保存" 灰按钮 disabled
       *  · 有改动:显示 "未保存" + 取消 + 保存(高亮 accent) */}
      <div className="flex items-center justify-end gap-1.5 text-[length:0.7em]">
        <span className={cn('mr-auto', dirty ? 'text-[hsl(var(--color-accent))]' : 'text-[hsl(var(--color-muted-foreground))]')}>
          {value.length} 字{dirty && ' · 未保存'}
        </span>
        {dirty && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCancel}
            disabled={update.isPending}
            className="h-6 gap-1 px-2"
          >
            <X className="size-3" />
            取消
          </Button>
        )}
        <Button
          size="sm"
          variant={dirty ? 'default' : 'outline'}
          onClick={handleSave}
          disabled={!dirty || update.isPending}
          className="h-6 gap-1 px-2"
        >
          {update.isPending ? <Loader2 className="size-3 animate-spin" /> : null}
          保存
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 单镜行
// ---------------------------------------------------------------------------

// 六八:时长行内编辑 — 点击数字 → 数字输入,Enter/失焦保存(updateShot 服务端联动重算组时长)
function DurationEditor({
  shotId,
  value,
  disabled,
  onSaved,
}: {
  shotId: string;
  value: number;
  disabled: boolean;
  onSaved: () => void;
}): React.ReactElement {
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState(String(value));
  const update = trpc.storyboard.updateShot.useMutation({
    onSuccess: () => {
      setEditing(false);
      onSaved();
    },
    onError: (e) => toast.error(`时长保存失败:${e.message}`),
  });
  const commit = (): void => {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0 || n > 60) {
      toast.error('时长需为 0-60 秒之间的数字');
      return;
    }
    const rounded = Math.round(n * 10) / 10;
    if (Math.abs(rounded - value) < 1e-9) {
      setEditing(false);
      return;
    }
    update.mutate({ shotId, patch: { durationS: rounded } });
  };
  if (!editing) {
    return (
      <button
        onClick={() => {
          setVal(String(value));
          setEditing(true);
        }}
        disabled={disabled}
        title="点击修改时长(组内镜修改后组总时长自动重算)"
        className="w-fit cursor-pointer rounded text-left text-[length:0.7em] text-[hsl(var(--color-muted-foreground))] underline decoration-dotted underline-offset-2 hover:text-[hsl(var(--color-accent))] disabled:cursor-default disabled:no-underline"
      >
        {value.toFixed(1)} s
      </button>
    );
  }
  return (
    <input
      type="number"
      step={0.5}
      min={0.5}
      max={60}
      autoFocus
      value={val}
      disabled={update.isPending}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="w-16 rounded border border-[hsl(var(--color-accent))] bg-[hsl(var(--color-background))] px-1 py-0.5 text-[length:0.75em] outline-none"
    />
  );
}

function ShotRow({
  shot,
  selected,
  onToggleSelect,
  onEdit,
  onMergeUp,
  onMergeDown,
  canMergeUp,
  canMergeDown,
  onDelete,
  onSaved,
  disabled,
  indent,
}: {
  shot: Shot;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onMergeUp?: () => void;
  onMergeDown?: () => void;
  canMergeUp?: boolean;
  canMergeDown?: boolean;
  onDelete?: () => void;
  onSaved: () => void;
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
      <td className={cn('border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2 font-mono', indent && 'pl-4')}>
        <div className="flex flex-col gap-0.5">
          <span>{shot.number}</span>
          <DurationEditor
            shotId={shot.id}
            value={shot.durationS}
            disabled={disabled}
            onSaved={onSaved}
          />
          {shot.priority && (
            <Badge
              variant={shot.priority === 'S' ? 'destructive' : 'secondary'}
              className="w-fit px-1 text-[length:0.62em]"
            >
              {shot.priority}
            </Badge>
          )}
        </div>
      </td>
      <td className="border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2">
        {/* 四维同行展示(列宽可拖后允许换行);音效单起一行,与画面参数区分 */}
        <div className="leading-relaxed text-[hsl(var(--color-muted-foreground))]">
          <span>{shot.framing}</span>
          {shot.angle && <span className="ml-1">{shot.angle}</span>}
          {shot.movement && <span className="ml-1">· 运镜:{shot.movement}</span>}
          {shot.lighting && <span className="ml-1">· 光线:{shot.lighting}</span>}
        </div>
        {shot.sound && (
          <div className="mt-0.5 flex items-center gap-1 text-[length:0.82em] leading-relaxed text-[hsl(var(--color-muted-foreground))]/75">
            <Music className="size-3 shrink-0" />
            {shot.sound}
          </div>
        )}
      </td>
      <td className="border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2 leading-relaxed">{shot.content}</td>
      <td className="max-w-[400px] border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2 leading-relaxed">
        <div className="line-clamp-4 whitespace-pre-wrap text-[hsl(var(--color-muted-foreground))]">
          {shot.prompt}
        </div>
      </td>
      <td className="border-l border-[hsl(var(--color-border)/0.4)] px-2 py-2 text-right">
        <div className="flex items-center justify-end gap-0.5">
          {onMergeUp && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onMergeUp}
              disabled={disabled || !canMergeUp}
              className="size-7 p-0"
              title={canMergeUp ? '与上一镜合并为一组' : '已是首镜'}
            >
              <ArrowUp className="size-3.5" />
            </Button>
          )}
          {onMergeDown && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onMergeDown}
              disabled={disabled || !canMergeDown}
              className="size-7 p-0"
              title={canMergeDown ? '与下一镜合并为一组' : '已是末镜'}
            >
              <ArrowDown className="size-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onEdit}
            disabled={disabled}
            className="size-7 p-0"
            title="编辑分镜(改动入 PromptEdit 训练集)"
          >
            <Pencil className="size-3.5" />
          </Button>
          {onDelete && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDelete}
              disabled={disabled}
              className="size-7 p-0 text-[hsl(var(--color-destructive))] hover:bg-[hsl(var(--color-destructive)/0.1)] hover:text-[hsl(var(--color-destructive))]"
              title="删除本分镜"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const variant: 'secondary' | 'success' | 'default' =
    status === 'PUBLISHED' ? 'success' : status === 'DRAFT' ? 'secondary' : 'default';
  return (
    <Badge variant={variant} className="w-fit text-[length:0.62em]">
      {status}
    </Badge>
  );
}
