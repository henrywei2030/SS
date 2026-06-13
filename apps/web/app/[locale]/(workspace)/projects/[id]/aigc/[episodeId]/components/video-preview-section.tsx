'use client';
import * as React from 'react';
import {
  Ban,
  Check,
  Download,
  History,
  Minus,
  MoreHorizontal,
  Swords,
  TriangleAlert,
  Trash2,
  X,
} from 'lucide-react';

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
// 七二第九波(用户③:横屏适当放大不留白):预览框最大宽度按 aspect 分档 —— 竖屏窄、横屏宽,
//   横屏不再被 18rem 卡成小条占满列宽(max-w 只是上限,列更窄时自然收缩,不会溢出)。
const ASPECT_MAXW: Record<AspectRatio, string> = {
  '21:9': 'max-w-[36rem]',
  '16:9': 'max-w-[32rem]',
  '4:3': 'max-w-[26rem]',
  '1:1': 'max-w-[22rem]',
  '3:4': 'max-w-[19rem]',
  '9:16': 'max-w-[18rem]',
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
    // F5b(七二)对决:第二家 provider(与主家不同;双扣费,各自独立终态)
    duelProviderOverride?: string;
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
        // 六八:有"缓存中"的成功 take(直链已可播但还没落本地)也轮询,等缓存完毕翻绿
        const hasCaching = data?.some(
          (t) => t.status === 'SUCCESS' && !!t.videoUrl && !t.cached,
        );
        // M3c:QC 评分中(开关已启用且在评分时间窗内)也轮询,等徽章出分
        const hasQcPending = data?.some((t) => t.qcPending);
        return hasInflight || hasCaching || hasQcPending ? 5_000 : false;
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
  // F5b(七二)对决:第二家 provider(null=不对决)
  const [duelProviderId, setDuelProviderId] = React.useState<string | null>(null);
  const { data: videoProviders } = trpc.aigc.listVideoProviders.useQuery();

  // W5.5 D6:Provider 能力查询 — providerId 传 selectedProviderId(null 时 server 走 binding)
  // 2026-05-27:error 时 UI 显红色 banner,引导用户切换或去 /admin/providers 配置
  const { data: capabilities, error: capabilitiesError } =
    trpc.aigc.getProviderCapabilities.useQuery({
      providerId: selectedProviderId ?? undefined,
    });
  // W5.5 D6:group.durationS 作为智能默认(按分镜复杂度,1 个 shot 6s / 3 个 shots 15s 等)
  const { data: groupDetail } = trpc.aigc.getGroupDetail.useQuery({ groupId });

  // 六八:下载改走 /api/media/[id]/download 同源路由 — 文件名由服务端按媒体命名规范
  // (项目_第E集_分镜G_第K次.mp4)带出,原前端 buildDownloadFilename 退役。
  const utils = trpc.useUtils();

  // M3c:按 QC 分排序开关(默认时间序;开了高分在前,未评分压底保持时间序 — sort 稳定)
  const [sortByQc, setSortByQc] = React.useState(false);

  // 2026-05-27 用户反馈:rejected take 视为"已删除",列表 + 主预览候选都 filter 掉
  const visibleTakes = React.useMemo(() => {
    const base = (takes ?? []).filter((t) => !t.rejected);
    if (!sortByQc) return base;
    return [...base].sort((a, b) => (b.qcScore ?? -1) - (a.qcScore ?? -1));
  }, [takes, sortByQc]);

  // 2026-05-27 用户反馈:动态进度条 — 基于 RUNNING take.createdAt + 预期时长估算
  // 真 SSE percent 优先,没有用时间估算(Seedance 2.0 fast ≈ 3min, std ≈ 6min)
  const inflightTake = React.useMemo(
    () =>
      visibleTakes.find(
        (t) => t.status === 'RUNNING' || t.status === 'QUEUED',
      ),
    [visibleTakes],
  );

  // W5.5 D5 + 全盘审查 #9:SSE 实时进度订阅「正在跑的 take」而非 autoSelectAttemptId。
  //   原订阅 autoSelectAttemptId,但 autoSelect 在 take 一出现(RUNNING)就被 onAutoSelectConsumed
  //   置 null → SSE EventSource 提前卸载、实时 percent 断流(只剩 5s 轮询)。改订阅 inflightTake.id 后,
  //   SSE 生命周期与 RUNNING/QUEUED 对齐,生成结束(终态后 inflightTake 消失)才卸载。
  const progress = useAigcProgress(inflightTake?.id ?? null);

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

  // 七二第九波(用户③):预览框最大宽度跟随 aspect(横屏放大,竖屏保持窄)
  const previewMaxW = ASPECT_MAXW[aspectRatio] ?? 'max-w-[18rem]';

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
  // 二十九收工 S1:1s timer 抽到 <InflightProgressPanel> 子组件,
  // 父组件不再因 nowTick state 全量 re-render(原 1949 行组件每秒刷新)
  // expected duration:2.0 fast 3 分钟 / 2.0 std 6 分钟(从 capabilities.providerId 区分)
  // 七二第九波(用户①):去 seedance 专属假设 —— 非 fast 不再一律按 seedance 6 分钟,
  //   happyhorse/wan 等落中性 5 分钟估值(仅影响进度条估算,不影响真实生成)。
  const _pid = capabilities?.providerId ?? '';
  const expectedMs = _pid.includes('fast')
    ? 3 * 60_000
    : _pid.includes('seedance')
      ? 6 * 60_000
      : 5 * 60_000;

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
            <span className="ml-1 rounded bg-[hsl(var(--color-warning-bg))] px-1 text-[10px] font-normal text-[hsl(var(--color-warning))]">
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
          {/* F5b(七二)对决:第二家 provider — 选了即双扣费并行生成,完成出对比卡 */}
          {videoProviders && videoProviders.length > 1 && (
            <select
              value={duelProviderId ?? ''}
              onChange={(e) => setDuelProviderId(e.target.value || null)}
              className={`rounded-md border px-2 py-1.5 text-xs ${
                duelProviderId
                  ? 'border-purple-500/60 bg-purple-500/10 text-purple-700 dark:text-purple-300'
                  : 'border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]'
              }`}
              title="对决:再选一家并行生成同一组(双倍扣费),完成后并排对比择优"
            >
              <option value="">⚔ 不对决</option>
              {videoProviders
                .filter(
                  (p) => p.providerId !== (selectedProviderId ?? capabilities?.providerId),
                )
                .map((p) => (
                  <option key={p.providerId} value={p.providerId}>
                    ⚔ vs {p.displayName}
                  </option>
                ))}
            </select>
          )}
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
            title={`视频分辨率(当前模型支持 ${(capabilities?.supportedResolutions ?? ['480p', '720p', '1080p']).join('/')})`}
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
              title="生成同步音频(当前模型支持);绑定角色的参考音频会自动带上作配音参考"
            >
              <input
                type="checkbox"
                checked={generateAudio}
                onChange={(e) => setGenerateAudio(e.target.checked)}
                className="size-3 cursor-pointer accent-[hsl(var(--color-info))]"
              />
              <span>
                音频
                {(capabilities?.audioSurchargeCnyPerS ?? 0) > 0 &&
                  `(+¥${capabilities!.audioSurchargeCnyPerS}/s)`}
              </span>
            </label>
          )}
          {/* M2′:生成前费用预估(基础单价 + 有声差价,按当前时长) */}
          {capabilities && !capabilities.isMock && (
            <span
              className="text-[11px] text-[hsl(var(--color-muted-foreground))]"
              title={`单价 ¥${capabilities.estimatedCnyPerS}/s${generateAudio && (capabilities.audioSurchargeCnyPerS ?? 0) > 0 ? ` + 有声 ¥${capabilities.audioSurchargeCnyPerS}/s` : ''} × ${durationS}s(预扣口径,实扣按 provider 结算)`}
            >
              ≈¥
              {(
                ((capabilities.estimatedCnyPerS ?? 0) +
                  (generateAudio && capabilities.supportsAudio
                    ? (capabilities.audioSurchargeCnyPerS ?? 0)
                    : 0)) *
                durationS
              ).toFixed(2)}
            </span>
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
                // F5b(七二)对决:第二家(与主家相同时不传,服务端也有同家校验)
                duelProviderOverride:
                  duelProviderId &&
                  duelProviderId !== (selectedProviderId ?? capabilities?.providerId)
                    ? duelProviderId
                    : undefined,
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
            className="rounded-md bg-[hsl(var(--color-info))] px-3 py-1.5 text-xs font-medium text-white hover:bg-[hsl(var(--color-info)/0.85)] disabled:opacity-50"
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
        <div className="mb-3 rounded-md border border-[hsl(var(--color-danger)/0.3)] bg-[hsl(var(--color-danger)/0.05)] px-3 py-2 text-xs text-[hsl(var(--color-danger))]">
          <div className="flex items-center gap-2">
            <Ban className="size-3.5" />
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
        <div className="mb-3 rounded-md border border-[hsl(var(--color-warning)/0.3)] bg-[hsl(var(--color-warning)/0.05)] px-3 py-2 text-xs text-[hsl(var(--color-warning))]">
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-3.5" />
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
        <div className="mb-3 flex items-center gap-1.5 rounded-md border border-[hsl(var(--color-danger)/0.3)] bg-[hsl(var(--color-danger)/0.05)] px-3 py-2 text-xs text-[hsl(var(--color-danger))]">
          <Ban className="size-3.5 shrink-0" />
          <span>生成失败:{progress.errorMsg}</span>
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
            className={`relative mx-auto ${previewMaxW} overflow-hidden rounded-md border border-[hsl(var(--color-border))] bg-black ${
              // 七二第九波:预览框跟随项目配置的 aspect(经 useVideoSettings 跟随 project.aspect),
              //   与占位框统一,满足「预览窗口与项目尺寸一致 + 改项目自动调整」;横屏按 previewMaxW 放大。
              //   <video object-contain> 保证真实视频不变形;历史错配 take 会 letterbox 如实呈现。
              ASPECT_CLASS[aspectRatio] ?? 'aspect-[9/16]'
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
            className={`mx-auto flex ${previewMaxW} flex-col items-center justify-center gap-2 rounded-md border border-dashed p-4 text-center text-xs ${
              ASPECT_CLASS[aspectRatio] ?? 'aspect-[9/16]'
            } ${
              selectedTake?.status === 'FAILED'
                ? 'border-[hsl(var(--color-danger)/0.4)] bg-[hsl(var(--color-danger)/0.05)] text-[hsl(var(--color-danger))]'
                : selectedTake?.status === 'RUNNING' ||
                    selectedTake?.status === 'QUEUED'
                  ? 'border-[hsl(var(--color-warning)/0.4)] bg-[hsl(var(--color-warning)/0.05)] text-[hsl(var(--color-warning))]'
                  : 'border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))] text-[hsl(var(--color-muted-foreground))]'
            }`}
          >
            {isLoading ? (
              <span>加载中...</span>
            ) : selectedTake?.status === 'FAILED' ? (
              <>
                <X className="size-5" />
                <span className="font-medium">生成失败</span>
                <div className="max-h-32 max-w-full overflow-y-auto break-words text-[10px] leading-relaxed opacity-90">
                  {selectedTake.errorMsg ?? '(无具体原因 — 见管理后台 /admin/api-usage 复盘)'}
                </div>
                <div className="text-[10px] opacity-60">
                  可点上方"生成视频"重试,或调整提示词避开版权 / 敏感词
                </div>
              </>
            ) : selectedTake?.status === 'CANCELLED' ? (
              // F4 深审修(P2):取消批量后最新 take 是 CANCELLED — 原 else 分支显示
              // "还没有视频"误导;主动取消用中性灰呈现,不当失败
              <>
                <Minus className="size-5" />
                <span className="font-medium">已取消</span>
                <span className="text-[10px] opacity-70">
                  批量排队时被取消,预扣费用已退还 — 点右上"生成视频"可重新抽卡
                </span>
              </>
            ) : selectedTake?.status === 'RUNNING' ||
              selectedTake?.status === 'QUEUED' ? (
              <>
                <span className="inline-block size-3 animate-pulse rounded-full bg-[hsl(var(--color-warning))]" />
                <span className="font-medium">生成中...</span>
                <span className="text-[10px] opacity-70">
                  {/* 七二第九波(用户①):过场文案跟当前 provider 动态,不再写死 Seedance */}
                  {capabilities?.displayName ?? '视频模型'} 约 {Math.round(expectedMs / 60_000)}{' '}
                  分钟,系统每 5 秒自动刷新状态
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
                <div className="flex items-center gap-1.5 truncate">
                  <span className="truncate">{selectedTake.providerId}</span>
                  {/* 六八:缓存状态 — 完毕(绿,本地播放顺滑)/缓存中(琥珀,暂走直链可能卡) */}
                  {selectedTake.videoUrl &&
                    (selectedTake.cached ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-[hsl(var(--color-success-bg))] px-1 py-0.5 text-[10px] font-medium text-[hsl(var(--color-success))]">
                        <Check className="size-3" /> 缓存完毕
                      </span>
                    ) : (
                      <span className="shrink-0 rounded bg-[hsl(var(--color-warning-bg))] px-1 py-0.5 text-[10px] font-medium text-[hsl(var(--color-warning))]">
                        ● 缓存中…
                      </span>
                    ))}
                  {/* M3c:QC 徽章(分数色阶/漂移/失败/评分中) */}
                  <QcBadge take={selectedTake} />
                </div>
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
            {selectedTake?.videoUrl && selectedTake.mediaId && (
              // 六八:走同源下载路由(attachment 弹另存为)— 原跨域 <a download> 会让浏览器
              // 整页导航到 mp4(桌面壳无返回键即死路)。文件名由服务端按媒体命名规范带出。
              <a
                href={`/api/media/${selectedTake.mediaId}/download`}
                title="下载视频到本地(弹出保存对话框)"
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
                className="inline-flex h-7 items-center gap-1 rounded-md border border-[hsl(var(--color-border))] px-2 hover:bg-[hsl(var(--color-danger)/0.1)] hover:text-[hsl(var(--color-danger))] disabled:opacity-50"
                title="从历史中删除(DB 保审计,前端隐藏)"
              >
                <Trash2 className="size-3.5" />
                删除
              </button>
            )}
          </div>
        </div>
      </div>

      {/* F5b-c(七二):对决并排对比卡 — 最新 duel 配对的两条 take 并排(QC/价格对照 + 一键采纳) */}
      {(() => {
        const tagged = (takes ?? []).filter((t) => !t.rejected && t.duelTag);
        if (tagged.length === 0) return null;
        const latestTag = tagged[0]!.duelTag;
        const pair = tagged.filter((t) => t.duelTag === latestTag);
        if (pair.length < 2) return null;
        const bothDone = pair.every((t) => t.status === 'SUCCESS' || t.status === 'FAILED');
        const provName = (pid: string): string =>
          videoProviders?.find((p) => p.providerId === pid)?.displayName ?? pid.replace(/^[a-z0-9]+-/i, '');
        return (
          <div className="mt-3 rounded-md border border-purple-500/40 bg-purple-500/5 p-2">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-purple-700 dark:text-purple-300">
              <span className="inline-flex items-center gap-1">
                <Swords className="size-3.5" /> 对决对比
              </span>
              {!bothDone && <span className="font-normal opacity-70">生成中,完成自动更新…</span>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {pair.slice(0, 2).map((t) => {
                const rival = pair.find((x) => x.id !== t.id);
                return (
                  <div
                    key={t.id}
                    className="overflow-hidden rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]"
                  >
                    <div className="bg-black">
                      {t.videoUrl ? (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <video src={t.videoUrl} controls playsInline preload="metadata" className="aspect-[9/16] max-h-48 w-full object-contain" />
                      ) : (
                        <div className="flex aspect-[9/16] max-h-48 w-full items-center justify-center gap-1 text-[10px] text-white/60">
                          {t.status === 'FAILED' ? (
                            <>
                              <X className="size-3 shrink-0" />
                              <span>失败:{(t.errorMsg ?? '').slice(0, 30)}</span>
                            </>
                          ) : (
                            '生成中…'
                          )}
                        </div>
                      )}
                    </div>
                    <div className="space-y-0.5 p-1.5 text-[10px]">
                      <div className="truncate font-medium" title={t.providerId}>
                        {provName(t.providerId)}
                      </div>
                      <div className="flex items-center justify-between text-[hsl(var(--color-muted-foreground))]">
                        <span>{t.qcScore !== null ? `QC ${t.qcScore}` : t.qcPending ? 'QC…' : 'QC -'}</span>
                        <span>¥{Number(t.costCny ?? 0).toFixed(2)}</span>
                      </div>
                      {t.status === 'SUCCESS' && rival && (
                        <button
                          onClick={() => {
                            if (rival.status === 'SUCCESS') {
                              if (!window.confirm(`采纳 ${provName(t.providerId)},把对方标废片?`)) return;
                              onReject(rival.id);
                            }
                            handleSelectHistoryTake(t.id);
                          }}
                          disabled={rejectPending}
                          className="w-full rounded bg-purple-600 py-1 text-[10px] font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                          title={rival.status === 'SUCCESS' ? '采纳此条(对方标废片,DB 保留审计)' : '切到主预览'}
                        >
                          采纳此条
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 2026-05-27 用户反馈:历史常驻列表(不再 dialog),点条目自动播放;rejected take filter 掉(视为删除) */}
      {visibleTakes.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-[hsl(var(--color-muted-foreground))]">
            <span>
              <History className="mr-1 inline size-3" />
              历史 {visibleTakes.length}
            </span>
            {/* M3c:有 QC 分的 take 才显示排序切换(否则排了也没意义) */}
            {visibleTakes.some((t) => t.qcScore !== null) && (
              <button
                type="button"
                onClick={() => setSortByQc((v) => !v)}
                className={`rounded border px-1.5 py-0.5 transition-colors ${
                  sortByQc
                    ? 'border-[hsl(var(--color-info))] bg-[hsl(var(--color-info)/0.1)] text-[hsl(var(--color-info))]'
                    : 'border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-muted))]'
                }`}
                title={sortByQc ? '当前按 QC 分排序(高分在前,未评分压底)' : '当前按时间排序(最新在前)'}
              >
                {sortByQc ? 'QC 分 ↓' : '时间 ↓'}
              </button>
            )}
          </div>
          {/* 七二(用户需求⑤-1):窗口默认 2 条高度(~6.5rem,第三条露一角当"还有更多"暗示),
           *  数量不限全量渲染,更多滚动查看 — 替代原 40vh 大窗(测试期历史多时占满屏) */}
          <div className="max-h-[6.5rem] space-y-1.5 overflow-y-auto pr-1">
            {visibleTakes.map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                  selectedTakeId === t.id
                    ? 'border-[hsl(var(--color-info))] bg-[hsl(var(--color-info)/0.1)]'
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
                        : t.status === 'CANCELLED'
                          ? '已取消(批量排队被摘除,费用已退还)'
                          : '生成中,稍候'
                  }
                >
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded text-[10px] font-medium ${
                      t.status === 'SUCCESS'
                        ? 'bg-[hsl(var(--color-success)/0.2)] text-[hsl(var(--color-success))]'
                        : t.status === 'FAILED'
                          ? 'bg-[hsl(var(--color-danger)/0.2)] text-[hsl(var(--color-danger))]'
                          : t.status === 'CANCELLED'
                            ? 'bg-[hsl(var(--color-neutral)/0.2)] text-[hsl(var(--color-neutral))]'
                            : 'bg-[hsl(var(--color-warning)/0.2)] text-[hsl(var(--color-warning))]'
                    }`}
                  >
                    {t.status === 'SUCCESS' ? (
                      <Check className="size-4" />
                    ) : t.status === 'FAILED' ? (
                      <X className="size-4" />
                    ) : t.status === 'CANCELLED' ? (
                      <Minus className="size-4" />
                    ) : (
                      <MoreHorizontal className="size-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[length:0.78em] font-medium">
                      <span className="truncate">
                        {new Date(t.createdAt).toLocaleString()}
                      </span>
                      {/* M3c:QC 徽章(分数色阶/漂移/失败/评分中) */}
                      <QcBadge take={t} />
                    </div>
                    <div className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                      {Number(t.costCny ?? 0).toFixed(2)}¥
                      {t.durationMs &&
                        ` · 耗时 ${Math.round(t.durationMs / 100) / 10} s`}
                    </div>
                    {/* 2026-05-27 用户反馈:errorMsg 完整显(不再 slice),失败原因可见 */}
                    {/* F4 深审修:CANCELLED 是主动取消,中性灰呈现不当失败 */}
                    {t.errorMsg && (
                      <div
                        className={`mt-0.5 flex items-start gap-1 break-words text-[10px] leading-tight ${
                          t.status === 'CANCELLED'
                            ? 'text-[hsl(var(--color-neutral))]'
                            : 'text-[hsl(var(--color-danger))]'
                        }`}
                      >
                        {t.status === 'CANCELLED' ? (
                          <Minus className="mt-px size-3 shrink-0" />
                        ) : (
                          <X className="mt-px size-3 shrink-0" />
                        )}
                        <span>{t.errorMsg}</span>
                      </div>
                    )}
                  </div>
                </button>
                {t.videoUrl && t.mediaId && (
                  <a
                    href={`/api/media/${t.mediaId}/download`}
                    title="下载此条视频(弹出保存对话框)"
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
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-danger)/0.1)] hover:text-[hsl(var(--color-danger))] disabled:opacity-50"
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

/**
 * M3c:take QC 徽章 — 分数色阶(≥80 绿 / 60-79 琥珀 / <60 红)+ 漂移红标 + 失败灰 + 评分中。
 * hover 看判官点评(qcNotes)/失败原因(qcError);未启用 QC 的 take 四态全空,渲染 null。
 */
function QcBadge({
  take,
}: {
  take: {
    qcScore: number | null;
    qcDrift: boolean;
    qcNotes: string | null;
    qcError: string | null;
    qcPending: boolean;
  };
}): React.ReactElement | null {
  if (take.qcScore !== null) {
    const tone =
      take.qcScore >= 80
        ? 'bg-[hsl(var(--color-success-bg))] text-[hsl(var(--color-success))]'
        : take.qcScore >= 60
          ? 'bg-[hsl(var(--color-warning-bg))] text-[hsl(var(--color-warning))]'
          : 'bg-[hsl(var(--color-danger-bg))] text-[hsl(var(--color-danger))]';
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <span
          title={take.qcNotes ?? 'QC 质检分(VLM 判官)'}
          className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${tone}`}
        >
          QC {take.qcScore}
        </span>
        {take.qcDrift && (
          <span
            title="人物漂移:帧中人物与参考形象图不一致"
            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-[hsl(var(--color-danger-bg))] px-1 py-0.5 text-[10px] font-medium text-[hsl(var(--color-danger))]"
          >
            <TriangleAlert className="size-3" /> 漂移
          </span>
        )}
      </span>
    );
  }
  if (take.qcError) {
    return (
      <span
        title={`QC 评分失败:${take.qcError}`}
        className="shrink-0 rounded bg-[hsl(var(--color-neutral-bg))] px-1 py-0.5 text-[10px] font-medium text-[hsl(var(--color-neutral))]"
      >
        QC 失败
      </span>
    );
  }
  if (take.qcPending) {
    return (
      <span
        title="QC 评分中(VLM 判官抽帧打分,分钟级)"
        className="shrink-0 rounded bg-[hsl(var(--color-info-bg))] px-1 py-0.5 text-[10px] font-medium text-[hsl(var(--color-info))]"
      >
        QC…
      </span>
    );
  }
  return null;
}
