'use client';
/**
 * 成片面板 — M1(蓝图 docs/06 §3 M1):AIGC 集工作台「成片」tab。
 *
 * 顶部:时间线就绪度(compose.timeline)+ 选项(允许缺口 / 烧录字幕 / BGM)+ 发起按钮。
 * 下方:渲染历史(compose.listRenders,有 QUEUED/RUNNING 时 5s 条件轮询 — 对齐
 * video-preview-section 的轮询 pattern),含播放 / 下载 MP4 / 下载 SRT / 失败原因。
 */
import * as React from 'react';
import { Clapperboard, Download, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  QUEUED: { text: '排队中', cls: 'text-amber-600 dark:text-amber-400' },
  RUNNING: { text: '渲染中', cls: 'text-blue-600 dark:text-blue-400' },
  SUCCESS: { text: '完成', cls: 'text-green-700 dark:text-green-400' },
  FAILED: { text: '失败', cls: 'text-red-700 dark:text-red-400' },
};

function fmtTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString();
}

export function RenderPanel({
  projectId,
  episodeId,
}: {
  projectId: string;
  episodeId: string;
}): React.ReactElement {
  const utils = trpc.useUtils();
  const [allowGaps, setAllowGaps] = React.useState(false);
  const [burnSubtitles, setBurnSubtitles] = React.useState(true);
  const [bgmMediaId, setBgmMediaId] = React.useState<string>('');
  const [playUrl, setPlayUrl] = React.useState<string | null>(null);

  const timeline = trpc.compose.timeline.useQuery({ episodeId });
  const renders = trpc.compose.listRenders.useQuery(
    { episodeId },
    {
      refetchInterval: (query) => {
        const hasInflight = query.state.data?.some(
          (r) => r.status === 'RUNNING' || r.status === 'QUEUED',
        );
        return hasInflight ? 5_000 : false;
      },
    },
  );
  // BGM 候选:本项目音频(分页第一页 48 条够用;无候选时下拉只有「不加 BGM」)
  const bgmList = trpc.media.list.useQuery({
    page: 1,
    pageSize: 48,
    kind: 'AUDIO',
    projectId,
  });

  const renderMutation = trpc.compose.renderEpisode.useMutation({
    onSuccess: () => {
      toast.success('成片任务已发起,完成后铃铛会通知');
      void utils.compose.listRenders.invalidate({ episodeId });
    },
    onError: (e) => toast.error(`发起失败:${e.message}`),
  });

  const tl = timeline.data;
  const hasGaps = (tl?.gaps.length ?? 0) > 0;
  const hasInflight = renders.data?.some(
    (r) => r.status === 'RUNNING' || r.status === 'QUEUED',
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {/* 发起卡 */}
      <section className="rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Clapperboard className="size-4" />
          <h3 className="text-[length:1em] font-medium">整集成片</h3>
        </div>

        {timeline.isLoading ? (
          <div className="text-[length:0.85em] text-[hsl(var(--color-muted-foreground))]">
            时间线加载中…
          </div>
        ) : tl ? (
          <div className="mb-3 flex flex-wrap items-center gap-3 text-[length:0.85em]">
            <span>
              共 <b>{tl.total}</b> 段 · 就绪 <b className="text-green-700 dark:text-green-400">{tl.ready}</b>
            </span>
            {hasGaps && (
              <span className="text-amber-700 dark:text-amber-400">
                缺口 {tl.gaps.length} 段:{tl.gaps.join(' / ')}
              </span>
            )}
            {!hasGaps && tl.total > 0 && (
              <span className="text-green-700 dark:text-green-400">全部就绪 ✓</span>
            )}
          </div>
        ) : null}

        <div className="mb-3 flex flex-wrap items-center gap-4 text-[length:0.85em]">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={allowGaps}
              onChange={(e) => setAllowGaps(e.target.checked)}
              className="size-3.5 accent-[hsl(var(--color-primary))]"
            />
            允许缺口(跳过无 take 的段)
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={burnSubtitles}
              onChange={(e) => setBurnSubtitles(e.target.checked)}
              className="size-3.5 accent-[hsl(var(--color-primary))]"
            />
            烧录字幕(SRT 始终单独产出)
          </label>
          <label className="flex items-center gap-1.5">
            BGM
            <select
              value={bgmMediaId}
              onChange={(e) => setBgmMediaId(e.target.value)}
              className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-1.5 py-0.5 text-[length:0.95em]"
            >
              <option value="">不加 BGM</option>
              {(bgmList.data?.items ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.filename}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Button
          size="sm"
          disabled={renderMutation.isPending || hasInflight || (tl ? tl.ready === 0 : true)}
          onClick={() =>
            renderMutation.mutate({
              episodeId,
              allowGaps,
              burnSubtitles,
              ...(bgmMediaId ? { bgmMediaId } : {}),
            })
          }
        >
          {renderMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Clapperboard className="size-3.5" />
          )}
          {hasInflight ? '已有任务进行中' : '开始成片'}
        </Button>
        <p className="mt-2 text-[length:0.78em] text-[hsl(var(--color-muted-foreground))]">
          取每段最新未拒的成功 take,按分镜顺序串接,统一 1080p 档;字幕由台词自动生成、时间轴按实测时长对齐。
        </p>
      </section>

      {/* 渲染历史 */}
      <section className="rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]">
        <div className="border-b border-[hsl(var(--color-border))] px-4 py-2 text-[length:0.85em] font-medium">
          渲染历史
        </div>
        {renders.isLoading ? (
          <div className="px-4 py-6 text-center text-[length:0.85em] text-[hsl(var(--color-muted-foreground))]">
            加载中…
          </div>
        ) : !renders.data || renders.data.length === 0 ? (
          <div className="px-4 py-6 text-center text-[length:0.85em] text-[hsl(var(--color-muted-foreground))]">
            还没有成片记录
          </div>
        ) : (
          <ul>
            {renders.data.map((r) => {
              const st = STATUS_LABEL[r.status] ?? { text: r.status, cls: '' };
              const inflight = r.status === 'QUEUED' || r.status === 'RUNNING';
              return (
                <li
                  key={r.id}
                  className="border-b border-[hsl(var(--color-border))] px-4 py-2.5 last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-[length:0.85em]">
                      {inflight && <Loader2 className="size-3 shrink-0 animate-spin" />}
                      <span className={cn('shrink-0 font-medium', st.cls)}>{st.text}</span>
                      <span className="truncate text-[hsl(var(--color-muted-foreground))]">
                        {fmtTime(r.createdAt)}
                        {r.durationS != null && ` · ${Math.round(r.durationS)}s`}
                        {r.params.stats?.groups != null && ` · ${r.params.stats.groups} 段`}
                        {(r.params.stats?.gapsSkipped?.length ?? 0) > 0 &&
                          ` · 跳过缺口 ${r.params.stats!.gapsSkipped!.length}`}
                      </span>
                    </div>
                    {r.status === 'SUCCESS' && (
                      <div className="flex shrink-0 items-center gap-1">
                        {r.videoUrl && (
                          <>
                            <button
                              type="button"
                              title="播放"
                              onClick={() => setPlayUrl(r.videoUrl)}
                              className="rounded p-1 hover:bg-[hsl(var(--color-muted))]"
                            >
                              <Play className="size-3.5" />
                            </button>
                            <a
                              href={r.videoUrl}
                              download={r.filename ?? 'render.mp4'}
                              title="下载成片 MP4"
                              className="rounded p-1 hover:bg-[hsl(var(--color-muted))]"
                            >
                              <Download className="size-3.5" />
                            </a>
                          </>
                        )}
                        {r.srtUrl && (
                          <a
                            href={r.srtUrl}
                            download={r.srtFilename ?? 'subtitle.srt'}
                            title="下载字幕 SRT"
                            className="rounded px-1 py-0.5 text-[10px] hover:bg-[hsl(var(--color-muted))]"
                          >
                            SRT
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  {r.params.burnFallback && r.status === 'SUCCESS' && (
                    <div className="mt-1 text-[length:0.78em] text-amber-700 dark:text-amber-400">
                      字幕烧录回退(本机 ffmpeg 字体环境问题),请下载 SRT 外挂
                    </div>
                  )}
                  {r.status === 'FAILED' && r.errorMsg && (
                    <div className="mt-1 text-[length:0.78em] text-red-700 dark:text-red-400">
                      {r.errorMsg}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 播放对话框(列表不预加载,点播放才挂 video) */}
      {playUrl && (
        <Dialog open onOpenChange={(open) => !open && setPlayUrl(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="text-sm">成片预览</DialogTitle>
            </DialogHeader>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={playUrl} controls autoPlay className="max-h-[70vh] w-full rounded" />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
