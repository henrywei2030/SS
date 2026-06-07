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
// 三十五收工 R2 Phase A + 三十六收工 R2 完整推进:共享 video generation helper
import {
  acquireAigcVideoLock,
  refundPrepayForAttempt,
  STALE_TIMEOUT_GROUP_MS,
  checkDailyVideoBudget,
  createPlaceholderAttemptWithPrepay,
  compileVideoPromptForGroup,
  enqueueVideoJobOrRefund,
} from '@ss/core/video-generation';

// 三十一收工 S3:SystemSetting 单 key 读 helper
// 三十二收工 S3 followup:加 batch 版
import { loadSystemSetting, loadSystemSettings } from '../utils/system-bindings.js';
// r11 audit:错误消息脱敏(防 Provider URL/token/stack 泄漏到前端)
import { sanitizeErrorMsg } from '@ss/shared';
import { ASPECT_RATIOS, type AspectRatio } from '@ss/shared/constants';
import { aspectRatioSchema } from '@ss/shared/schemas';
import { addVideoGenJob } from '@ss/queue/video-gen';
import { signStreamToken } from '@ss/queue/sse-token';

import { protectedProcedure, rateLimit } from '../trpc.js';
import type { Context } from '../context.js';
import { logOperation } from '../middleware/audit.js';
import { isEpisodeLockedNow } from '../utils/episode-lock.js';
import { assertProjectAccess } from '../middleware/access.js';
import {
  sanitizePromptForLedger,
  sanitizeReferencesForLedger,
} from '../utils/sanitize-prompt.js';

import { loadGroupOrThrow } from './aigc-shared.js';

