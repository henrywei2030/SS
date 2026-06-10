/**
 * AIGC Router — W5.4 视频生成 + W5.5 SSE / 能力查询(机械拆分 ADR-31,纯搬运)。
 *   generateVideo / getStreamToken / listVideoProviders / getProviderCapabilities
 *   / listVideoTakes / rejectVideoTake
 *
 * getVideoBindings 仅本组用,留作模块内 helper(未抽 aigc-shared)。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getVideoProvider } from '@ss/adapters/provider';
import { getStorageAdapter } from '@ss/adapters/storage';
// M4 先决重构:generateVideo 主体下沉 core submitVideoGeneration(锁/sweep/占位/预算/
// 编译/合规/入队全在 core,本层只做 binding 解析 + 判别结果 → TRPCError 映射)
import {
  loadVideoGenBindings,
  submitVideoGeneration,
  type VideoGenBindings,
} from '@ss/core/video-generation';

// 三十二收工 S3 followup:SystemSetting batch 读 helper
import { QC_JUDGE_BINDING_KEY, TAKE_QC_ENABLED_KEY } from '@ss/core/qc';
import { loadSystemSettings } from '../utils/system-bindings.js';
import { ASPECT_RATIOS, type AspectRatio } from '@ss/shared/constants';
import { aspectRatioSchema } from '@ss/shared/schemas';
import { signStreamToken } from '@ss/queue/sse-token';

import { protectedProcedure, rateLimit } from '../trpc.js';
import type { Context } from '../context.js';
import { logOperation } from '../middleware/audit.js';
import { isEpisodeLockedNow } from '../utils/episode-lock.js';
import { assertProjectAccess } from '../middleware/access.js';

import { loadGroupOrThrow } from './aigc-shared.js';

// M3c:qcPending 时间窗 — QC 在 take 成功后即入队,正常分钟级出分;超窗仍未出分
// (开关后开 / 历史 take / job 丢失)不再让前端为它轮询
const QC_PENDING_WINDOW_MS = 15 * 60_000;

/** M3c:qcJson(Json 列)安全读取 — 写入形状见 core/qc process-job,这里防御性窄化 */
function readQcJson(qcJson: unknown): {
  drift: boolean;
  notes: string | null;
  error: string | null;
} {
  if (!qcJson || typeof qcJson !== 'object' || Array.isArray(qcJson)) {
    return { drift: false, notes: null, error: null };
  }
  const o = qcJson as Record<string, unknown>;
  return {
    drift: o.drift === true,
    notes: typeof o.notes === 'string' && o.notes.length > 0 ? o.notes : null,
    error: typeof o.error === 'string' ? o.error : null,
  };
}

// W5.4:视频生成相关 SystemSetting 读取
// F4:实现下沉 core loadVideoGenBindings(批量自动重抽在 worker 侧复用同一解析),本层转调
async function getVideoBindings(ctx: Context): Promise<VideoGenBindings> {
  return loadVideoGenBindings(ctx.prisma);
}

