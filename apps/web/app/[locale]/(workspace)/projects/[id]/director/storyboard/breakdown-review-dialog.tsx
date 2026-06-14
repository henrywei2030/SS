'use client';

/**
 * 五六-2 · 拆解审阅对话框
 *
 * 调 asset.breakdownProject(从分镜工坊导出的分镜脚本快照 exportId 产富草稿,不写库)→ 按类型分组列出,
 * 每条 新建/更新 徽章 + 勾选 + 可内联编辑 name/description/prompt/bio → 「应用」调 asset.applyBreakdown。
 * 「草稿审阅再应用」:用户拍板,LLM 产出永远先过人眼再落库。
 */
import * as React from 'react';
import { Loader2, Check, ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@ss/api';
import { mergeAssetDrafts } from '@ss/shared';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type BreakdownResult = inferRouterOutputs<AppRouter>['asset']['breakdownProject'];
type CharDraft = BreakdownResult['characters'][number];
type SceneDraft = BreakdownResult['scenes'][number];
type PropDraft = BreakdownResult['props'][number];
type AnyDraft = CharDraft | SceneDraft | PropDraft;

// 审阅态:草稿 + 是否勾选 + 可编辑覆盖(name/description/prompt/bio)
interface ReviewItem {
  draft: AnyDraft;
  selected: boolean;
  name: string;
  description: string;
  prompt: string;
  bio: string; // 仅人物
}

const TYPE_LABEL: Record<string, string> = { CHARACTER: '人物', SCENE: '场景', PROP: '道具' };

function toReviewItem(d: AnyDraft): ReviewItem {
  return {
    draft: d,
    selected: true, // 重新拆解默认全选(以最新覆盖已存在,用户可取消勾选)
    name: d.name,
    description: d.description ?? '',
    prompt: d.prompt ?? '',
    bio: 'bio' in d ? (d.bio ?? '') : '',
  };
}

export function BreakdownReviewDialog({
  projectId,
  exportId,
  onClose,
  onApplied,
}: {
  projectId: string;
  /** v0.2.0 方案丙:从该「分镜脚本快照」(StoryboardExport.id)单次拆解。调用方门禁保证有快照才打开。 */
  exportId: string;
  onClose: () => void;
  onApplied: () => void;
}): React.ReactElement {
  const [items, setItems] = React.useState<ReviewItem[] | null>(null);
  const [warning, setWarning] = React.useState<string | undefined>(undefined);
  const [running, setRunning] = React.useState(true);
  const [phase, setPhase] = React.useState<string>('准备…');

  const breakdown = trpc.asset.breakdownProject.useMutation();

  // v0.2.0 方案丙:从分镜脚本快照(exportId)单次拆解 → 合并去重 → 审阅。
  //   (旧的剧本原文「按集分块 / 分类型 3 并行」多路径已随拆解换源下线 —— 调用方门禁恒传 exportId。)
  const runAll = React.useCallback(async (): Promise<void> => {
    setRunning(true);
    setPhase('从分镜脚本拆解中…');
    try {
      const res = await breakdown.mutateAsync({ projectId, exportId });
      const drafts = mergeAssetDrafts([], [...res.characters, ...res.scenes, ...res.props]);
      setItems(drafts.map(toReviewItem));
      setWarning(res.warning);
      if (drafts.length > 0) {
        toast.success(`拆解完成 · 共 ${drafts.length} 条 · ¥${res.cost.toFixed(4)}`);
      } else {
        toast.warning('未从分镜脚本拆出任何设定 — 可重试或检查该集分镜内容');
      }
    } catch (e) {
      toast.error(`拆解失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, exportId]);

  const apply = trpc.asset.applyBreakdown.useMutation();

  // 进入即自动开始拆解(单次,从分镜脚本快照)
  const startedRef = React.useRef(false);
  React.useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      void runAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setItem = (idx: number, patch: Partial<ReviewItem>): void =>
    setItems((prev) => (prev ? prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)) : prev));

  const selectedCount = items?.filter((i) => i.selected).length ?? 0;

  const handleApply = async (): Promise<void> => {
    if (!items || apply.isPending) return;
    const chosen = items.filter((i) => i.selected);
    if (chosen.length === 0) {
      toast.error('请至少勾选 1 条');
      return;
    }
    const payload = chosen.map((it) => {
      const d = it.draft;
      const isChar = d.type === 'CHARACTER';
      return {
        mode: (d.matchedAssetId ? 'update' : 'create') as 'create' | 'update',
        assetId: d.matchedAssetId ?? undefined,
        type: d.type,
        name: it.name,
        alias: d.alias ?? [],
        description: it.description,
        prompt: it.prompt || '(待补)',
        tags: d.tags ?? [],
        ...(isChar && d.characterRole ? { characterRole: d.characterRole as never } : {}),
        ...(isChar && d.archetypeKey ? { archetypeKey: d.archetypeKey } : {}),
        ...(d.archetypeKey && !isChar ? { archetypeKey: d.archetypeKey } : {}),
        ...(isChar && 'gender' in d && d.gender ? { gender: d.gender } : {}),
        ...(isChar && 'age' in d && typeof d.age === 'number' ? { age: d.age } : {}),
        ...(isChar && 'heightCm' in d && typeof d.heightCm === 'number'
          ? { heightCm: d.heightCm }
          : {}),
        ...(isChar && 'personalityTags' in d && d.personalityTags?.length
          ? { personalityTags: d.personalityTags }
          : {}),
        ...(isChar && it.bio ? { bio: it.bio } : {}),
        // 五七-3:出场集(人物/场景/道具通用)
        ...(d.episodes && d.episodes.length > 0 ? { episodes: d.episodes } : {}),
      };
    });
    // 分批发送(每 CHUNK 条):大批量不再一次性发 —— 避免单请求过大 / 服务端中途重启致整批 Failed to fetch 全丢。
    // 后端按项目内「同名跳过」幂等去重,已落库批次可安全重发 → 失败后再点「应用」只补未完成的。
    const CHUNK = 25;
    const batches: (typeof payload)[] = [];
    for (let i = 0; i < payload.length; i += CHUNK) batches.push(payload.slice(i, i + CHUNK));

    let created = 0;
    let updated = 0;
    let skippedNames = 0;
    let skippedLocked = 0;
    try {
      for (const batch of batches) {
        const res = await apply.mutateAsync({ projectId, items: batch });
        created += res.created.length;
        updated += res.updated;
        skippedNames += res.skippedNames.length;
        skippedLocked += res.skippedLocked.length;
      }
      toast.success(
        `已应用 · 新建 ${created} · 更新 ${updated}` +
          (skippedNames ? ` · 跳过重名 ${skippedNames}` : '') +
          (skippedLocked ? ` · 跳过锁定 ${skippedLocked}` : ''),
      );
      onApplied();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // 传输层错(Failed to fetch:服务端未运行/重启中)翻成人话;并告知已落库部分,重试幂等只补缺
      const friendly = /failed to fetch|networkerror|load failed|fetch failed/i.test(raw)
        ? '无法连接服务器(dev server 可能未运行或正在重启),确认服务在跑后再点「应用」即可'
        : raw;
      const done = created + updated;
      toast.error(
        `应用失败:${friendly}` +
          (done ? ` — 已保存 新建${created}/更新${updated},重试只补未完成的` : ''),
      );
    }
  };

  const hasItems = !!items && items.length > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && !apply.isPending && !running && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>从分镜脚本拆解 · 审阅草稿</DialogTitle>
          <DialogDescription>
            后端模型读取分镜工坊导出的分镜脚本(场结构 + 镜头 + 提示词),产出人物(形象 + 小传)/ 场景 /
            道具设定草稿。
            重新拆解默认全选,会用最新内容覆盖「已存在」条目(含出场集);不想覆盖的取消勾选。可内联微调后应用。
          </DialogDescription>
        </DialogHeader>

        {running && !hasItems ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 text-sm text-[hsl(var(--color-muted-foreground))]">
            <Loader2 className="size-6 animate-spin text-[hsl(var(--color-primary))]" />
            {phase}
            <span className="text-[11px]">从分镜脚本快照拆解,合并去重人物/场景/道具设定…</span>
          </div>
        ) : !hasItems ? (
          <div className="flex h-32 items-center justify-center text-sm text-[hsl(var(--color-destructive))]">
            拆解未返回结果,请关闭重试
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {running && (
              <div className="flex items-center gap-2 rounded border border-[hsl(var(--color-primary))]/30 bg-[hsl(var(--color-primary))]/10 px-2 py-1.5 text-[11px] text-[hsl(var(--color-primary))]">
                <Loader2 className="size-3 animate-spin" /> {phase}
              </div>
            )}
            {warning && (
              <div className="flex items-center gap-1 rounded border border-[hsl(var(--color-warning))]/40 bg-[hsl(var(--color-warning))]/10 px-2 py-1.5 text-[11px] text-[hsl(var(--color-warning))]">
                <TriangleAlert className="size-3 shrink-0" /> {warning}
              </div>
            )}
            {(['CHARACTER', 'SCENE', 'PROP'] as const).map((type) => {
              const groupIdx = items
                .map((it, i) => ({ it, i }))
                .filter(({ it }) => it.draft.type === type);
              if (groupIdx.length === 0) return null;
              return (
                <div key={type}>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                    {TYPE_LABEL[type]} · {groupIdx.length}
                  </div>
                  <div className="space-y-1.5">
                    {groupIdx.map(({ it, i }) => (
                      <ReviewRow key={i} item={it} onChange={(patch) => setItem(i, patch)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={apply.isPending || running}
          >
            取消
          </Button>
          {hasItems && (
            <Button
              size="sm"
              onClick={() => void handleApply()}
              disabled={apply.isPending || running || selectedCount === 0}
            >
              {apply.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              应用 {selectedCount} 条
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewRow({
  item,
  onChange,
}: {
  item: ReviewItem;
  onChange: (patch: Partial<ReviewItem>) => void;
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const d = item.draft;
  const isChar = d.type === 'CHARACTER';
  const inputCls =
    'w-full rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1 text-[11px]';
  return (
    <div
      className={cn(
        'rounded border px-2 py-1.5',
        item.selected
          ? 'border-[hsl(var(--color-accent)/0.5)] bg-[hsl(var(--color-accent)/0.05)]'
          : 'border-[hsl(var(--color-border))]',
      )}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={item.selected}
          onChange={(e) => onChange({ selected: e.target.checked })}
          className="size-3.5 accent-[hsl(var(--color-accent))]"
        />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-1.5 text-left"
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          <span className="truncate text-[12px] font-medium">{item.name}</span>
          {d.matchedAssetId ? (
            <Badge variant="secondary" className="px-1 text-[9px]">
              更新已存在
            </Badge>
          ) : (
            <Badge variant="default" className="px-1 text-[9px]">
              新建
            </Badge>
          )}
          {isChar && 'characterRole' in d && d.characterRole && (
            <span className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
              {d.characterRole}
            </span>
          )}
          {d.episodes && d.episodes.length > 0 && (
            <span className="ml-auto shrink-0 text-[10px] text-[hsl(var(--color-muted-foreground))]">
              第{[...d.episodes].sort((a, b) => a - b).join('·')}集
            </span>
          )}
        </button>
      </div>

      {expanded && (
        <div className="mt-1.5 space-y-1.5 pl-5">
          <div>
            <label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">名称</label>
            <input
              className={inputCls}
              value={item.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </div>
          <div>
            <label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
              {isChar ? '形象设定' : '设定描述'}
            </label>
            <textarea
              className={cn(inputCls, 'min-h-[48px] resize-y')}
              value={item.description}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </div>
          {isChar && (
            <div>
              <label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                人物小传
              </label>
              <textarea
                className={cn(inputCls, 'min-h-[64px] resize-y')}
                value={item.bio}
                onChange={(e) => onChange({ bio: e.target.value })}
              />
            </div>
          )}
          <div>
            <label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
              生图提示词
            </label>
            <textarea
              className={cn(inputCls, 'min-h-[40px] resize-y font-mono')}
              value={item.prompt}
              onChange={(e) => onChange({ prompt: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
