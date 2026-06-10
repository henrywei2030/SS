'use client';
/**
 * F4 整集批量生成工具条(蓝图 docs/06 §M4)— 挂工作台顶栏。
 *
 * 链:「批量生成(N 待)」→ estimateBatchForEpisode 拉报价 → **强制成本确认弹窗**
 * (逐组优先级/时长/单价 + 总额)→ batchGenerateForEpisode(带 confirmTotalCny 回传,
 * 服务端重估比对防陈旧报价)→ 总进度横幅(listGroups 轮询驱动)+「取消排队」。
 */
import * as React from 'react';
import { Loader2, Play, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';

import { ConfirmDialog } from './confirm-dialog';

interface GroupRow {
  id: string;
  number: string;
  hasPrompt: boolean;
  videoTakes: { success: number; failed: number; running: number };
}

interface BatchEstimate {
  providerId: string;
  aspectRatio: string;
  generateAudio: boolean;
  totalCny: number;
  groups: Array<{
    groupId: string;
    number: string;
    durationS: number;
    priority: 'S' | 'A' | 'B' | 'C' | null;
    estimateCny: number;
  }>;
}

const PRIORITY_CHIP: Record<string, string> = {
  S: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  A: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  B: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  C: 'bg-zinc-500/15 text-zinc-500 dark:text-zinc-400',
};

export function BatchToolbar({
  episodeId,
  groups,
  onAfterChange,
}: {
  episodeId: string;
  groups: GroupRow[] | undefined;
  /** 入队/取消后让父组件 invalidate listGroups(+各组 takes) */
  onAfterChange: () => void;
}): React.ReactElement | null {
  const utils = trpc.useUtils();
  const [estimating, setEstimating] = React.useState(false);
  const [estimate, setEstimate] = React.useState<BatchEstimate | null>(null);
  const [confirmCancel, setConfirmCancel] = React.useState(false);

  const batchMutation = trpc.aigc.batchGenerateForEpisode.useMutation({
    onSuccess: (data) => {
      const extra = [
        data.denied.length > 0 ? `拒绝 ${data.denied.length} 组` : '',
        data.skipped.length > 0 ? `预算止损跳过 ${data.skipped.length} 组` : '',
      ]
        .filter(Boolean)
        .join(',');
      toast.success(`批量已入队 ${data.submitted.length} 组${extra ? `(${extra})` : ''}`);
      if (data.denied.length > 0) {
        // 第一条拒因给用户一个排查起点(完整清单在 OperationLog)
        toast.info(`组 ${data.denied[0]!.number}:${data.denied[0]!.message}`, { duration: 8000 });
      }
      setEstimate(null);
      onAfterChange();
    },
    onError: (e) => toast.error(`批量生成失败:${e.message}`),
  });

  const cancelMutation = trpc.aigc.cancelQueuedForEpisode.useMutation({
    onSuccess: (data) => {
      if (data.note) toast.info(data.note);
      else
        toast.success(
          `已取消 ${data.cancelled} 个排队任务(费用退还)${data.skippedActive > 0 ? `,${data.skippedActive} 个已开跑未动` : ''}`,
        );
      setConfirmCancel(false);
      onAfterChange();
    },
    onError: (e) => {
      toast.error(`取消失败:${e.message}`);
      setConfirmCancel(false);
    },
  });

  if (!groups || groups.length === 0) return null;

  const pendingCount = groups.filter(
    (g) => g.hasPrompt && g.videoTakes.success === 0 && g.videoTakes.running === 0,
  ).length;
  const runningGroups = groups.filter((g) => g.videoTakes.running > 0).length;
  const doneGroups = groups.filter((g) => g.videoTakes.success > 0).length;

  const openConfirm = async (): Promise<void> => {
    setEstimating(true);
    try {
      // 深审修(P1):staleTime:0 强制重拉 — 全局 staleTime 30s 会让"CONFLICT 后重开弹窗"
      // 在 30 秒内拿到同一份旧报价,形成确认死循环并烧光 2/min 限频
      const est = await utils.aigc.estimateBatchForEpisode.fetch(
        { episodeId },
        { staleTime: 0 },
      );
      if (est.groups.length === 0) {
        toast.info('本集没有待生成的分镜组');
        return;
      }
      setEstimate(est);
    } catch (e) {
      toast.error(`预估失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEstimating(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* 总进度横幅(有任务跑时;由父组件 listGroups 轮询驱动刷新) */}
      {runningGroups > 0 && (
        <span className="flex items-center gap-1 rounded bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-600 dark:text-sky-400">
          <Loader2 className="size-3 animate-spin" />
          进行中 {runningGroups} 组 · 完成 {doneGroups}/{groups.length}
        </span>
      )}
      {runningGroups > 0 && (
        <button
          type="button"
          onClick={() => setConfirmCancel(true)}
          disabled={cancelMutation.isPending}
          className="flex items-center gap-1 rounded-md border border-[hsl(var(--color-border))] px-2 py-1 text-[11px] hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
          title="摘掉还在排队的任务并退费(已开跑的不动)"
        >
          <XCircle className="size-3" />
          取消排队
        </button>
      )}
      <button
        type="button"
        onClick={() => void openConfirm()}
        disabled={pendingCount === 0 || estimating || batchMutation.isPending}
        className="flex items-center gap-1 rounded-md bg-[hsl(var(--color-primary))] px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--color-primary-foreground))] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        title={
          pendingCount === 0
            ? '没有待生成的组(全部已有成功 take 或在跑)'
            : '按优先级(S>A>B>C)批量生成所有待生成组 — 先看费用确认'
        }
      >
        {estimating || batchMutation.isPending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Play className="size-3" />
        )}
        批量生成{pendingCount > 0 ? `(${pendingCount} 待)` : ''}
      </button>

      {/* 成本确认弹窗(强制闭环:不确认不花钱) */}
      {estimate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="batch-confirm-title"
          onClick={() => setEstimate(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="batch-confirm-title" className="text-sm font-semibold">
              批量生成确认 — {estimate.groups.length} 组
            </h3>
            <p className="mt-1 text-[11px] text-[hsl(var(--color-muted-foreground))]">
              Provider:{estimate.providerId} · {estimate.aspectRatio} ·{' '}
              {estimate.generateAudio ? '有声' : '无声'} · 按 S&gt;A&gt;B&gt;C 优先级依次入队
            </p>
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded border border-[hsl(var(--color-border))] p-2">
              {estimate.groups.map((g) => (
                <div key={g.groupId} className="flex items-center gap-2 text-[11px]">
                  <span
                    className={`w-5 shrink-0 rounded px-1 text-center text-[10px] font-medium ${g.priority ? PRIORITY_CHIP[g.priority] : 'bg-zinc-500/10 text-zinc-400'}`}
                  >
                    {g.priority ?? '–'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">组 {g.number}</span>
                  <span className="shrink-0 text-[hsl(var(--color-muted-foreground))]">
                    {g.durationS}s
                  </span>
                  <span className="w-14 shrink-0 text-right font-mono">
                    ¥{g.estimateCny.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-[11px] text-[hsl(var(--color-muted-foreground))]">
                预扣合计(完成按实际时长退差)
              </span>
              <span className="font-semibold">¥{estimate.totalCny.toFixed(2)}</span>
            </div>
            <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
              ⚠️ 真实扣费操作 — 入队后可在工具条「取消排队」摘掉未开跑的任务
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEstimate(null)}
                className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))]"
              >
                取消
              </button>
              <button
                type="button"
                disabled={batchMutation.isPending}
                onClick={() =>
                  batchMutation.mutate({
                    episodeId,
                    confirmTotalCny: estimate.totalCny,
                    // 深审修(P2):组集随总额一起回传 — 服务端双比对挡「等额换组」穿透
                    confirmGroupIds: estimate.groups.map((g) => g.groupId),
                  })
                }
                className="rounded-md bg-[hsl(var(--color-primary))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--color-primary-foreground))] hover:opacity-90 disabled:opacity-50"
              >
                {batchMutation.isPending ? '入队中…' : `确认生成 ${estimate.groups.length} 组`}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="取消排队中的批量任务?"
          description="只摘掉还在队列里等待的任务并退还预扣费用;已经开始生成的不受影响。"
          confirmLabel="取消排队"
          danger
          onClose={() => setConfirmCancel(false)}
          onConfirm={() => cancelMutation.mutate({ episodeId })}
        />
      )}
    </div>
  );
}
