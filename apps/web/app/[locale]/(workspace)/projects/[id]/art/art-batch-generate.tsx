'use client';
import * as React from 'react';
import { Loader2, Images, X, RotateCw, Sparkles, Check, CircleSlash, Circle } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { Slot } from './asset-edit-shared';

/**
 * 美术工坊「同步生成」(2026-06 需求)— 一键为当前分类下所有「缺主图」的资产各生成 1 张主图并设为槽位。
 *
 * - 主图 = 人物形象图(portrait)/ 场景九宫格(three_view)/ 道具·风格主图(main),由调用方按类型算好传入。
 * - 模型 = binding 默认(当前 = Seedream 5.0 lite),不传 modelId 跟随绑定。
 * - 3 张并发 + 进度条 + 可中断 + 失败重试(复用 storyboard「全部集数生成」同款 pool)。
 * - 生成 1 张后自动 confirmCandidate 设为主图,网格立即填充(refetch by onDone)。
 */

export interface BatchTarget {
  id: string;
  name: string;
  slot: Slot;
  // 七二第六波:图生图批量(如「一键生成三视图」以人物形象图为参考)— 缺省走纯文生图
  refImageIds?: string[];
  strength?: number;
}

const IMAGE_LABEL: Record<string, string> = {
  CHARACTER: '形象图',
  SCENE: '九宫格',
  PROP: '主图',
  STYLE_REFERENCE: '主图',
};
const TYPE_LABEL: Record<string, string> = {
  CHARACTER: '人物',
  SCENE: '场景',
  PROP: '道具',
  STYLE_REFERENCE: '风格参考',
};

type Stat = {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  error?: string;
};

const CONCURRENCY = 3;