export const videoProcedures = {
  // ============================== W5.4 视频生成 ==============================

  /**
   * 生成视频(W5.4)— 调用视频 Provider(Seedance / Kling / HappyHorse / 本地 / Mock 兜底)
   *
   * Provider 选择优先级:input.providerOverride > SystemSetting.binding.shot.video.providerId
   * 真 provider 没配置 / 无 key → MockVideoProvider 自动兜底(返公开样片,UI 端到端可演示)
   */
  generateVideo: protectedProcedure
    // 第 19 轮 audit / ADR-27:最贵的 mutation,Mastra agent 调用前必看预算 + Provider 容量
    .meta({
      agentTool: {
        description: '为一个 ShotGroup 异步抽卡生成视频片段(BullMQ 入队,SSE 推进度),调 Seedance/Volcengine',
        sideEffects: [
          'queue.enqueue:VideoGenJob',
          'db.create:GenerationAttempt',
          'cost.deduct',
          'extern.api:VideoProvider',
        ],
        costEstimateCny: 2.0,
        requireConfirm: false,
      },
    })
    // W7 audit R8 P0:per-user 10 次 / 60s — 防同用户无限烧 LLM 钱
    .use(
      rateLimit({
        key: (ctx) => `aigc.generateVideo:${ctx.user?.id ?? 'anon'}`,
        max: 10,
        windowMs: 60_000,
        message: '视频抽卡过快(每分钟最多 10 次)— 请等等再试',
      }),
    )
    .input(
      z.object({
        groupId: z.string().cuid(),
        // 2026-05-27 audit r12 P0:int 强制整数,防小数 durationS 预扣多扣(用户输 10.5 → Provider 出 10s)
        durationS: z.number().int().min(1).max(15).optional(),
        // 用户反馈 2026-05-27:不再支持 'auto',aspectRatio 必须显式选(用户偏好 explicit-choice-only)
        aspectRatio: aspectRatioSchema.optional(),
        providerOverride: z.string().max(100).optional(),
        extraInstruction: z.string().max(500).optional(),
        extraNegative: z.array(z.string().max(50)).max(20).optional(),
        // W5.5.1 扩展参数(2026-05-24)
        resolution: z.enum(['480p', '720p', '1080p']).optional(),
        generateAudio: z.boolean().optional(),
        addWatermark: z.boolean().optional(),
        webSearchEnabled: z.boolean().optional(),
        refVideoUrl: z.string().min(1).max(2000).optional(),
        refAudioUrl: z.string().min(1).max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);
      const bindings = await getVideoBindings(ctx);

      const providerId = input.providerOverride ?? bindings.providerId;
      // 二十收工后用户反馈:不 hardcode 默认 provider,binding 空 + 无 override 时显式拒绝
      if (!providerId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '视频生成未配置 Video Provider — 请去 /admin/bindings 选择 binding.shot.video.providerId(或在调用时传 input.providerOverride 显式指定)',
        });
      }
      // 2026-05-27:不再支持 'auto',undefined 时 fallback 到 binding 默认值
      const aspectRatio = input.aspectRatio ?? bindings.defaultAspectRatio;
      // 深审修(范围外既有 bug 顺手清):grp.durationS 是 Float(LLM 可产 7.5),直传会被
      // VideoGenJobDataSchema 的 int() 拒 → 必然 ENQUEUE_FAILED;round 后再 clamp。
      // input.durationS 本身已被 zod int() 保证,不动。
      const durationS = Math.min(
        input.durationS ?? Math.round(grp.durationS ?? 5),
        bindings.maxDurationS,
      );
      const wantAudio = input.generateAudio ?? bindings.defaultGenerateAudio;

      // M4 先决重构:主体下沉 core submitVideoGeneration(锁/sweep/占位+PREPAY/抽卡上限/
      // 预算/编译/合规/能力门/升 RUNNING/入队),core 返判别 — deny 时占位已 FAILED + REFUND
      // 退净,这里只做 TRPCError 映射。binding 读取/参数 fallback 留本层(api 关注点)。
      const result = await submitVideoGeneration(ctx.prisma, {
        group: {
          id: grp.id,
          number: grp.number,
          prompt: grp.prompt,
          durationS: grp.durationS,
          episodeId: grp.episodeId,
          projectId: grp.episode.projectId,
        },
        userId: ctx.user.id,
        providerId,
        durationS,
        aspectRatio,
        wantAudio,
        dailyBudgetCny: bindings.dailyBudgetCny,
        requireComplianceForVideo: bindings.requireComplianceForVideo,
        extraInstruction: input.extraInstruction,
        extraNegative: input.extraNegative,
        resolution: input.resolution,
        addWatermark: input.addWatermark,
        webSearchEnabled: input.webSearchEnabled,
        refVideoUrl: input.refVideoUrl,
        refAudioUrl: input.refAudioUrl,
        // 第 19 轮 audit P1:requestId 贯通到 worker,运维 grep 日志可看全链路
        requestId: ctx.requestId,
      });
      if (!result.ok) {
        if (result.code === 'ENQUEUE_FAILED') {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: result.message,
            cause: result.cause,
          });
        }
        throw new TRPCError({ code: result.code, message: result.message });
      }

      await logOperation(ctx, 'aigc.generateVideo.enqueued', 'shotGroup', grp.id, null, {
        attemptId: result.attemptId,
        providerId,
        aspectRatio,
        durationS,
        projectId: grp.episode.projectId,
      });

      return {
        attemptId: result.attemptId,
        status: 'RUNNING' as const,
      };
    }),

  // ============================== W5.5 SSE + 能力查询 ==============================

  /**
   * SSE 访问 token(ADR-25 M5)— EventSource 不能塞自定义 header,只能用 query。
   *
   * 用 HMAC 短 TTL 票据替代"session cookie 走 query"的不安全做法:
   *   - 校 attemptId 关联的 projectId 用户访问权后签 5min token
   *   - 前端拿 token → `new EventSource('/api/sse/aigc/${id}?token=...')`
   *   - SSE route 仅校 token,长连接服务零业务逻辑
   */
  getStreamToken: protectedProcedure
    .input(z.object({ attemptId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const attempt = await ctx.prisma.generationAttempt.findFirst({
        where: { id: input.attemptId, action: 'VIDEO' },
        include: { shotGroup: { include: { episode: true } } },
      });
      if (!attempt || !attempt.shotGroup) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'attempt 不存在' });
      }
      await assertProjectAccess(ctx, attempt.shotGroup.episode.projectId);
      return signStreamToken({
        attemptId: input.attemptId,
        userId: ctx.user.id,
      });
    }),

  /**
   * 列出所有 active VIDEO Provider — 用户反馈 2026-05-27:AIGC 视频预览加模型下拉
   *
   * 默认选当前 binding 的 providerId(由 getProviderCapabilities 返回),用户可切换。
   * 切换后 capabilities 重 query + generateVideo 传 providerOverride。
   */
  listVideoProviders: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.providerConfig.findMany({
      where: { kind: 'VIDEO', isActive: true },
      orderBy: [{ providerId: 'asc' }],
      select: {
        providerId: true,
        displayName: true,
      },
    });
    return rows;
  }),

  /**
   * Provider 能力查询(W5.5)— 前端渲染时长选择器范围 / 比例选择 / 显示当前模型名
   *
   * 数据源优先级:
   *   1. ProviderConfig.defaultParams.maxDurationS(后台 /admin/providers 可改 JSON 字段)
   *   2. Provider.info.maxDuration(Adapter 自报)
   *   3. SystemSetting `shot.video.maxDurationS`(全局兜底)
   *   4. 15s 默认(2026-05-27 业务上限提到 15s)
   *
   * 不传 providerId 时返回当前 SystemSetting binding 的 video provider 信息。
   * 业界 2026 现状:视频模型上限 ≤15s,这里硬截。
   */
  getProviderCapabilities: protectedProcedure
    .input(z.object({ providerId: z.string().max(100).optional() }))
    .query(async ({ ctx, input }) => {
      const bindings = await getVideoBindings(ctx);
      const providerId = input.providerId ?? bindings.providerId;

      const config = await ctx.prisma.providerConfig.findUnique({
        where: { providerId },
        select: {
          displayName: true,
          defaultParams: true,
          isActive: true,
        },
      });

      // Provider Adapter 自报(kind 不对会 throw)
      const provider = await getVideoProvider(providerId);

      // 解析 defaultParams JSON(后台 /admin/providers 可改)
      const params: Record<string, unknown> =
        config?.defaultParams && typeof config.defaultParams === 'object'
          ? (config.defaultParams as Record<string, unknown>)
          : {};

      // 2026-05-27 audit r13:字段名跟 catalog/seed.ts 对齐(都用 maxDuration / minDuration,无 S)
      // 之前 capabilities 读 maxDurationS / minDurationS 永远 undefined → fallback 走 provider.info.maxDuration
      // 老 ProviderConfig 行(maxDuration:10)未 reseed 时仍是 10,用户看到下拉只到 10 — 字段名不一致根因
      const adminMaxDuration =
        typeof params.maxDuration === 'number'
          ? params.maxDuration
          : typeof params.maxDurationS === 'number'
            ? params.maxDurationS // 兼容老字段名(若有手工写入)
            : null;
      const adminMinDuration =
        typeof params.minDuration === 'number'
          ? params.minDuration
          : typeof params.minDurationS === 'number'
            ? params.minDurationS
            : null;
      const adminAspectRatios = Array.isArray(params.supportedAspectRatios)
        ? (params.supportedAspectRatios as unknown[]).filter(
            (r): r is AspectRatio =>
              typeof r === 'string' && (ASPECT_RATIOS as readonly string[]).includes(r),
          )
        : null;

      const rawMaxDuration =
        adminMaxDuration ?? provider.info.maxDuration ?? bindings.maxDurationS ?? 15;
      const maxDurationS = Math.min(Math.max(rawMaxDuration, 1), 15);
      const minDurationS = Math.max(adminMinDuration ?? 1, 1);
      const supportedAspectRatios =
        adminAspectRatios && adminAspectRatios.length > 0
          ? adminAspectRatios
          : ASPECT_RATIOS;

      // W5.5.1 扩展(2026-05-24):分辨率 / 音频 / 水印 / 参考素材等能力标志
      // 数据源同 maxDuration:ProviderConfig.defaultParams 优先,fallback 到默认值
      const adminResolutions = Array.isArray(params.supportedResolutions)
        ? (params.supportedResolutions as unknown[]).filter(
            (r): r is '480p' | '720p' | '1080p' =>
              r === '480p' || r === '720p' || r === '1080p',
          )
        : null;
      // 用户反馈 2026-05-27:分辨率默认全 3 档 480p/720p/1080p
      // 各 model 实际能力由 admin 后台 ProviderConfig.defaultParams.supportedResolutions 覆盖
      const supportedResolutions: Array<'480p' | '720p' | '1080p'> =
        adminResolutions && adminResolutions.length > 0
          ? adminResolutions
          : ['480p', '720p', '1080p'];
      const defaultResolution =
        typeof params.defaultResolution === 'string' &&
        ['480p', '720p', '1080p'].includes(params.defaultResolution)
          ? (params.defaultResolution as '480p' | '720p' | '1080p')
          : '720p';

      const supportsAudio = params.supportsAudio === true;
      const supportsWatermark = params.supportsWatermark !== false; // 默认 true(水印多数 Provider 都能后处理)
      const supportsWebSearch = params.supportsWebSearch === true;
      const supportsRefImage = params.supportsRefImage !== false; // 默认 true
      const supportsRefVideo = params.supportsRefVideo === true;
      const supportsRefAudio = params.supportsRefAudio === true;

      // 2026-05-27 audit r14 P1:isMock 检测统一用 provider 实例类型 + providerId 对比
      // 之前 `displayName.toLowerCase().includes('mock')` 会误报(displayName 含 'Mock' / 'demo-mock' 等)
      // MockVideoProvider 的 info.displayName 必含 "(Mock W5.4)" 标记,但更稳的是
      // 看 provider.info.id 跟原 providerId 是否被 fallback 改造过 — 实际 MockVideoProvider 保留原 id,
      // 改用 displayName 严格含 "(Mock " 前缀(MockVideoProvider 构造器固定模板)
      const isMock = /\(Mock\b/.test(provider.info.displayName);
      // 4 种 fallback 原因(给前端 banner 显式提示)
      //   - 'explicit_mock'        - providerId 本就是 mock-*(dev 占位,正常)
      //   - 'no_provider_config'   - ProviderConfig 不存在(admin 没添加)
      //   - 'provider_inactive'    - 找到了但 isActive=false(admin 没启用)
      //   - 'adapter_route_failed' - config OK 但 adapter 路由没命中(token / 适配器 missing)
      let fallbackReason: string | null = null;
      if (isMock) {
        if (providerId.toLowerCase().startsWith('mock-') || providerId.toLowerCase() === 'mock') {
          fallbackReason = 'explicit_mock';
        } else if (!config) {
          fallbackReason = 'no_provider_config';
        } else if (!config.isActive) {
          fallbackReason = 'provider_inactive';
        } else {
          fallbackReason = 'adapter_route_failed';
        }
      }

      // M2′ 配音产品化:生成前费用预估(基础单价/s + 有声差价/s + 系统默认开关)
      // estimateCost 线性按秒,取 1s 即每秒单价;UI 算 (base + audio?surcharge:0) × durationS
      const estimatedCnyPerS = provider.estimateCost({
        prompt: '',
        durationS: 1,
        aspectRatio: '9:16',
      });

      return {
        providerId,
        displayName: config?.displayName ?? provider.info.displayName ?? providerId,
        maxDurationS,
        minDurationS,
        supportedAspectRatios,
        // W5.5.1 扩展能力
        supportedResolutions,
        defaultResolution,
        supportsAudio,
        supportsWatermark,
        supportsWebSearch,
        supportsRefImage,
        supportsRefVideo,
        supportsRefAudio,
        isActive: config?.isActive ?? true,
        isMock,
        fallbackReason,
        // M2′ 费用预估 + 有声默认值
        estimatedCnyPerS,
        audioSurchargeCnyPerS: bindings.audioSurchargeCnyPerS,
        defaultGenerateAudio: bindings.defaultGenerateAudio,
      };
    }),

  /**
   * 列出某 group 的视频生成历史(W5.4)— 含成功 / 失败 / 进行中,按 createdAt 倒序
   * W1-W5 audit 三轮 A1:allowArchived:true 让归档的 group 也能查历史(配合 archiveGroup "保留审计")
   */
  listVideoTakes: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId, {
        skipLockCheck: true,
        allowArchived: true,
      });
      // M3c:QC 配置态(开关 + 判官 binding 都有才算启用)— qcPending 轮询判定用
      const qcSettings = await loadSystemSettings(ctx.prisma, [
        TAKE_QC_ENABLED_KEY,
        QC_JUDGE_BINDING_KEY,
      ]);
      const qcConfigured =
        qcSettings[TAKE_QC_ENABLED_KEY] === 'true' &&
        !!qcSettings[QC_JUDGE_BINDING_KEY]?.trim();
      const attempts = await ctx.prisma.generationAttempt.findMany({
        where: {
          shotGroupId: grp.id,
          action: 'VIDEO',
        },
        orderBy: { createdAt: 'desc' },
        // Phase 1.5 P0-1:ledger 关系从 1:1 改 1:N(costEntries[]),原 include 没被使用,删
      });
      // 一次性查所有 outputMediaId 对应的 MediaItem
      const mediaIds = attempts
        .map((a) => a.outputMediaId)
        .filter((id): id is string => !!id);
      const medias =
        mediaIds.length > 0
          ? await ctx.prisma.mediaItem.findMany({
              where: { id: { in: mediaIds } },
              select: {
                id: true,
                cdnUrl: true,
                storageKey: true,
                aspectRatio: true,
                meta: true,
              },
            })
          : [];
      const mediaMap = new Map(medias.map((m) => [m.id, m]));

      // 六八:已缓存的播放走本地签名 URL(MinIO,顺滑),未缓存暂用 provider 直链(可能卡/会过期)
      const storage = getStorageAdapter();
      const results = [];
      for (const a of attempts) {
        const media = a.outputMediaId ? mediaMap.get(a.outputMediaId) ?? null : null;
        const cached =
          !!media &&
          !media.storageKey.startsWith('external://') &&
          !media.storageKey.startsWith('placeholder://');
        let videoUrl: string | null = media?.cdnUrl ?? null;
        if (media && cached) {
          try {
            videoUrl = await storage.getSignedUrl(media.storageKey, 6 * 3600);
          } catch {
            /* 签名失败回退直链 */
          }
        }
        // M3c:QC 字段(qcJson 形状由 core/qc 写入,这里防御性窄化)
        const qc = readQcJson(a.qcJson);
        results.push({
          id: a.id,
          status: a.status,
          providerId: a.providerId,
          createdAt: a.createdAt,
          durationMs: a.durationMs,
          costCny: a.costCny,
          errorMsg: a.errorMsg,
          videoUrl,
          // 六八:缓存状态(UI 缓存完毕/缓存中标识 + 轮询依据)
          cached,
          aspectRatio: media?.aspectRatio ?? null,
          mediaId: media?.id ?? null,
          rejected: a.rejected,
          // M3c QC:分数/漂移/点评/失败原因 + pending(轮询依据,时间窗防旧 take 永轮询)
          qcScore: a.qcScore,
          qcDrift: qc.drift,
          qcNotes: qc.notes,
          qcError: qc.error,
          // 深审修(P1):时间窗锚点用 finishedAt(成功时刻,QC 真正起算点)— 原 createdAt
          // 在批量排队 >15min 时窗口提前耗尽,评分中却不显示"QC…"也不轮询
          qcPending:
            qcConfigured &&
            a.status === 'SUCCESS' &&
            !a.rejected &&
            a.qcScore === null &&
            !qc.error &&
            (a.finishedAt ?? a.createdAt).getTime() > Date.now() - QC_PENDING_WINDOW_MS,
        });
      }
      return results;
    }),

  /**
   * 标记一次视频抽卡为废片(rejected)— 只标 attempt,不删 MediaItem(保留可复用)
   */
  rejectVideoTake: protectedProcedure
    .input(z.object({ attemptId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const attempt = await ctx.prisma.generationAttempt.findFirst({
        where: { id: input.attemptId, action: 'VIDEO' },
        include: { shotGroup: { include: { episode: true } } },
      });
      if (!attempt || !attempt.shotGroup) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'video attempt 不存在' });
      }
      await assertProjectAccess(ctx, attempt.shotGroup.episode.projectId);
      // W1-W5 audit 三轮 L1:导演 GENERATING 时拒
      if (isEpisodeLockedNow(attempt.shotGroup.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜中,请等导演侧完成后再操作 AIGC 工作台',
        });
      }
      // W1-W5 audit 三轮 P2-15:幂等(已 rejected 不重复写审计)
      if (attempt.rejected) {
        return { id: attempt.id, alreadyRejected: true };
      }
      const updated = await ctx.prisma.generationAttempt.update({
        where: { id: attempt.id },
        data: {
          rejected: true,
          rejectedAt: new Date(),
          rejectedBy: ctx.user.id,
        },
      });
      await logOperation(ctx, 'aigc.rejectVideoTake', 'generationAttempt', attempt.id, attempt, {
        ...updated,
        projectId: attempt.shotGroup.episode.projectId,
      });
      // 2026-05-27 audit r14 P0:返 shotGroupId 给前端 onSuccess 定向 invalidate({groupId})
      // 防多 group 同页堆叠时跨 group cache 污染
      return {
        id: updated.id,
        alreadyRejected: false,
        shotGroupId: attempt.shotGroupId,
      };
    }),
};
