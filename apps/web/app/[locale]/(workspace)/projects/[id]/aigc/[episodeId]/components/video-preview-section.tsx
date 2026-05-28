'use client';
import * as React from 'react';
import { Download, History, Trash2 } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
import { useAigcProgress } from '@/lib/hooks/use-aigc-progress';
import { useVideoSettings } from '@/lib/hooks/use-video-settings';
import { ASPECT_RATIOS, type AspectRatio } from '@ss/shared/constants';

import { InflightProgressPanel } from './inflight-progress-panel';

// 用户反馈 2026-05-27:6 个画面比例的中文标签 + Tailwind aspect class 映射
// 横屏(16:9 / 21:9)走 aspect-video / aspect-[21/9];竖屏(9:16 / 3:4)走对应比例 class
const ASPECT_LABEL: Record<AspectRatio, string> = {
  '16:9': '16:9 横屏',
  '4:3': '4:3 标清',
  '1:1': '1:1 方形',
  '3:4': '3:4 竖向',
  '9:16': '9:16 竖屏',
  '21:9': '21:9 宽银幕',
};
const ASPECT_CLASS: Record<AspectRatio, string> = {
  '16:9': 'aspect-video',
  '4:3': 'aspect-[4/3]',
  '1:1': 'aspect-square',
  '3:4': 'aspect-[3/4]',
  '9:16': 'aspect-[9/16]',
  '21:9': 'aspect-[21/9]',
};

export interface VideoPreviewProps {
  groupId: string;
  onGenerate: (opts: {
    durationS?: number;
    aspectRatio?: AspectRatio;
    // W5.5.1 扩展
    resolution?: '480p' | '720p' | '1080p';
    generateAudio?: boolean;
    // 2026-05-27:用户在视频预览选了非 binding 默认的 provider 时传过来
    providerOverride?: string;
  }) => void;
  generatePending: boolean;
  onReject: (attemptId: string) => void;
  rejectPending: boolean;
  autoSelectAttemptId: string | null;
  onAutoSelectConsumed: () => void;
}

