'use client';

/**
 * 五六-2 · 拆解审阅对话框
 *
 * 调 asset.breakdownProject(从完整剧本产富草稿,不写库)→ 按类型分组列出,
 * 每条 新建/更新 徽章 + 勾选 + 可内联编辑 name/description/prompt/bio → 「应用」调 asset.applyBreakdown。
 * 「草稿审阅再应用」:用户拍板,LLM 产出永远先过人眼再落库。
 */
import * as React from 'react';
import { Loader2, Sparkles, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@ss/api';

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

export function BreakdownReviewDialog({
  projectId,
  onClose,
  onApplied,
}: {
  projectId: string;
  onClose: () => void;
  onApplied: () => void;
}): React.ReactElement {
  const [items, setItems] = React.useState<ReviewItem[] | null>(null);
  const [warning, setWarning] = React.useState<string | undefined>(undefined);
  const [running, setRunning] = React.useState(true);
  const [phase, setPhase] = React.useState<string>('准备…');

  const breakdown = trpc.asset.breakdownProject.useMutation();

  // 五六-2 链路优化:分类型 3 次拆(每次整本剧本作上下文,只产一类,避免非流式中转单请求超时),
  //   **并行**发起(原串行 ~3× 墙钟 → 并行 ≈ 最慢一类的耗时),每类完成即增量显示,某类失败不影响其余。
  //   moyu 中转 connections=32,3 并发已是项目验证过的安全并发(对齐 storyboard LLM_CONCURRENCY=3)。
  const runAll = React.useCallback(async (): Promise<void> => {
    setRunning(true);
    setPhase('并行拆解中…(0/3)');
    const TYPES = [
      { t: 'CHARACTER' as const, label: '人物' },
      { t: 'SCENE' as const, label: '场景' },
      { t: 'PROP' as const, label: '道具' },
    ];
    const acc: ReviewItem[] = []; // 单线程事件循环,各 .then 顺序执行,push 无竞态
    let totalCost = 0;
    let warn: string | undefined;
    const errs: string[] = [];
    let done = 0;

    await Promise.all(
      TYPES.map((cur) =>
        breakdown
          .mutateAsync({ projectId, type: cur.t })
          .then((res) => {
            totalCost += res.cost;
            if (res.warning) warn = res.warning;
            const drafts: AnyDraft[] =
              cur.t === 'CHARACTER' ? res.characters : cur.t === 'SCENE' ? res.scenes : res.props;
            for (const d of drafts) {
              acc.push({
                draft: d,
                selected: true, // 五七-3:重新拆解默认全选 —— 以最新内容覆盖已存在(用户拍板);不想覆盖可取消勾选
                name: d.name,
                description: d.description ?? '',
                prompt: d.prompt ?? '',
                bio: 'bio' in d ? (d.bio ?? '') : '',
              });
            }
            // 审阅 UI 按类型分组渲染,插入顺序无关 → 增量 setItems 即可
            setItems([...acc]);
          })
          .catch((e) => {
            errs.push(`${cur.label}:${e instanceof Error ? e.message : String(e)}`);
          })
          .finally(() => {
            done += 1;
            setPhase(`并行拆解中…(${done}/3)`);
          }),
      ),
    );

    setWarning(warn);
    if (acc.length > 0) {
      toast.success(
        `拆解完成 · 共 ${acc.length} 条 · ¥${totalCost.toFixed(4)}` +
          (errs.length ? ` · ${errs.length} 类失败` : ''),
      );
    }
    if (errs.length) toast.error(`部分类型失败:${errs[0]}${acc.length ? ' — 可应用已得结果或重试' : ''}`);
    setRunning(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const apply = trpc.asset.applyBreakdown.useMutation({
    onSuccess: (res) => {
      toast.success(
        `已应用 · 新建 ${res.created.length} · 更新 ${res.updated}` +
          (res.skippedNames.length ? ` · 跳过重名 ${res.skippedNames.length}` : '') +
          (res.skippedLocked.length ? ` · 跳过锁定 ${res.skippedLocked.length}` : ''),
      );
      onApplied();
    },
    onError: (e) => toast.error(`应用失败:${e.message}`),
  });

  // 进入即自动开始(分类型循环)
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

  const handleApply = (): void => {
    if (!items) return;
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
        ...(isChar && 'heightCm' in d && typeof d.heightCm === 'number' ? { heightCm: d.heightCm } : {}),
        ...(isChar && 'personalityTags' in d && d.personalityTags?.length
          ? { personalityTags: d.personalityTags }
          : {}),
        ...(isChar && it.bio ? { bio: it.bio } : {}),
        // 五七-3:出场集(人物/场景/道具通用)
        ...(d.episodes && d.episodes.length > 0 ? { episodes: d.episodes } : {}),
      };
    });
    apply.mutate({ projectId, items: payload });
  };

  const hasItems = !!items && items.length > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && !apply.isPending && !running && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>从完整剧本拆解 · 审阅草稿</DialogTitle>
          <DialogDescription>
            后端模型分批读取本项目完整剧本,产出人物(形象 + 小传)/ 场景 / 道具设定草稿。
            重新拆解默认全选,会用最新内容覆盖「已存在」条目(含出场集);不想覆盖的取消勾选。可内联微调后应用。
          </DialogDescription>
        </DialogHeader>

        {running && !hasItems ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 text-sm text-[hsl(var(--color-muted-foreground))]">
            <Loader2 className="size-6 animate-spin text-[hsl(var(--color-primary))]" />
            {phase}
            <span className="text-[11px]">分类型读取完整剧本拆解中,避免单次超时…</span>
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
              <div className="rounded border border-[hsl(var(--color-warning))]/40 bg-[hsl(var(--color-warning))]/10 px-2 py-1.5 text-[11px] text-[hsl(var(--color-warning))]">
                ⚠️ {warning}
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
          <Button variant="outline" size="sm" onClick={onClose} disabled={apply.isPending || running}>
            取消
          </Button>
          {hasItems && (
            <Button
              size="sm"
              onClick={handleApply}
              disabled={apply.isPending || running || selectedCount === 0}
            >
              {apply.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
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
            <input className={inputCls} value={item.name} onChange={(e) => onChange({ name: e.target.value })} />
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
              <label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">人物小传</label>
              <textarea
                className={cn(inputCls, 'min-h-[64px] resize-y')}
                value={item.bio}
                onChange={(e) => onChange({ bio: e.target.value })}
              />
            </div>
          )}
          <div>
            <label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">生图提示词</label>
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