// W5.4:视频生成相关 SystemSetting 读取
// W1-W5 audit P1 followup(P1-5):加 requireForVideo 守卫(原 setting dead,从未被读)
async function getVideoBindings(ctx: Context): Promise<{
  providerId: string;
  maxDurationS: number;
  defaultAspectRatio: AspectRatio;
  dailyBudgetCny: number;
  requireComplianceForVideo: boolean;
}> {
  // 三十二收工 S3 followup:helper batch
  const settings = await loadSystemSettings(ctx.prisma, [
    'binding.shot.video.providerId',
    'shot.video.maxDurationS',
    'shot.video.defaultAspectRatio',
    'shot.video.dailyBudgetCny',
    'asset.compliance.requireForVideo',
  ]);
  const rawAr = settings['shot.video.defaultAspectRatio'] ?? '9:16';
  // 2026-05-27:扩到 6 比例后用 ASPECT_RATIOS 真相源校验,白名单外的默认 9:16
  const ar: AspectRatio = (ASPECT_RATIOS as readonly string[]).includes(rawAr)
    ? (rawAr as AspectRatio)
    : '9:16';
  // 2026-05-27 audit r12:Number() 非法值返 NaN 会污染下游 Math.min / Decimal 计算
  // SystemSetting 老值 / admin 误填 null/字符串时,fallback 到合理默认而非 NaN
  const parseNum = (raw: string | undefined, fallback: number): number => {
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    // 二十收工后用户反馈:不 hardcode 默认 provider,空时调用方判断(generateVideo 有 input.providerOverride 优先)
    providerId: settings['binding.shot.video.providerId'] ?? '',
    maxDurationS: parseNum(settings['shot.video.maxDurationS'], 15),
    defaultAspectRatio: ar,
    dailyBudgetCny: parseNum(settings['shot.video.dailyBudgetCny'], 500),
    requireComplianceForVideo:
      (settings['asset.compliance.requireForVideo'] ?? 'false') === 'true',
  };
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
      const durationS = Math.min(
        input.durationS ?? grp.durationS ?? 5,
        bindings.maxDurationS,
      );

      // Phase 1.5 P0-1:提前 fetch provider + 算 prepayEstimate(transaction 前算好)
      // 预扣 = max_duration × unitPriceCny(按当前 cfg 估算,真实抽卡完成时 worker 写 REFUND 退多扣)
      const provider = await getVideoProvider(providerId);
      const prepayEstimateCny = provider.estimateCost({
        prompt: '',
        durationS,
        aspectRatio,
      });

      // W1-W5 audit 三轮 G1 + 7 轮 audit P0(A1):advisory lock 必须在 $transaction 内,
      // 否则 pg_advisory_xact_lock 在 implicit transaction(单条 raw)立即释放,串行失效。
      //
      // 模式:transaction 内 锁 + inflight check + 占位 attempt(status=QUEUED)+ PREPAY entry。
      // 锁释放后占位 attempt 仍在 DB,其他并发 inflight check 会看到 QUEUED → 拒。
      // 后续检查(gachaMax/budget/compile)失败时 update 占位为 FAILED + 写 REFUND 退还 PREPAY;通过则 worker 接管。
      const { attempt: earlyAttempt } = await ctx.prisma.$transaction(async (tx) => {
        // 三十五收工 R2 Phase A:共享 helper(原 inline lock raw → acquireAigcVideoLock)
        await acquireAigcVideoLock(tx, grp.id);
        // 2026-05-27 audit r13 P0(用户反馈):stale RUNNING 自愈
        //   worker 进程崩 / network drop / 真接 Provider 异步 task 失踪时,attempt 永久卡在 RUNNING
        //   → inflight check 永久 block 同 group 新建 → 用户必须等管理员手动清理
        //   解法:findFirst 拿全部 inflight + 把 startedAt > 10min 视为 stale,事务内标 FAILED + 退 PREPAY
        const inflightCandidates = await tx.generationAttempt.findMany({
          where: {
            shotGroupId: grp.id,
            action: 'VIDEO',
            status: { in: ['QUEUED', 'RUNNING'] },
          },
          select: { id: true, providerId: true, startedAt: true, createdAt: true },
        });
        const now = Date.now();
        const staleAttempts = inflightCandidates.filter((a) => {
          const ts = (a.startedAt ?? a.createdAt)?.getTime() ?? now;
          return now - ts > STALE_TIMEOUT_GROUP_MS;
        });
        for (const stale of staleAttempts) {
          // 标 FAILED + 退 PREPAY(idempotent — refundPrepayForAttempt 内查 REFUND 防双写)
          await tx.generationAttempt.update({
            where: { id: stale.id },
            data: {
              status: 'FAILED',
              errorMsg: `stale RUNNING auto-recovered (>${STALE_TIMEOUT_GROUP_MS / 60000}min, worker likely crashed)`,
              finishedAt: new Date(),
            },
          });
          // 三十五收工 R2 Phase A:用共享 refund helper 替原 ~30 行内联逻辑
          await refundPrepayForAttempt(tx, {
            attemptId: stale.id,
            userId: ctx.user.id,
            projectId: grp.episode.projectId,
            episodeId: grp.episodeId,
            providerId: stale.providerId,
            reason: 'stale_running_auto_recovered',
          });
        }
        // 自愈后仍存活的 inflight(startedAt 在 10min 内)— 真在跑,拒绝
        const aliveInflight = inflightCandidates.find(
          (a) => !staleAttempts.some((s) => s.id === a.id),
        );
        if (aliveInflight) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `本生成段已有进行中的视频任务(provider=${aliveInflight.providerId})— 等完成或失败后再点`,
          });
        }
        // 三十六收工 R2:placeholder attempt + PREPAY ledger 抽到 createPlaceholderAttemptWithPrepay
        return createPlaceholderAttemptWithPrepay(tx, {
          userId: ctx.user.id,
          projectId: grp.episode.projectId,
          episodeId: grp.episodeId,
          shotGroupId: grp.id,
          providerId,
          durationS,
          prepayEstimateCny,
        });
      });

      // 7 轮 audit A1:任何前置 check 失败都要把占位 attempt 标 FAILED 释放
      // Phase 1.5 P0-1:**同时**写 REFUND 退还 PREPAY(否则用户被多扣)
      const failPlaceholder = async (err: Error, code: 'TOO_MANY_REQUESTS' | 'PRECONDITION_FAILED' | 'BAD_REQUEST') => {
        await ctx.prisma.$transaction(async (tx) => {
          await tx.generationAttempt.updateMany({
            where: { id: earlyAttempt.id, status: 'QUEUED' },
            data: {
              status: 'FAILED',
              errorMsg: err.message,
              finishedAt: new Date(),
            },
          });
          // 四十收工 P2:用共享 refundPrepayForAttempt(查 PREPAY + idempotent 防双退),
          //   收敛退费单一真相源(跟 stale-sweep / enqueue-fail 一致),消除未来重构引入双退风险。
          await refundPrepayForAttempt(tx, {
            attemptId: earlyAttempt.id,
            userId: ctx.user.id,
            projectId: grp.episode.projectId,
            episodeId: grp.episodeId,
            providerId,
            reason: 'video_task_precheck_failed',
          });
        });
        // r11 audit:err.message 可能含 Provider URL / token / stack trace,
        //   走 sanitizeErrorMsg 脱敏(已 import 自 @ss/shared L20)防泄漏
        throw new TRPCError({ code, message: sanitizeErrorMsg(err) });
      };

      // W1-W5 audit P2 followup(P2-5):接通 system.gacha.max_attempts(原 dead config)
      // 单 group 累计非 rejected attempt 数(含成功/失败)超 max_attempts 时拒,防失控烧钱
      const gachaMax = Number(
        (await loadSystemSetting(ctx.prisma, 'system.gacha.max_attempts')) ?? '0',
      );
      if (gachaMax > 0) {
        const used = await ctx.prisma.generationAttempt.count({
          where: {
            shotGroupId: grp.id,
            action: 'VIDEO',
            rejected: false,
            status: { in: ['SUCCESS', 'FAILED'] },
          },
        });
        if (used >= gachaMax) {
          await failPlaceholder(
            new Error(`本生成段已抽 ${used} 次(上限 ${gachaMax}),把废片标 rejected 或在后台调高 system.gacha.max_attempts 再试`),
            'TOO_MANY_REQUESTS',
          );
        }
      }

      // Phase 1.5 P0-1:provider 实例 + prepayEstimateCny 已在 transaction 前 fetch,此处直接复用
      // (estimateCost 也已用,不再二次调用)

      // 三十六收工 R2:每日预算守卫抽到 checkDailyVideoBudget(Decimal 比较防 IEEE-754 漂移)
      const budgetDenyMsg = await checkDailyVideoBudget(ctx.prisma, {
        projectId: grp.episode.projectId,
        dailyBudgetCny: bindings.dailyBudgetCny,
        prepayEstimateCny,
        excludeAttemptId: earlyAttempt.id,
      });
      if (budgetDenyMsg) {
        await failPlaceholder(new Error(budgetDenyMsg), 'TOO_MANY_REQUESTS');
      }

      // 三十六收工 R2:compile 整段(project + dbBindings + media + refs + compileShotGroupVideoPrompt)
      // 抽到 compileVideoPromptForGroup helper(132 行 → 1 调用),compliance check 保留 router 内(需要 failPlaceholder)
      const { compiled, characterBindingsForCompliance } = await compileVideoPromptForGroup(
        ctx.prisma,
        {
          group: {
            id: grp.id,
            prompt: grp.prompt,
            durationS: grp.durationS,
            episode: { projectId: grp.episode.projectId },
          },
          providerId,
          durationS,
          aspectRatio,
          extraInstruction: input.extraInstruction,
          extraNegative: input.extraNegative,
        },
      );

      // W1-W5 audit P1 followup(P1-5):合规守卫 — 引用了任何 CHARACTER 且 complianceStatus !== APPROVED 则拒
      if (bindings.requireComplianceForVideo) {
        const blockedChars = characterBindingsForCompliance.filter(
          (c) => c.complianceStatus !== 'APPROVED',
        );
        if (blockedChars.length > 0) {
          await failPlaceholder(
            new Error(
              `合规未通过的人物不允许生成视频:${blockedChars
                .map((c) => `${c.assetName}(${c.complianceStatus})`)
                .join(', ')} — 在美术工作台完成合规后再试`,
            ),
            'PRECONDITION_FAILED',
          );
        }
      }

      // 2. 提示词缺图 / 未关联 token 阻断 — 让用户先修
      if (compiled.warnings.missingMedia.length > 0) {
        await failPlaceholder(
          new Error(
            `${compiled.warnings.missingMedia
              .map((m) => `${m.assetName} 缺主图`)
              .join(' / ')} — 去美术工作台补图后再试`,
          ),
          'BAD_REQUEST',
        );
      }
      if (compiled.warnings.unknownTokens.length > 0) {
        await failPlaceholder(
          new Error(
            `提示词里用了未关联的 token:${compiled.warnings.unknownTokens.join(', ')} — 先关联或删除 token`,
          ),
          'BAD_REQUEST',
        );
      }
      if (!grp.prompt.trim()) {
        await failPlaceholder(
          new Error('提示词为空 — 去导演工作台生成或手编'),
          'BAD_REQUEST',
        );
      }

      // 全盘审查 #2:Provider 能力(caps)查询 + refVideoUrl 校验必须在「升级 RUNNING」之前!
      //   failPlaceholder 的 updateMany 只匹配 status:'QUEUED';若该校验在 RUNNING 之后失败,
      //   updateMany 命中 0 行 → 占位 attempt 卡死 RUNNING、阻塞该 group 抽卡直到 stale-sweep(10min)。
      //   caps/refVideoUrl 只依赖 input + providerId,与 attempt 状态无关,故提前到升 RUNNING 前。
      // 2026-05-27 audit r14 P0:删 `.catch(() => null)` — 吞 DB 异常会致 capsParams={} → 校验失效;
      //   真异常应往上抛,trpc 返 INTERNAL_SERVER_ERROR。
      const caps = await ctx.prisma.providerConfig.findUnique({
        where: { providerId },
        select: { defaultParams: true },
      });
      const capsParams =
        caps?.defaultParams && typeof caps.defaultParams === 'object'
          ? (caps.defaultParams as Record<string, unknown>)
          : {};
      if (input.refVideoUrl && capsParams.supportsRefVideo !== true) {
        await failPlaceholder(
          new Error(`当前 Provider 不支持 refVideo(请去 admin/providers 配 supportsRefVideo:true)`),
          'BAD_REQUEST',
        );
      }

      // 3. 升级占位 attempt 到 RUNNING + 真实 inputJson(7 轮 audit A1)
      // 注:projectId/episodeId/shotGroupId/providerId/modelId/action 在占位时已写,不重复 set
      const startedAt = new Date();
      const attempt = await ctx.prisma.generationAttempt.update({
        where: { id: earlyAttempt.id },
        data: {
          // W7 audit R8 P0:inputJson 脱敏 — 不存明文 prompt + 不存资产 name/mediaUrl
          // 保留 preview/hash/length 便于追溯;references 只留 idx+kind+assetId
          inputJson: {
            kind: 'aigc.generateVideo',
            groupNumber: grp.number,
            positivePrompt: sanitizePromptForLedger(compiled.positive),
            negativePrompt: sanitizePromptForLedger(compiled.negative),
            aspectRatio,
            durationS,
            references: sanitizeReferencesForLedger(compiled.references),
          },
          status: 'RUNNING',
          startedAt,
          createdBy: ctx.user.id,
        },
      });

      // 4. 入队 BullMQ video-gen worker(ADR-25 W5.5)
      //    handler 立即返回 attemptId,worker 收到 job 后:
      //      - 调 provider.generate(ctx.skipLedger=true)
      //      - 写 MediaItem + 升 attempt SUCCESS|FAILED + costLedgerEntry
      //      - publish EVENTS.GENERATION_COMPLETED + Redis 'success'/'failed' 推 SSE
      //    失败分类(白名单):timeout/429/5xx → retry;censored/compliance → UnrecoverableError
      const refImageUrls = compiled.references
        .filter((r) => r.kind === 'IMAGE')
        .map((r) => r.mediaUrl)
        .filter((u): u is string => !!u);
      // 2026-05-27 audit r13:binding 含 AUDIO 类资产(角色配音 voiceMediaId)时收集
      // capsParams.supportsRefAudio !== true 时静默丢弃(Provider 不支持就别传,避 422)
      const rawRefAudioUrls = compiled.references
        .filter((r) => r.kind === 'AUDIO')
        .map((r) => r.mediaUrl)
        .filter((u): u is string => !!u);
      // 2026-05-27 audit r14 P1:audio 处理统一(input.refAudioUrl + binding 来的 audio 都 silent drop)
      // 之前 input.refAudioUrl 不支持时直接 failPlaceholder 拒,但 binding 来的 audio silent drop —
      // 用户体感不一致(同样不支持,一种拒一种丢)。统一改 silent drop + 日志,不阻断生成
      const allAudioUrls =
        capsParams.supportsRefAudio === true
          ? [
              ...rawRefAudioUrls,
              ...(input.refAudioUrl ? [input.refAudioUrl] : []),
            ]
          : [];
      const droppedAudio =
        (capsParams.supportsRefAudio === true ? 0 : rawRefAudioUrls.length) +
        (capsParams.supportsRefAudio !== true && input.refAudioUrl ? 1 : 0);
      if (droppedAudio > 0) {
        console.warn(
          `[generateVideo] provider ${providerId} 不支持 refAudio,丢弃 ${droppedAudio} 个音频 URL`,
        );
      }
      // 五七-3:去重(角色形象绑定自动带的 voiceMediaId 可能与显式 SOUND_VOICE 绑定重复)
      const refAudioUrls = Array.from(new Set(allAudioUrls));

      // 三十六收工 R2:入队 + 失败时回滚 attempt + REFUND 抽到 enqueueVideoJobOrRefund helper
      // (同 failPlaceholder/refundPrepayForAttempt 单一真相源,enqueue 失败统一走 helper)
      try {
        await enqueueVideoJobOrRefund(ctx.prisma, {
          attemptId: attempt.id,
          startedAt,
          userId: ctx.user.id,
          projectId: grp.episode.projectId,
          episodeId: grp.episodeId,
          providerId,
          payload: {
            attemptId: attempt.id,
            projectId: grp.episode.projectId,
            episodeId: grp.episodeId,
            shotGroupId: grp.id,
            userId: ctx.user.id,
            providerId,
            modelId: providerId,
            prompt: compiled.positive,
            durationS,
            aspectRatio,
            refImageUrls: refImageUrls.length > 0 ? refImageUrls : undefined,
            refAudioUrls: refAudioUrls.length > 0 ? refAudioUrls : undefined,
            // W5.5.1 扩展参数透传(Provider 自己消费 extra)
            resolution: input.resolution,
            generateAudio: input.generateAudio,
            addWatermark: input.addWatermark,
            webSearchEnabled: input.webSearchEnabled,
            refVideoUrl: input.refVideoUrl,
            refAudioUrl: input.refAudioUrl,
            groupNumber: grp.number,
            // 第 19 轮 audit P1:requestId 贯通到 worker,运维 grep 日志可看全链路
            requestId: ctx.requestId,
          },
          enqueue: (p) => addVideoGenJob(p),
        });
      } catch (enqueueErr) {
        const errMsg = enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `视频任务入队失败,请稍后重试:${errMsg}`,
          cause: enqueueErr,
        });
      }

      await logOperation(ctx, 'aigc.generateVideo.enqueued', 'shotGroup', grp.id, null, {
        attemptId: attempt.id,
        providerId,
        aspectRatio,
        durationS,
        projectId: grp.episode.projectId,
      });

      return {
        attemptId: attempt.id,
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
                aspectRatio: true,
                meta: true,
              },
            })
          : [];
      const mediaMap = new Map(medias.map((m) => [m.id, m]));

      return attempts.map((a) => {
        const media = a.outputMediaId ? mediaMap.get(a.outputMediaId) ?? null : null;
        return {
          id: a.id,
          status: a.status,
          providerId: a.providerId,
          createdAt: a.createdAt,
          durationMs: a.durationMs,
          costCny: a.costCny,
          errorMsg: a.errorMsg,
          videoUrl: media?.cdnUrl ?? null,
          aspectRatio: media?.aspectRatio ?? null,
          mediaId: media?.id ?? null,
          rejected: a.rejected,
        };
      });
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