export function VideoPreviewSection({
  groupId,
  onGenerate,
  generatePending,
  onReject,
  rejectPending,
  autoSelectAttemptId,
  onAutoSelectConsumed,
}: VideoPreviewProps): React.ReactElement {
  const { data: takes, isLoading } = trpc.aigc.listVideoTakes.useQuery(
    { groupId },
    {
      // 2026-05-27 audit r15:列表含 RUNNING/QUEUED take 时自动 polling 等终态
      // 防 worker 升 SUCCESS 但 SSE invalidate 失败 / 用户重新打开页面时显陈旧 RUNNING
      refetchInterval: (query) => {
        const data = query.state.data;
        const hasInflight = data?.some(
          (t) => t.status === 'RUNNING' || t.status === 'QUEUED',
        );
        return hasInflight ? 5_000 : false;
      },
    },
  );
  const [selectedTakeId, setSelectedTakeId] = React.useState<string | null>(null);
  // 2026-05-27 用户反馈:历史改主预览下方常驻列表,点条目自动播放
  // r14 P1:requestAnimationFrame 不够稳(video src 切换是异步,可能 play 旧 src);
  // 改用 pendingPlay state + onLoadedMetadata 回调,等元数据加载完再 play
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [pendingPlayId, setPendingPlayId] = React.useState<string | null>(null);
  const handleSelectHistoryTake = React.useCallback((takeId: string) => {
    setSelectedTakeId(takeId);
    setPendingPlayId(takeId); // 标记需要播,onLoadedMetadata 回调消费
  }, []);
  // 三十三收工 R1 Phase A2:4 个 video setting state + 4 effect 抽到 useVideoSettings
  // selectedProviderId 留主组件管理(capabilities query input,避免循环依赖)
  const [selectedProviderId, setSelectedProviderId] = React.useState<string | null>(null);
  const { data: videoProviders } = trpc.aigc.listVideoProviders.useQuery();

  // W5.5 D6:Provider 能力查询 — providerId 传 selectedProviderId(null 时 server 走 binding)
  // 2026-05-27:error 时 UI 显红色 banner,引导用户切换或去 /admin/providers 配置
  const { data: capabilities, error: capabilitiesError } =
    trpc.aigc.getProviderCapabilities.useQuery({
      providerId: selectedProviderId ?? undefined,
    });
  // W5.5 D6:group.durationS 作为智能默认(按分镜复杂度,1 个 shot 6s / 3 个 shots 15s 等)
  const { data: groupDetail } = trpc.aigc.getGroupDetail.useQuery({ groupId });

  // 2026-05-27 audit r15 用户反馈:下载文件名规则化
  //   {项目名}-Ep{集号}-{分镜组号}-第{N}次-{时间}.mp4
  // takes 数组 server desc 排序,seq = takes.length - index(老的小 seq,新的大 seq)
  const buildDownloadFilename = React.useCallback(
    (takeId: string, createdAt: Date | string): string => {
      const sanitize = (s: string) =>
        s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled';
      const time = new Date(createdAt);
      const pad = (n: number) => String(n).padStart(2, '0');
      const ts = `${time.getFullYear()}${pad(time.getMonth() + 1)}${pad(time.getDate())}-${pad(time.getHours())}${pad(time.getMinutes())}`;
      const projectName = sanitize(groupDetail?.project?.name ?? '项目');
      const epNum = groupDetail?.episode?.number ?? '';
      const epPart = epNum ? `Ep${epNum}` : 'Ep';
      const grpNum = sanitize(groupDetail?.group?.number ?? groupId.slice(0, 6));
      const idx = takes?.findIndex((t) => t.id === takeId) ?? -1;
      const total = takes?.length ?? 0;
      const seq = idx >= 0 ? total - idx : 1; // 老的 seq 小,新的 seq 大
      return `${projectName}-${epPart}-${grpNum}-第${seq}次-${ts}.mp4`;
    },
    [groupDetail, takes, groupId],
  );
  // W5.5 D5:SSE 实时进度(对当前正在跑的 attempt 订阅)
  const progress = useAigcProgress(autoSelectAttemptId);
  const utils = trpc.useUtils();

  // 三十三收工 R1 Phase A2:4 个跟随 capabilities effect 抽到 useVideoSettings hook
  const {
    aspectRatio,
    setAspectRatio,
    durationS,
    setDurationS,
    resolution,
    setResolution,
    generateAudio,
    setGenerateAudio,
  } = useVideoSettings({ capabilities, groupDetail });

  // W5.5 D5:终态后 invalidate listVideoTakes + 当前 episode 的 listGroups
  // 2026-05-27 audit r12 P1:listGroups invalidate 限定 episodeId(从 groupDetail 取),防跨 episode cache 污染
  React.useEffect(() => {
    if (progress.kind === 'success' || progress.kind === 'failed') {
      void utils.aigc.listVideoTakes.invalidate({ groupId });
      const episodeId = groupDetail?.group.episodeId;
      if (episodeId) {
        void utils.aigc.listGroups.invalidate({ episodeId });
      } else {
        // 兜底:groupDetail 还未加载就走 fail/success(极少见)
        void utils.aigc.listGroups.invalidate();
      }
    }
  }, [progress.kind, groupId, utils, groupDetail]);

  // 2026-05-27 用户反馈:rejected take 视为"已删除",列表 + 主预览候选都 filter 掉
  const visibleTakes = React.useMemo(
    () => (takes ?? []).filter((t) => !t.rejected),
    [takes],
  );

  // 2026-05-27 用户反馈:动态进度条 — 基于 RUNNING take.createdAt + 预期时长估算
  // 真 SSE percent 优先,没有用时间估算(Seedance 2.0 fast ≈ 3min, std ≈ 6min)
  const inflightTake = React.useMemo(
    () =>
      visibleTakes.find(
        (t) => t.status === 'RUNNING' || t.status === 'QUEUED',
      ),
    [visibleTakes],
  );
  // 二十九收工 S1:1s timer 抽到 <InflightProgressPanel> 子组件,
  // 父组件不再因 nowTick state 全量 re-render(原 1949 行组件每秒刷新)
  // expected duration:2.0 fast 3 分钟 / 2.0 std 6 分钟(从 capabilities.providerId 区分)
  const expectedMs = (capabilities?.providerId ?? '').includes('fast')
    ? 3 * 60_000
    : 6 * 60_000;

  // 默认选中最新 take(无论 status — FAILED/RUNNING 也显,让用户看错误 / 进度)
  // 用户删了当前 selectedTake 后自动重选 latest
  // 2026-05-27 用户反馈:之前 firstSuccess 优先 → 失败时主预览空白不知所措,改 latest
  React.useEffect(() => {
    if (!takes) return;
    const currentValid =
      selectedTakeId && visibleTakes.some((t) => t.id === selectedTakeId);
    if (currentValid) return;
    // takes server desc 排序,visibleTakes[0] = latest
    setSelectedTakeId(visibleTakes[0]?.id ?? null);
  }, [takes, visibleTakes, selectedTakeId]);

  // W5 完善 U1:外部触发自动切到新生成的 take(generateVideo onSuccess)
  React.useEffect(() => {
    if (!autoSelectAttemptId || !takes) return;
    const exists = takes.find((t) => t.id === autoSelectAttemptId);
    if (exists) {
      setSelectedTakeId(autoSelectAttemptId);
      onAutoSelectConsumed();
    }
  }, [autoSelectAttemptId, takes, onAutoSelectConsumed]);

  const selectedTake = visibleTakes.find((t) => t.id === selectedTakeId);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          视频预览
          {capabilities?.isMock && (
            <span className="ml-1 rounded bg-amber-500/15 px-1 text-[10px] font-normal text-amber-700 dark:text-amber-400">
              MOCK
            </span>
          )}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {/* 用户反馈 2026-05-27:模型下拉 — 默认 binding 配置的(由 server 返回 providerId 决定),
           *  用户可切其他 active video provider · 切换后 capabilities refetch + generate 传 providerOverride */}
          <select
            value={selectedProviderId ?? capabilities?.providerId ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              // 切回 binding 默认:选择跟 capabilities.providerId 一样时清空 override
              setSelectedProviderId(
                v && v !== capabilities?.providerId ? v : null,
              );
            }}
            disabled={!videoProviders || videoProviders.length === 0}
            className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
            title="选择视频生成模型(默认用后台 binding 设定的)"
          >
            {videoProviders && videoProviders.length > 0 ? (
              videoProviders.map((p) => (
                <option key={p.providerId} value={p.providerId}>
                  {p.displayName}
                </option>
              ))
            ) : (
              <option value="">加载中...</option>
            )}
          </select>
          {/* W5.5 D7:aspectRatio 按 Provider 支持的渲染(用户反馈 2026-05-27 扩 6 选项) */}
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
            className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
          >
            {(capabilities?.supportedAspectRatios ?? ASPECT_RATIOS).map((r) => (
              <option key={r} value={r}>
                {ASPECT_LABEL[r as AspectRatio] ?? r}
              </option>
            ))}
          </select>
          {/* W5.5 D6:durationS 按 Provider maxDuration 动态渲染 1-N 秒 */}
          <select
            value={durationS}
            onChange={(e) => setDurationS(Number(e.target.value))}
            className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
            title={
              capabilities
                ? `${capabilities.displayName} 支持 ${capabilities.minDurationS}-${capabilities.maxDurationS} s`
                : '加载 Provider 能力中...'
            }
          >
            {(() => {
              if (!capabilities) {
                return [3, 5, 8, 10].map((s) => (
                  <option key={s} value={s}>{s} s</option>
                ));
              }
              const opts: number[] = [];
              for (let s = capabilities.minDurationS; s <= capabilities.maxDurationS; s++) {
                opts.push(s);
              }
              return opts.map((s) => (
                <option key={s} value={s}>{s} s</option>
              ));
            })()}
          </select>
          {/* 2026-05-27 用户反馈:删高级选项 details,分辨率 + 同步音频 直接平铺到 toolbar */}
          <select
            value={resolution}
            onChange={(e) =>
              setResolution(e.target.value as '480p' | '720p' | '1080p')
            }
            disabled={!capabilities}
            title="视频分辨率(Seedance 2.0 仅 480p/720p)"
            className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
          >
            {(capabilities?.supportedResolutions ?? ['480p', '720p', '1080p']).map(
              (r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ),
            )}
          </select>
          {capabilities?.supportsAudio && (
            <label
              className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
              title="生成同步音频(Seedance 2.0 真支持)"
            >
              <input
                type="checkbox"
                checked={generateAudio}
                onChange={(e) => setGenerateAudio(e.target.checked)}
                className="size-3 cursor-pointer accent-blue-600"
              />
              <span>音频</span>
            </label>
          )}
          <button
            onClick={() =>
              onGenerate({
                aspectRatio,
                durationS,
                // Provider 不支持的选项不传(router 透传给 worker → provider)
                resolution: capabilities?.supportedResolutions.includes(resolution)
                  ? resolution
                  : undefined,
                generateAudio: capabilities?.supportsAudio ? generateAudio : undefined,
                // 2026-05-27:用户改了 provider 下拉时传 override(空 = 用 binding 默认)
                providerOverride: selectedProviderId ?? undefined,
              })
            }
            disabled={
              generatePending ||
              progress.kind === 'connecting' ||
              progress.kind === 'running' ||
              progress.kind === 'progress' ||
              // 2026-05-27 audit r12 P1:capabilities 错误时禁点(否则会跑去 generate 失败误导用户)
              !!capabilitiesError ||
              !capabilities
            }
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            title={
              capabilitiesError
                ? `当前 Provider 不可用:${capabilitiesError.message}`
                : !capabilities
                  ? '加载 Provider 能力中...'
                  : undefined
            }
          >
            {generatePending
              ? '提交中...'
              : progress.kind === 'connecting'
                ? '连接中...'
                : progress.kind === 'running' || progress.kind === 'progress'
                  ? '生成中...'
                  : capabilitiesError
                    ? 'Provider 不可用'
                    : '生成视频'}
          </button>
        </div>
      </div>


      {/* 2026-05-27:capabilities query 失败 → 红色 banner 引导用户切换 / 去后台配置 */}
      {capabilitiesError && (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <div className="flex items-center gap-2">
            <span>⛔</span>
            <span className="font-medium">当前 Provider 不可用</span>
          </div>
          <div className="mt-1 break-words">{capabilitiesError.message}</div>
          <div className="mt-1 text-[10px] opacity-70">
            上方切换其他 Provider,或去 /admin/providers 检查模型激活状态 + token 配置
          </div>
        </div>
      )}

      {/* 2026-05-27 audit r12 P1:Mock fallback 时显式告诉用户原因 — 防止假装跑了真 Provider */}
      {capabilities?.isMock && capabilities.fallbackReason !== 'explicit_mock' && (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span className="font-medium">
              当前 Provider 未真实接入 — 生成的是占位样片(非真实视频)
            </span>
          </div>
          <div className="mt-1 break-words">
            {capabilities.fallbackReason === 'no_provider_config' &&
              `ProviderConfig 不存在 — 去 /admin/providers 添加 "${capabilities.displayName}"`}
            {capabilities.fallbackReason === 'provider_inactive' &&
              `Provider "${capabilities.displayName}" 已停用 — 去 /admin/providers 启用`}
            {capabilities.fallbackReason === 'adapter_route_failed' &&
              `Provider "${capabilities.displayName}" 已配置但 adapter 不识别 / token 缺失 — 去 /admin/providers 检查 token,确认 modelId 含 "seedance" 等已知适配器关键字`}
          </div>
        </div>
      )}

      {/* 2026-05-27 用户反馈:动态进度条 — SSE percent 优先,fallback 时间估算
       *  二十九收工 S1:整段抽到 <InflightProgressPanel> 子组件,
       *  timer 在子组件内跑,父组件 1949 行不再每秒 re-render */}
      {(inflightTake ||
        progress.kind === 'connecting' ||
        progress.kind === 'running' ||
        progress.kind === 'progress') && (
        <InflightProgressPanel
          startedAt={inflightTake ? new Date(inflightTake.createdAt) : null}
          expectedMs={expectedMs}
          providerDisplayName={capabilities?.displayName ?? 'provider'}
          progress={progress}
        />
      )}
      {progress.kind === 'failed' && (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          ⛔ 生成失败:{progress.errorMsg}
          {progress.retryable && (
            <span className="ml-2 text-[hsl(var(--color-muted-foreground))]">(可重试)</span>
          )}
        </div>
      )}

      {/* 主预览 — 用户反馈 2026-05-27:单列只显当前 take(默认 latest SUCCESS),
       *  历史进 dialog 看 + 下载小按钮 inline */}
      <div>
        {selectedTake && selectedTake.videoUrl ? (
          <div
            className={`relative overflow-hidden rounded-md border border-[hsl(var(--color-border))] bg-black ${
              ASPECT_CLASS[selectedTake.aspectRatio as AspectRatio] ??
              'aspect-[9/16]'
            }`}
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              key={selectedTake.id}
              src={selectedTake.videoUrl}
              controls
              playsInline
              preload="metadata"
              className="h-full w-full object-contain"
              onLoadedMetadata={(e) => {
                // 2026-05-27 audit r14 P1:metadata 加载完才能可靠 play(防 src 切换中断)
                if (pendingPlayId && pendingPlayId === selectedTake.id) {
                  e.currentTarget.play().catch((err) => {
                    console.debug('[VideoPreview] auto-play 被浏览器拒', err);
                  });
                  setPendingPlayId(null);
                }
              }}
            />
            {/* 删除"已标废片" overlay — 用户反馈 2026-05-27:rejected take 视为已删除,
             *  visibleTakes 已 filter,selectedTake 永不会含 rejected */}
          </div>
        ) : (
          // 2026-05-27 用户反馈:placeholder 区分 FAILED/RUNNING/empty 显具体原因
          <div
            className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-4 text-center text-xs ${
              ASPECT_CLASS[aspectRatio] ?? 'aspect-[9/16]'
            } ${
              selectedTake?.status === 'FAILED'
                ? 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300'
                : selectedTake?.status === 'RUNNING' ||
                    selectedTake?.status === 'QUEUED'
                  ? 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300'
                  : 'border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))] text-[hsl(var(--color-muted-foreground))]'
            }`}
          >
            {isLoading ? (
              <span>加载中...</span>
            ) : selectedTake?.status === 'FAILED' ? (
              <>
                <span className="text-lg">❌</span>
                <span className="font-medium">生成失败</span>
                <div className="max-h-32 max-w-full overflow-y-auto break-words text-[10px] leading-relaxed opacity-90">
                  {selectedTake.errorMsg ?? '(无具体原因 — 见管理后台 /admin/api-usage 复盘)'}
                </div>
                <div className="text-[10px] opacity-60">
                  可点上方"生成视频"重试,或调整提示词避开版权 / 敏感词
                </div>
              </>
            ) : selectedTake?.status === 'RUNNING' ||
              selectedTake?.status === 'QUEUED' ? (
              <>
                <span className="inline-block size-3 animate-pulse rounded-full bg-amber-500" />
                <span className="font-medium">生成中...</span>
                <span className="text-[10px] opacity-70">
                  Seedance 2.0 Fast 约 3-4 分钟,系统每 5 秒自动刷新状态
                </span>
              </>
            ) : (
              <span>还没有视频 — 点右上"生成视频"开始抽卡</span>
            )}
          </div>
        )}

        {/* info bar:左 meta + 右 actions(下载 / 历史 / 标废片) */}
        <div className="mt-2 flex items-start justify-between gap-2 text-[length:0.78em] text-[hsl(var(--color-muted-foreground))]">
          <div className="min-w-0 flex-1">
            {selectedTake ? (
              <>
                <div className="truncate">{selectedTake.providerId}</div>
                <div className="truncate text-[length:0.7em]">
                  {new Date(selectedTake.createdAt).toLocaleString()}
                  {selectedTake.durationMs &&
                    ` · 耗时 ${Math.round(selectedTake.durationMs / 100) / 10} s`}
                  {' · '}
                  {Number(selectedTake.costCny ?? 0).toFixed(2)} ¥
                </div>
              </>
            ) : (
              <span>
                {takes && takes.length > 0
                  ? '从历史中选择查看'
                  : '暂无视频'}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {selectedTake?.videoUrl && (
              <a
                href={selectedTake.videoUrl}
                download={buildDownloadFilename(selectedTake.id, selectedTake.createdAt)}
                title="下载视频"
                aria-label="下载视频"
                className="inline-flex h-7 items-center justify-center rounded-md border border-[hsl(var(--color-border))] px-2 hover:bg-[hsl(var(--color-muted))]"
              >
                <Download className="size-3.5" />
              </a>
            )}
            {selectedTake && (
              <button
                onClick={() => {
                  // 2026-05-27 用户反馈:删除 = 软删(rejected=true)前端 filter,DB 保审计
                  if (
                    window.confirm(
                      '确定从历史中删除这次视频抽卡?\n(DB 保留审计记录,前端不再显示)',
                    )
                  ) {
                    onReject(selectedTake.id);
                  }
                }}
                disabled={rejectPending}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-[hsl(var(--color-border))] px-2 hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                title="从历史中删除(DB 保审计,前端隐藏)"
              >
                <Trash2 className="size-3.5" />
                删除
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2026-05-27 用户反馈:历史常驻列表(不再 dialog),点条目自动播放;rejected take filter 掉(视为删除) */}
      {visibleTakes.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-[hsl(var(--color-muted-foreground))]">
            <span>
              <History className="mr-1 inline size-3" />
              历史 {visibleTakes.length}
            </span>
          </div>
          <div className="max-h-[40vh] space-y-1.5 overflow-y-auto pr-1">
            {visibleTakes.map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                  selectedTakeId === t.id
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-[hsl(var(--color-border))]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!t.videoUrl) return;
                    handleSelectHistoryTake(t.id);
                  }}
                  disabled={!t.videoUrl}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
                  title={
                    t.videoUrl
                      ? '点击切到主预览并自动播放'
                      : t.status === 'FAILED'
                        ? `失败:${t.errorMsg ?? '无 video URL'}`
                        : '生成中,稍候'
                  }
                >
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded text-[10px] font-medium ${
                      t.status === 'SUCCESS'
                        ? 'bg-green-600/20 text-green-700 dark:text-green-400'
                        : t.status === 'FAILED'
                          ? 'bg-red-600/20 text-red-700 dark:text-red-400'
                          : 'bg-amber-500/20 text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {t.status === 'SUCCESS'
                      ? '✓'
                      : t.status === 'FAILED'
                        ? '✕'
                        : '⋯'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[length:0.78em] font-medium">
                      {new Date(t.createdAt).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                      {Number(t.costCny ?? 0).toFixed(2)}¥
                      {t.durationMs &&
                        ` · 耗时 ${Math.round(t.durationMs / 100) / 10} s`}
                    </div>
                    {/* 2026-05-27 用户反馈:errorMsg 完整显(不再 slice),失败原因可见 */}
                    {t.errorMsg && (
                      <div className="mt-0.5 break-words text-[10px] leading-tight text-red-700 dark:text-red-400">
                        ❌ {t.errorMsg}
                      </div>
                    )}
                  </div>
                </button>
                {t.videoUrl && (
                  <a
                    href={t.videoUrl}
                    download={buildDownloadFilename(t.id, t.createdAt)}
                    title="下载此条视频"
                    aria-label="下载视频"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-muted))]"
                  >
                    <Download className="size-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        '确定从历史中删除这次抽卡?\n(DB 保留审计记录,前端不再显示)',
                      )
                    ) {
                      onReject(t.id);
                    }
                  }}
                  disabled={rejectPending}
                  title="从历史删除(DB 保审计)"
                  aria-label="删除"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-[hsl(var(--color-border))] hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
