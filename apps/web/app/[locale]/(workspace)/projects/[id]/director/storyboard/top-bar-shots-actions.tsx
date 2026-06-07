'use client';
import * as React from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Loader2,
  Sparkles,
  FileText,
  Send,
  Download,
  ChevronDown,
  Package,
  X,
  RotateCw,
  Combine,
} from 'lucide-react';
import { toast } from 'sonner';

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  buildShotsCsv,
  buildShotsText,
  buildShotsHtml,
  wrapWordHtml,
  downloadFile,
  type ExportFormat,
} from './lib/shots-export';

export function ShotsActions({
  projectId,
  episodeId,
  episodeNumber,
  onAfterAction,
}: {
  projectId: string;
  episodeId: string | undefined;
  episodeNumber: number | undefined;
  onAfterAction: () => void;
}): React.ReactElement {
  const utils = trpc.useUtils();

  // 全集生成进度状态(四九收工:3 并发 + 可中断 + 每集状态)
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [batchRunning, setBatchRunning] = React.useState(false);
  const cancelRef = React.useRef(false);
  type EpStat = {
    episodeNumber: number;
    episodeId: string;
    title?: string | null;
    status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
    error?: string;
  };
  const [batchEps, setBatchEps] = React.useState<EpStat[]>([]);
  const batchStarted = batchEps.length > 0;
  const doneCount = batchEps.filter((e) => e.status === 'done').length;
  const failedEps = batchEps.filter((e) => e.status === 'failed');

  const eligibleQuery = trpc.storyboard.listEligibleForGeneration.useQuery(
    { projectId },
    { enabled: batchOpen },
  );

  const generate = trpc.storyboard.generateForEpisode.useMutation({
    onSuccess: (res, vars) => {
      const msg = `生成完成:${res.shotCount} 镜 / ${res.groupCount} 组`;
      if (res.shotCount === 0) {
        toast.error(
          res.errors.length > 0
            ? `生成失败:${res.errors[0]}`
            : '生成 0 镜 — 剧本可能为空或 LLM 返回格式异常,看后台日志',
          { duration: 8000 },
        );
      } else if (res.errors.length > 0) {
        toast.warning(`${msg}(${res.errors.length} 场有警告)`);
      } else {
        toast.success(msg);
      }
      // 刷新右侧分镜内容 + 左栏集数统计
      void utils.storyboard.listShots.invalidate({ episodeId: vars.episodeId, grouped: true });
      void utils.storyboard.listShots.invalidate({ episodeId: vars.episodeId, grouped: false });
      void utils.storyboard.listEpisodes.invalidate();
      onAfterAction();
    },
    onError: (e) => toast.error(e.message),
  });

  // 全盘审查 #4:批量池专用「静默」mutation — 不弹单集 toast、不每集 invalidate listEpisodes。
  //   runPool 自己维护每集 chip 状态 + 结束后统一 onAfterAction()。原来池复用上面的 generate,
  //   React-Query 对每次 mutateAsync 都触发其 hook 级 onSuccess/onError → N 集弹 N 个 toast + N 次 refetch 刷屏。
  const generateSilent = trpc.storyboard.generateForEpisode.useMutation();

  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'zh-CN';

  const publish = trpc.storyboard.publishEpisode.useMutation({
    onSuccess: (res) => {
      // 用户反馈 r3:确认发布后 AIGC 模块要看到最新分镜 + prompt
      // AIGC 直接 query 活表,只需让 react-query cache 失效
      void utils.aigc.listGroups.invalidate({ episodeId: res.episodeId });
      void utils.aigc.getGroupDetail.invalidate();
      // 三十七收工:publishEpisode 现在自动为 standalone shot 建 1:1 ShotGroup
      //   shotCount > 0 即视为有 AIGC 可同步(原 aigcReady = groupCount > 0 过严)
      const aigcSyncable = res.shotCount > 0;
      toast.success(
        aigcSyncable
          ? `已发布 v${res.version} · ${res.shotCount} 镜 / ${res.groupCount} 组 · 已同步到 AIGC`
          : `已发布 v${res.version}(本集 0 镜,暂无内容同步到 AIGC)`,
        aigcSyncable
          ? {
              duration: 6000,
              action: {
                label: '前往 AIGC',
                onClick: () =>
                  router.push(`/${locale}/projects/${res.projectId}/aigc/${res.episodeId}`),
              },
            }
          : undefined,
      );
      onAfterAction();
    },
    onError: (e) => toast.error(e.message),
  });

  // 自动整合(2026-06):对当前集未入组的单一分镜按顺序贪心合并成组(每组累计 ≤maxDurationS)
  const autoMerge = trpc.storyboard.autoMergeEpisode.useMutation({
    onSuccess: (res, vars) => {
      if (res.groupsCreated > 0) toast.success(res.message);
      else toast.warning(res.message);
      void utils.storyboard.listShots.invalidate({ episodeId: vars.episodeId, grouped: true });
      void utils.storyboard.listShots.invalidate({ episodeId: vars.episodeId, grouped: false });
      onAfterAction();
    },
    onError: (e) => toast.error(`自动整合失败:${e.message}`),
  });

  const handleExportCurrent = async (format: ExportFormat): Promise<void> => {
    if (!episodeId) return;
    try {
      const data = await utils.storyboard.listShots.fetch({ episodeId, grouped: true });
      const epn = episodeNumber ?? 0;
      if (format === 'csv') {
        downloadFile(buildShotsCsv(data, epn), `第${epn}集分镜.csv`, 'text/csv;charset=utf-8;');
      } else if (format === 'txt') {
        downloadFile(buildShotsText(data, epn), `第${epn}集分镜.txt`, 'text/plain;charset=utf-8;');
      } else {
        downloadFile(
          wrapWordHtml(`第${epn}集分镜`, buildShotsHtml(data, epn)),
          `第${epn}集分镜.doc`,
          'application/msword',
        );
      }
      toast.success(`${format.toUpperCase()} 导出完成`);
    } catch (e) {
      toast.error(`导出失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleExportAll = async (format: ExportFormat): Promise<void> => {
    try {
      const data = await utils.storyboard.listShotsByProject.fetch({ projectId });
      const nonEmpty = data.episodes.filter((ep) => ep.shotCount > 0);
      if (nonEmpty.length === 0) {
        toast.warning('项目内还没有任何已生成的分镜');
        return;
      }
      if (format === 'csv') {
        const headerRow = buildShotsCsv({ groups: [], ungrouped: [] }, 0).split('\n')[0] ?? '';
        const bodies: string[] = [];
        for (const ep of nonEmpty) {
          const full = buildShotsCsv({ groups: ep.groups, ungrouped: ep.ungrouped }, ep.episodeNumber);
          const lines = full.split('\n');
          if (lines.length > 1) bodies.push(lines.slice(1).join('\n'));
        }
        downloadFile(
          [headerRow, ...bodies].filter(Boolean).join('\n'),
          `项目全部分镜(${nonEmpty.length}集).csv`,
          'text/csv;charset=utf-8;',
        );
      } else if (format === 'txt') {
        const txt = nonEmpty
          .map((ep) => buildShotsText({ groups: ep.groups, ungrouped: ep.ungrouped }, ep.episodeNumber))
          .join('\n\n\n');
        downloadFile(txt, `项目全部分镜(${nonEmpty.length}集).txt`, 'text/plain;charset=utf-8;');
      } else {
        const bodies = nonEmpty
          .map((ep) => buildShotsHtml({ groups: ep.groups, ungrouped: ep.ungrouped }, ep.episodeNumber))
          .join('<br/><br/>');
        downloadFile(
          wrapWordHtml('项目全部分镜', bodies),
          `项目全部分镜(${nonEmpty.length}集).doc`,
          'application/msword',
        );
      }
      toast.success(`已导出 ${nonEmpty.length} 集分镜`);
    } catch (e) {
      toast.error(`导出失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const disabled = !episodeId;

  const BATCH_CONCURRENCY = 3;

  const setEpStat = (episodeId: string, status: EpStat['status'], error?: string): void =>
    setBatchEps((prev) =>
      prev.map((e) => (e.episodeId === episodeId ? { ...e, status, error } : e)),
    );

  // 四九收工:3 并发 worker pool — 跑指定集列表(全量生成 / 失败重试 复用),每 worker 抢下一个
  const runPool = async (targets: { episodeId: string }[]): Promise<void> => {
    if (targets.length === 0) return;
    cancelRef.current = false;
    setBatchRunning(true);
    let idx = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        if (cancelRef.current) return;
        const myIdx = idx++;
        if (myIdx >= targets.length) return;
        const ep = targets[myIdx];
        if (!ep) continue;
        setEpStat(ep.episodeId, 'running');
        try {
          await generateSilent.mutateAsync({ episodeId: ep.episodeId, replaceExisting: true });
          // 全盘审查 #3:mutateAsync 已 resolve = 后端已落库,无条件标 done。
          //   原 `cancelRef ? 'cancelled' : 'done'` 会把"取消时正好已成功落库"的集误标 cancelled,
          //   与 cancelBatch 注释"in-flight 跑完即停(后端已落库)"矛盾,且让用户误以为没生成。
          setEpStat(ep.episodeId, 'done');
        } catch (e) {
          setEpStat(ep.episodeId, 'failed', e instanceof Error ? e.message : String(e));
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(BATCH_CONCURRENCY, targets.length) }, () => worker()),
    );
    // 取消后:还没跑的 pending 标 cancelled
    if (cancelRef.current) {
      setBatchEps((prev) =>
        prev.map((e) => (e.status === 'pending' ? { ...e, status: 'cancelled' } : e)),
      );
    }
    setBatchRunning(false);
    onAfterAction();
  };

  const runBatch = async (): Promise<void> => {
    const eligible = eligibleQuery.data ?? [];
    if (eligible.length === 0) return;
    setBatchEps(
      eligible.map((e) => ({
        episodeNumber: e.episodeNumber,
        episodeId: e.episodeId,
        title: e.title,
        status: 'pending' as const,
      })),
    );
    await runPool(eligible);
  };

  // 失败集就地重试:把 failed 重置 pending 再跑(已成功/中断的集不动),复用同款 3 并发 pool
  const retryFailed = async (): Promise<void> => {
    const targets = batchEps.filter((e) => e.status === 'failed');
    if (targets.length === 0) return;
    setBatchEps((prev) =>
      prev.map((e) =>
        e.status === 'failed' ? { ...e, status: 'pending' as const, error: undefined } : e,
      ),
    );
    await runPool(targets);
  };

  const cancelBatch = (): void => {
    cancelRef.current = true; // 不再启动新集;in-flight 的集跑完即停(后端已落库)
  };

  const resetBatch = (): void => {
    setBatchEps([]);
    setBatchOpen(false);
  };

  return (
    <>
      {/* 生成分镜 — 仅当前集 */}
      <Button
        size="sm"
        variant="default"
        onClick={() => episodeId && generate.mutate({ episodeId, replaceExisting: true })}
        disabled={disabled || generate.isPending || batchRunning}
        className="gap-1.5"
        title={episodeNumber ? `为第 ${episodeNumber} 集生成分镜` : '请先选集'}
      >
        {generate.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Sparkles className="size-3.5" />
        )}
        生成分镜
      </Button>

      {/* 全部集数生成 — 独立按钮,打开列表 modal */}
      <Button
        size="sm"
        variant="outline"
        onClick={() => setBatchOpen(true)}
        disabled={generate.isPending || batchRunning}
        className="gap-1.5"
        title="批量生成所有未锁定 + 有剧本的集"
      >
        {batchRunning ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Package className="size-3.5" />
        )}
        全部集数生成
      </Button>

      <Dialog
        open={batchOpen}
        onOpenChange={(o) => {
          if (!o && batchRunning) return; // running 中点遮罩不关(用"中断生成"按钮)
          if (!o) resetBatch();
          else setBatchOpen(o);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {batchRunning
                ? `分镜生成中 · ${doneCount + failedEps.length}/${batchEps.length}`
                : batchStarted
                  ? '生成结果'
                  : '为全部集生成分镜(3 集并发)'}
            </DialogTitle>
            <DialogDescription>
              {batchRunning
                ? `3 集并发 · 已完成 ${doneCount} · 失败 ${failedEps.length} · 进行中 ${batchEps.filter((e) => e.status === 'running').length}`
                : batchStarted
                  ? `成功 ${doneCount} 集 · 失败 ${failedEps.length} 集${batchEps.some((e) => e.status === 'cancelled') ? ` · 中断 ${batchEps.filter((e) => e.status === 'cancelled').length} 集` : ''}`
                  : '只列"有剧本 + 未锁"的集 · 3 集同时生成 · 失败/中断的集互不影响,可再次生成补齐'}
            </DialogDescription>
          </DialogHeader>

          {/* 未开始:可生成集列表 */}
          {!batchStarted && (
            <div className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {eligibleQuery.isLoading ? (
                <div className="flex items-center gap-2 text-[hsl(var(--color-muted-foreground))]">
                  <Loader2 className="size-3.5 animate-spin" /> 加载…
                </div>
              ) : (eligibleQuery.data ?? []).length === 0 ? (
                <div className="text-[hsl(var(--color-muted-foreground))]">
                  没有可生成的集(每集需有当前剧本 + 不在生成锁中)
                </div>
              ) : (
                (eligibleQuery.data ?? []).map((e) => (
                  <div
                    key={e.episodeId}
                    className="flex items-center justify-between rounded border border-[hsl(var(--color-border))] px-2 py-1"
                  >
                    <span>
                      第 {e.episodeNumber} 集{e.title ? ` · ${e.title}` : ''}
                    </span>
                    <span className="font-mono text-[10px] text-[hsl(var(--color-muted-foreground))]">
                      v{e.scriptVersion}
                      {e.existingShotCount > 0 ? ` · 已有 ${e.existingShotCount} 镜` : ''}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 已开始:B站式进度 — 进度条 + 流光动画 + 每集状态 chip */}
          {batchStarted && (
            <div className="space-y-3">
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--color-muted))]">
                <div
                  className="h-full rounded-full bg-[hsl(var(--color-success))] transition-all duration-500"
                  style={{
                    width: `${batchEps.length > 0 ? Math.round(((doneCount + failedEps.length) / batchEps.length) * 100) : 0}%`,
                  }}
                />
                {batchRunning && (
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-[hsl(var(--color-foreground))]/10 to-transparent" />
                )}
              </div>
              {batchRunning && (
                <div className="flex items-center justify-center gap-2 py-1 text-xs text-[hsl(var(--color-muted-foreground))]">
                  <Loader2 className="size-4 animate-spin text-[hsl(var(--color-primary))]" />
                  <span>3 集并发生成中,请稍候…</span>
                </div>
              )}
              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                {batchEps.map((e) => {
                  const cls =
                    e.status === 'done'
                      ? 'border-[hsl(var(--color-success))]/40 bg-[hsl(var(--color-success))]/10 text-[hsl(var(--color-success))]'
                      : e.status === 'failed'
                        ? 'border-[hsl(var(--color-destructive))]/40 bg-[hsl(var(--color-destructive))]/10 text-[hsl(var(--color-destructive))]'
                        : e.status === 'running'
                          ? 'border-[hsl(var(--color-primary))]/50 bg-[hsl(var(--color-primary))]/10 text-[hsl(var(--color-primary))]'
                          : e.status === 'cancelled'
                            ? 'border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))] text-[hsl(var(--color-muted-foreground))] line-through'
                            : 'border-[hsl(var(--color-border))] text-[hsl(var(--color-muted-foreground))]';
                  return (
                    <span
                      key={e.episodeId}
                      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${cls}`}
                      title={e.error ?? e.title ?? ''}
                    >
                      {e.status === 'running' ? (
                        <Loader2 className="size-2.5 animate-spin" />
                      ) : e.status === 'done' ? (
                        '✓'
                      ) : e.status === 'failed' ? (
                        '✗'
                      ) : e.status === 'cancelled' ? (
                        '⊘'
                      ) : (
                        '○'
                      )}
                      第{e.episodeNumber}集
                    </span>
                  );
                })}
              </div>
              {failedEps.length > 0 && !batchRunning && (
                <div className="max-h-24 space-y-0.5 overflow-y-auto rounded-md border border-[hsl(var(--color-destructive))]/30 bg-[hsl(var(--color-destructive))]/5 p-2 text-[11px]">
                  {failedEps.map((f) => (
                    <div key={f.episodeId} className="text-[hsl(var(--color-destructive))]">
                      第 {f.episodeNumber} 集:{f.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {batchRunning ? (
              <Button variant="outline" size="sm" onClick={cancelBatch} className="text-red-600">
                <X className="size-3.5" />
                中断生成(进行中的集跑完即停)
              </Button>
            ) : batchStarted ? (
              <>
                {failedEps.length > 0 && (
                  <Button variant="default" size="sm" onClick={retryFailed} className="gap-1.5">
                    <RotateCw className="size-3.5" />
                    重新生成失败的 {failedEps.length} 集
                  </Button>
                )}
                <Button
                  variant={failedEps.length > 0 ? 'outline' : 'default'}
                  size="sm"
                  onClick={resetBatch}
                >
                  关闭
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setBatchOpen(false)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={runBatch}
                  disabled={(eligibleQuery.data ?? []).length === 0 || eligibleQuery.isLoading}
                >
                  <Sparkles className="size-3.5" />
                  开始生成({(eligibleQuery.data ?? []).length} 集 · 3 并发)
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5">
            <Download className="size-3.5" />
            导出
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => void handleExportCurrent('word')} disabled={disabled}>
            <FileText className="mr-2 size-3.5" />
            当前集 · Word
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleExportCurrent('txt')} disabled={disabled}>
            <FileText className="mr-2 size-3.5" />
            当前集 · TXT
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleExportCurrent('csv')} disabled={disabled}>
            <FileText className="mr-2 size-3.5" />
            当前集 · CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleExportAll('word')}>
            <Package className="mr-2 size-3.5" />
            全部集 · Word
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleExportAll('txt')}>
            <Package className="mr-2 size-3.5" />
            全部集 · TXT
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleExportAll('csv')}>
            <Package className="mr-2 size-3.5" />
            全部集 · CSV(合并)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="sm"
        variant="outline"
        onClick={() => episodeId && autoMerge.mutate({ episodeId })}
        disabled={disabled || autoMerge.isPending || publish.isPending}
        className="gap-1.5"
        title="把当前集未入组的单一分镜按顺序贪心合并成分镜组(每组累计 ≤15s,严格按顺序、不任意组合)"
      >
        {autoMerge.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Combine className="size-3.5" />
        )}
        自动整合
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => episodeId && publish.mutate({ episodeId })}
        disabled={disabled || publish.isPending}
        className="gap-1.5"
      >
        {publish.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Send className="size-3.5" />
        )}
        确认发布
      </Button>
    </>
  );
}

// ---------------------------------------------------------------------------
// 进度 / 字号 / CSV 导出辅助
// ---------------------------------------------------------------------------

export function ShotsProgress({ episodeId }: { episodeId: string }): React.ReactElement {
  const { data } = trpc.storyboard.listShots.useQuery({ episodeId, grouped: false });
  const shots = (data && 'shots' in data ? data.shots : undefined) ?? [];
  const total = shots.length;
  const published = shots.filter((s) => s.status !== 'DRAFT').length;
  if (total === 0) return <></>;
  return (
    <Badge variant="secondary" className="font-mono text-[10px]">
      {published}/{total} 镜
    </Badge>
  );
}