export function ArtBatchGenerate({
  type,
  targets,
  onDone,
  buttonText,
  itemLabel,
}: {
  type: string;
  targets: BatchTarget[];
  onDone: () => void;
  /** 七二第六波:按钮文案(默认「同步生成」)— 三视图批量等场景自定义 */
  buttonText?: string;
  /** 生成物名(默认按 type 取 形象图/主视角/主图)— 三视图批量传「三视图」 */
  itemLabel?: string;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const cancelRef = React.useRef(false);
  const [stats, setStats] = React.useState<Stat[]>([]);
  const started = stats.length > 0;
  const doneCount = stats.filter((s) => s.status === 'done').length;
  const failed = stats.filter((s) => s.status === 'failed');

  const { data: providers } = trpc.asset.listImageProviders.useQuery(undefined, { enabled: open });
  const defaultProvider = providers?.providers.find(
    (p) => p.providerId === providers.defaultProviderId,
  );
  const unitPrice = defaultProvider?.unitPriceCny ?? 0.22;
  const defaultName = defaultProvider?.displayName ?? 'Seedream 5.0 lite';
  const estCost = (targets.length * unitPrice).toFixed(2);

  const genImage = trpc.asset.generateImage.useMutation();
  const confirmCand = trpc.asset.confirmCandidate.useMutation();

  const imageLabel = itemLabel ?? IMAGE_LABEL[type] ?? '主图';
  const typeLabel = TYPE_LABEL[type] ?? '资产';

  const setStat = (id: string, status: Stat['status'], error?: string): void =>
    setStats((prev) => prev.map((s) => (s.id === id ? { ...s, status, error } : s)));

  // 3 并发 worker pool — 全量 / 失败重试 复用;每张:生成 1 张 → 设为主图
  const runPool = async (items: BatchTarget[]): Promise<void> => {
    if (items.length === 0) return;
    cancelRef.current = false;
    setRunning(true);
    let idx = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        if (cancelRef.current) return;
        const my = idx++;
        if (my >= items.length) return;
        const t = items[my];
        if (!t) continue;
        setStat(t.id, 'running');
        try {
          const res = await genImage.mutateAsync({
            assetId: t.id,
            slot: t.slot,
            count: 1,
            // 图生图批量(三视图以形象图为参考)— 有 refImageIds 才透传 strength
            ...(t.refImageIds && t.refImageIds.length > 0
              ? { refImageIds: t.refImageIds, strength: t.strength ?? 0.6 }
              : {}),
          });
          const mediaId = res.candidates[0]?.mediaId;
          if (mediaId) {
            await confirmCand.mutateAsync({ assetId: t.id, slot: t.slot, mediaItemId: mediaId });
          }
          setStat(t.id, 'done');
        } catch (e) {
          setStat(t.id, 'failed', e instanceof Error ? e.message : String(e));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker()));
    if (cancelRef.current) {
      setStats((prev) =>
        prev.map((s) => (s.status === 'pending' ? { ...s, status: 'cancelled' } : s)),
      );
    }
    setRunning(false);
    onDone();
  };

  const start = async (): Promise<void> => {
    setStats(targets.map((t) => ({ id: t.id, name: t.name, status: 'pending' as const })));
    await runPool(targets);
  };

  const retry = async (): Promise<void> => {
    const retryTargets = stats
      .filter((s) => s.status === 'failed')
      .map((s) => targets.find((t) => t.id === s.id))
      .filter((t): t is BatchTarget => Boolean(t));
    if (retryTargets.length === 0) return;
    setStats((prev) =>
      prev.map((s) =>
        s.status === 'failed' ? { ...s, status: 'pending' as const, error: undefined } : s,
      ),
    );
    await runPool(retryTargets);
  };

  const reset = (): void => {
    setStats([]);
    setOpen(false);
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => setOpen(true)}
        disabled={running || targets.length === 0}
        title={
          targets.length === 0
            ? `所有${typeLabel}都已有${imageLabel}`
            : `为 ${targets.length} 个缺${imageLabel}的${typeLabel}一键生成并设为主图`
        }
      >
        {running ? <Loader2 className="size-3.5 animate-spin" /> : <Images className="size-3.5" />}
        {buttonText ?? '同步生成'}
        {targets.length > 0 ? ` (${targets.length})` : ''}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && running) return; // 生成中点遮罩不关(用「中断」)
          if (!o) reset();
          else setOpen(o);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {running
                ? `同步生成中 · ${doneCount + failed.length}/${stats.length}`
                : started
                  ? '生成结果'
                  : `一键同步生成${imageLabel}`}
            </DialogTitle>
            <DialogDescription>
              {running
                ? `3 张并发 · 已完成 ${doneCount} · 失败 ${failed.length}`
                : started
                  ? `成功 ${doneCount} · 失败 ${failed.length}${
                      stats.some((s) => s.status === 'cancelled')
                        ? ` · 中断 ${stats.filter((s) => s.status === 'cancelled').length}`
                        : ''
                    }`
                  : `将为 ${targets.length} 个缺${imageLabel}的${typeLabel}各生成 1 张并设为主图 · 模型 ${defaultName} · 预计 ¥${estCost}`}
            </DialogDescription>
          </DialogHeader>

          {/* 未开始:目标列表 */}
          {!started && (
            <div className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {targets.length === 0 ? (
                <div className="text-[hsl(var(--color-muted-foreground))]">
                  没有缺{imageLabel}的{typeLabel}
                </div>
              ) : (
                targets.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between rounded border border-[hsl(var(--color-border))] px-2 py-1"
                  >
                    <span>{t.name}</span>
                    <span className="font-mono text-[10px] text-[hsl(var(--color-muted-foreground))]">
                      {imageLabel}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 已开始:进度条 + 状态 chip */}
          {started && (
            <div className="space-y-3">
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--color-muted))]">
                <div
                  className="h-full rounded-full bg-[hsl(var(--color-success))] transition-all duration-500"
                  style={{
                    width: `${stats.length > 0 ? Math.round(((doneCount + failed.length) / stats.length) * 100) : 0}%`,
                  }}
                />
                {running && (
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-[hsl(var(--color-foreground))]/10 to-transparent" />
                )}
              </div>
              {running && (
                <div className="flex items-center justify-center gap-2 py-1 text-xs text-[hsl(var(--color-muted-foreground))]">
                  <Loader2 className="size-4 animate-spin text-[hsl(var(--color-primary))]" />
                  <span>生成中,每张约 30s,请稍候…</span>
                </div>
              )}
              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                {stats.map((s) => {
                  const cls =
                    s.status === 'done'
                      ? 'border-[hsl(var(--color-success))]/40 bg-[hsl(var(--color-success))]/10 text-[hsl(var(--color-success))]'
                      : s.status === 'failed'
                        ? 'border-[hsl(var(--color-destructive))]/40 bg-[hsl(var(--color-destructive))]/10 text-[hsl(var(--color-destructive))]'
                        : s.status === 'running'
                          ? 'border-[hsl(var(--color-primary))]/50 bg-[hsl(var(--color-primary))]/10 text-[hsl(var(--color-primary))]'
                          : s.status === 'cancelled'
                            ? 'border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))] text-[hsl(var(--color-muted-foreground))] line-through'
                            : 'border-[hsl(var(--color-border))] text-[hsl(var(--color-muted-foreground))]';
                  return (
                    <span
                      key={s.id}
                      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${cls}`}
                      title={s.error ?? s.name}
                    >
                      {s.status === 'running' ? (
                        <Loader2 className="size-2.5 animate-spin" />
                      ) : s.status === 'done' ? (
                        <Check className="size-2.5" />
                      ) : s.status === 'failed' ? (
                        <X className="size-2.5" />
                      ) : s.status === 'cancelled' ? (
                        <CircleSlash className="size-2.5" />
                      ) : (
                        <Circle className="size-2.5" />
                      )}
                      {s.name}
                    </span>
                  );
                })}
              </div>
              {failed.length > 0 && !running && (
                <div className="max-h-24 space-y-0.5 overflow-y-auto rounded-md border border-[hsl(var(--color-destructive))]/30 bg-[hsl(var(--color-destructive))]/5 p-2 text-[11px]">
                  {failed.map((f) => (
                    <div key={f.id} className="text-[hsl(var(--color-destructive))]">
                      {f.name}:{f.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {running ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="text-[hsl(var(--color-danger))]"
              >
                <X className="size-3.5" />
                中断(进行中的跑完即停)
              </Button>
            ) : started ? (
              <>
                {failed.length > 0 && (
                  <Button variant="default" size="sm" onClick={() => void retry()} className="gap-1.5">
                    <RotateCw className="size-3.5" />
                    重试失败的 {failed.length} 个
                  </Button>
                )}
                <Button variant={failed.length > 0 ? 'outline' : 'default'} size="sm" onClick={reset}>
                  关闭
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={() => void start()}
                  disabled={targets.length === 0}
                  className="gap-1.5"
                >
                  <Sparkles className="size-3.5" />
                  开始生成({targets.length} 张 · 预计 ¥{estCost})
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
