/**
 * submitVideoGeneration — generateVideo 主体下沉(M4 先决重构,蓝图 docs/06 §M4)。
 *
 * 从 aigc-video.ts generateVideo mutation 搬运(行为零变化):锁 → stale sweep →
 * 占位 attempt + PREPAY → 抽卡上限/预算/编译/合规/能力门 → 升 RUNNING → 入队
 * (失败回滚 + REFUND)。F4 batchGenerateForEpisode 复用此单一真相源逐组提交。
 *
 * 分层纪律(同 stale-sweep):core 返**判别结果**,不抛 TRPCError —
 *   - ok:true  → attemptId(worker 接管)
 *   - ok:false → code + 已脱敏 message,router 映射 TRPCError;
 *     占位 attempt 已标 FAILED + REFUND 退净(deny 前全部清理完毕)
 * 前置阶段(provider 不存在等)的 throw 原样冒泡 — 彼时尚无占位/预扣,无悬挂资金。
 *
 * 调用方约定:providerId/durationS/aspectRatio/wantAudio 已解析完毕(binding 读取与
 * fallback 留在 api 层 getVideoBindings),group 已过访问/锁检查(loadGroupOrThrow)。
 */
import { randomUUID } from 'node:crypto';

import { getVideoProvider } from '@ss/adapters/provider';
import type { PrismaClient } from '@ss/db';
import { enqueueVideoGenJob } from '@ss/queue/video-gen';
import type { VideoGenJobData } from '@ss/queue/types';
import { sanitizeErrorMsg } from '@ss/shared';
import type { AspectRatio } from '@ss/shared/constants';

import { resolveMediaFetchUrl } from '../media/index.js';

import { acquireAigcVideoLock } from './lock.js';
import { isBatchGroupId } from './batch.js';
import { maybeNotifyBatchDone } from './batch-notify.js';
import { checkDailyVideoBudget } from './budget-check.js';
import { compileVideoPromptForGroup } from './compile.js';
import { createPlaceholderAttemptWithPrepay } from './prepay.js';
import { enqueueVideoJobOrRefund } from './enqueue.js';
import { refundPrepayForAttempt } from './refund.js';
import {
  sanitizePromptForLedger,
  sanitizeReferencesForLedger,
} from './sanitize-prompt.js';
import { sweepStaleGroupAttempts } from './stale-sweep.js';

/** 调用方已 loadGroupOrThrow 校验过访问权/集锁的 group 快照 */
export interface SubmitVideoGroup {
  id: string;
  number: string;
  prompt: string;
  durationS: number;
  episodeId: string;
  projectId: string;
}

export interface SubmitVideoArgs {
  group: SubmitVideoGroup;
  userId: string;
  /** 已解析(override ?? binding,非空由调用方保证) */
  providerId: string;
  /** 已按 binding.maxDurationS clamp 的整数秒 */
  durationS: number;
  aspectRatio: AspectRatio;
  /** input.generateAudio ?? binding 默认 */
  wantAudio: boolean;
  // ---- binding 业务参数(api 层 getVideoBindings 读出后传入) ----
  dailyBudgetCny: number;
  // ---- 用户可选参数(原 input 透传) ----
  extraInstruction?: string;
  extraNegative?: string[];
  resolution?: '480p' | '720p' | '1080p';
  addWatermark?: boolean;
  webSearchEnabled?: boolean;
  refVideoUrl?: string;
  refAudioUrl?: string;
  /** 第 19 轮 audit P1:贯通到 worker 日志 */
  requestId?: string;
  /** F4 批量:同批次共享标签(写 GenerationAttempt.groupId)— 单点生成不传 */
  attemptGroupId?: string;
  /** F5b(七二)并抽对决:第二家 provider(≤2 家,与 providerId 不同;同事务双占位双 PREPAY,
   * 共享 duel_ 标签)。B 路任何 provider 级失败只降级(退 B 保 A),组级 deny 仍双退。
   * 与批量互斥(attemptGroupId 已是 batch_ 时调用方不传本参数)。 */
  duelProviderId?: string;
}

export type SubmitVideoDenyCode =
  | 'CONFLICT'
  | 'TOO_MANY_REQUESTS'
  | 'PRECONDITION_FAILED'
  | 'BAD_REQUEST'
  | 'ENQUEUE_FAILED';

export type SubmitVideoResult =
  | {
      ok: true;
      attemptId: string;
      /** F5b 并抽:B 路 attempt(成功入队时);degraded 时为 undefined */
      duelAttemptId?: string;
      /** F5b 并抽:B 路被降级(退 B 保 A)的原因 — UI toast 提示 */
      duelDegraded?: string;
    }
  | {
      ok: false;
      code: SubmitVideoDenyCode;
      message: string;
      cause?: unknown;
      /** F4 批量:机器可判的拒因细分 — BUDGET_EXCEEDED 时批量循环提前止损(后续组必然同拒) */
      denyReason?: 'BUDGET_EXCEEDED' | 'GACHA_LIMIT';
    };

/** 事务内发现存活 inflight 时抛出 — 让 sweep 写入随事务回滚(与原 TRPCError 中断语义一致) */
class InflightConflictError extends Error {
  constructor(readonly providerId: string) {
    super('inflight conflict');
  }
}

export async function submitVideoGeneration(
  prisma: PrismaClient,
  args: SubmitVideoArgs,
): Promise<SubmitVideoResult> {
  const { group: grp, userId, providerId, durationS, aspectRatio, wantAudio } = args;

  // Phase 1.5 P0-1:提前 fetch provider + 算 prepayEstimate(transaction 前算好)
  // 预扣 = max_duration × unitPriceCny(按当前 cfg 估算,真实抽卡完成时 worker 写 REFUND 退多扣)
  // ⚠️ 六七深审 P1:有声差价**不进 PREPAY** — provider 返回的 costCny 不含它,若进预扣会被退款
  //   逻辑(refund = prepaid - actual)当作"多扣"退还 → 差价收不到 + 破坏「PREPAY=provider 估算」
  //   不变量。audioSurcharge 仅用于 capabilities 返回前端做「有声更贵」预估提示,真实计费以 provider 为准。
  const provider = await getVideoProvider(providerId);
  const prepayEstimateCny = provider.estimateCost({
    prompt: '',
    durationS,
    aspectRatio,
  });
  // F5b(七二)并抽:B 路 provider 与预扣额(同 A 公式;无 duel 时全程 null 零影响)
  const duelProviderId = args.duelProviderId?.trim() || null;
  const duelPrepayEstimateCny = duelProviderId
    ? (await getVideoProvider(duelProviderId)).estimateCost({ prompt: '', durationS, aspectRatio })
    : 0;
  // 对决标签:UI/QC 按它配对两条 take(批量已带 batch_ 标签时调用方不会传 duel)
  const duelTag = duelProviderId
    ? (args.attemptGroupId ?? `duel_${randomUUID()}`)
    : args.attemptGroupId;

  // W1-W5 audit 三轮 G1 + 7 轮 audit P0(A1):advisory lock 必须在 $transaction 内,
  // 否则 pg_advisory_xact_lock 在 implicit transaction(单条 raw)立即释放,串行失效。
  //
  // 模式:transaction 内 锁 + inflight check + 占位 attempt(status=QUEUED)+ PREPAY entry。
  // 锁释放后占位 attempt 仍在 DB,其他并发 inflight check 会看到 QUEUED → 拒。
  // 后续检查(gachaMax/budget/compile)失败时 update 占位为 FAILED + 写 REFUND 退还 PREPAY;通过则 worker 接管。
  let earlyAttempt: { id: string };
  // F5b:B 路占位(无 duel 时 null,后续全部分支零影响)
  let duelAttempt: { id: string } | null = null;
  // 七二:sweep 清掉的批量标签 attempt — 事务提交后补批次完成判定(通知漏发 P2 修)
  let sweptBatchAttempts: Array<{ batchLabel: string; createdBy: string }> = [];
  try {
    const created = await prisma.$transaction(async (tx) => {
      // 三十五收工 R2 Phase A:共享 helper(原 inline lock raw → acquireAigcVideoLock)
      await acquireAigcVideoLock(tx, grp.id);
      // 2026-05-27 audit r13 P0:stale RUNNING 自愈 — worker 崩/失踪导致永久卡 RUNNING →
      //   自动标 FAILED + 退 PREPAY;清理后仍存活的才拒(真在跑)
      const { aliveInflight, sweptAttempts } = await sweepStaleGroupAttempts(tx, {
        shotGroupId: grp.id,
        userId,
        projectId: grp.projectId,
        episodeId: grp.episodeId,
      });
      sweptBatchAttempts = sweptAttempts.flatMap((s) =>
        isBatchGroupId(s.batchLabel) ? [{ batchLabel: s.batchLabel, createdBy: s.createdBy }] : [],
      );
      if (aliveInflight) {
        // throw 让事务回滚(语义同原 router 内抛 TRPCError),外层 catch 转判别结果
        throw new InflightConflictError(aliveInflight.providerId);
      }
      // 三十六收工 R2:placeholder attempt + PREPAY ledger 抽到 createPlaceholderAttemptWithPrepay
      const primary = await createPlaceholderAttemptWithPrepay(tx, {
        userId,
        projectId: grp.projectId,
        episodeId: grp.episodeId,
        shotGroupId: grp.id,
        providerId,
        durationS,
        prepayEstimateCny,
        // F4 批量:批次标签下穿(单点生成 undefined);F5b 对决时双方共享 duel_ 标签
        attemptGroupId: duelTag,
      });
      // F5b(七二)并抽:同事务第二占位 + 第二 PREPAY — 原子性保证「要么两占位都在,要么都不在」,
      //   不会出现付了 B 没占 B 的半态。后续组级 deny 双退,B 路 provider 级失败单退 B。
      const duel = duelProviderId
        ? await createPlaceholderAttemptWithPrepay(tx, {
            userId,
            projectId: grp.projectId,
            episodeId: grp.episodeId,
            shotGroupId: grp.id,
            providerId: duelProviderId,
            durationS,
            prepayEstimateCny: duelPrepayEstimateCny,
            attemptGroupId: duelTag,
          })
        : null;
      return { primary, duel };
    });
    earlyAttempt = created.primary.attempt;
    duelAttempt = created.duel?.attempt ?? null;
  } catch (e) {
    if (e instanceof InflightConflictError) {
      return {
        ok: false,
        code: 'CONFLICT',
        message: `本生成段已有进行中的视频任务(provider=${e.providerId})— 等完成或失败后再点`,
      };
    }
    throw e;
  }
  // 七二 P2 修:sweep 在上面事务里把批量 attempt 标了 FAILED(已提交)— 若那是批次最后
  // 一个 inflight,worker 终态路径永远不会跑,这里补完成判定(幂等,失败不影响主流程)。
  // 注意放在 InflightConflictError 之外:conflict 时事务回滚,sweep 未生效,不应补判。
  for (const swept of sweptBatchAttempts) {
    try {
      await maybeNotifyBatchDone(prisma, {
        batchId: swept.batchLabel,
        userId: swept.createdBy,
        projectId: grp.projectId,
        episodeId: grp.episodeId,
        ...(args.requestId ? { requestId: args.requestId } : {}),
      });
    } catch (e) {
      console.warn(
        `[submit] sweep 后批次完成判定失败(增强项,忽略)batch=${swept.batchLabel}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  // 7 轮 audit A1:任何前置 check 失败都要把占位 attempt 标 FAILED 释放
  // Phase 1.5 P0-1:**同时**写 REFUND 退还 PREPAY(否则用户被多扣)
  // 原 failPlaceholder(抛 TRPCError)→ 改返判别 deny,清理语义不变
  const denyPlaceholder = async (
    err: Error,
    code: Exclude<SubmitVideoDenyCode, 'CONFLICT' | 'ENQUEUE_FAILED'>,
    denyReason?: 'BUDGET_EXCEEDED' | 'GACHA_LIMIT',
  ): Promise<SubmitVideoResult> => {
    await prisma.$transaction(async (tx) => {
      // F5b:组级 deny 双退 — A/B 占位一起 FAILED + 各退各的 PREPAY(无 duel 时数组只有 A)
      const legs = [
        { id: earlyAttempt.id, providerId },
        ...(duelAttempt ? [{ id: duelAttempt.id, providerId: duelProviderId! }] : []),
      ];
      for (const leg of legs) {
        await tx.generationAttempt.updateMany({
          where: { id: leg.id, status: 'QUEUED' },
          data: {
            status: 'FAILED',
            errorMsg: err.message,
            finishedAt: new Date(),
          },
        });
        // 四十收工 P2:用共享 refundPrepayForAttempt(查 PREPAY + idempotent 防双退),
        //   收敛退费单一真相源(跟 stale-sweep / enqueue-fail 一致)。
        await refundPrepayForAttempt(tx, {
          attemptId: leg.id,
          userId,
          projectId: grp.projectId,
          episodeId: grp.episodeId,
          providerId: leg.providerId,
          reason: 'video_task_precheck_failed',
        });
      }
    });
    // r11 audit:err.message 可能含 Provider URL / token / stack trace,脱敏防泄漏
    return { ok: false, code, message: sanitizeErrorMsg(err), denyReason };
  };

  // W1-W5 audit P2 followup(P2-5):接通 system.gacha.max_attempts(原 dead config)
  // 单 group 累计非 rejected attempt 数(含成功/失败)超 max_attempts 时拒,防失控烧钱
  const gachaMax = Number(
    (
      await prisma.systemSetting.findUnique({
        where: { key: 'system.gacha.max_attempts' },
        select: { value: true },
      })
    )?.value ?? '0',
  );
  if (gachaMax > 0) {
    const used = await prisma.generationAttempt.count({
      where: {
        shotGroupId: grp.id,
        action: 'VIDEO',
        rejected: false,
        status: { in: ['SUCCESS', 'FAILED'] },
      },
    });
    // F5b:对决一次吃 2 个名额 — used+本次条数 超限即拒(双退)
    const thisBatchCount = duelAttempt ? 2 : 1;
    if (used + thisBatchCount > gachaMax) {
      return denyPlaceholder(
        new Error(
          `本生成段已抽 ${used} 次(上限 ${gachaMax}${duelAttempt ? ',对决需 2 个名额' : ''}),把废片标 rejected 或在后台调高 system.gacha.max_attempts 再试`,
        ),
        'TOO_MANY_REQUESTS',
        'GACHA_LIMIT',
      );
    }
  }

  // 三十六收工 R2:每日预算守卫抽到 checkDailyVideoBudget(Decimal 比较防 IEEE-754 漂移)
  // F5b:对决时预算口径 = A+B 合并预估,且两笔 PREPAY 都从"已花"里排除(否则自重复计)
  const budgetDenyMsg = await checkDailyVideoBudget(prisma, {
    projectId: grp.projectId,
    dailyBudgetCny: args.dailyBudgetCny,
    prepayEstimateCny: prepayEstimateCny + duelPrepayEstimateCny,
    excludeAttemptId: earlyAttempt.id,
    excludeAttemptIds: duelAttempt ? [earlyAttempt.id, duelAttempt.id] : undefined,
  });
  if (budgetDenyMsg) {
    return denyPlaceholder(new Error(budgetDenyMsg), 'TOO_MANY_REQUESTS', 'BUDGET_EXCEEDED');
  }

  // 三十六收工 R2:compile 整段(project + dbBindings + media + refs + compileShotGroupVideoPrompt)
  // 七二(用户指令):合规前置硬门退役 — characterBindingsForCompliance/projectType 仍由
  //   compile 返回(合规改纯标识环节,人物卡绿点/编辑页绿字读 Asset.complianceStatus;
  //   未来要恢复门控或做提示,接口都在),此处不再消费。
  const { compiled, voiceRefs, voiceMissing, characterImageRefs } =
    await compileVideoPromptForGroup(prisma, {
    group: {
      id: grp.id,
      prompt: grp.prompt,
      durationS: grp.durationS,
      episode: { projectId: grp.projectId },
    },
    providerId,
    durationS,
    aspectRatio,
    extraInstruction: args.extraInstruction,
    extraNegative: args.extraNegative,
    // 六八:有声生成时把人物声音设定描述编进 prompt【声线】段
    includeVoiceDescriptions: wantAudio,
  });

  // 七二(用户指令):原「AI_REAL 人物必须 APPROVED 才能生成」合规硬门移除 —
  //   合规审查独立运行(volcengine/手动 setComplianceManually 照旧写 Asset.complianceStatus),
  //   只作 UI 标识(人物卡绿点/编辑页「已通过合规审查」),不再阻断生成。

  // 提示词缺图 / 未关联 token 阻断 — 让用户先修
  if (compiled.warnings.missingMedia.length > 0) {
    return denyPlaceholder(
      new Error(
        `${compiled.warnings.missingMedia
          .map((m) => `${m.assetName} 缺主图`)
          .join(' / ')} — 去美术工作台补图后再试`,
      ),
      'BAD_REQUEST',
    );
  }
  if (compiled.warnings.unknownTokens.length > 0) {
    return denyPlaceholder(
      new Error(
        `提示词里用了未关联的 token:${compiled.warnings.unknownTokens.join(', ')} — 先关联或删除 token`,
      ),
      'BAD_REQUEST',
    );
  }
  if (!grp.prompt.trim()) {
    return denyPlaceholder(new Error('提示词为空 — 去导演工作台生成或手编'), 'BAD_REQUEST');
  }

  // 全盘审查 #2:Provider 能力(caps)查询 + refVideoUrl 校验必须在「升级 RUNNING」之前!
  //   denyPlaceholder 的 updateMany 只匹配 status:'QUEUED';若该校验在 RUNNING 之后失败,
  //   updateMany 命中 0 行 → 占位 attempt 卡死 RUNNING、阻塞该 group 抽卡直到 stale-sweep(10min)。
  //   caps/refVideoUrl 只依赖 input + providerId,与 attempt 状态无关,故提前到升 RUNNING 前。
  // 2026-05-27 audit r14 P0:不 catch DB 异常 — 吞掉会致 capsParams={} → 校验失效;真异常往上抛。
  const caps = await prisma.providerConfig.findUnique({
    where: { providerId },
    select: { defaultParams: true },
  });
  const capsParams =
    caps?.defaultParams && typeof caps.defaultParams === 'object'
      ? (caps.defaultParams as Record<string, unknown>)
      : {};
  if (args.refVideoUrl && capsParams.supportsRefVideo !== true) {
    return denyPlaceholder(
      new Error(`当前 Provider 不支持 refVideo(请去 admin/providers 配 supportsRefVideo:true)`),
      'BAD_REQUEST',
    );
  }

  // 升级占位 attempt 到 RUNNING + 真实 inputJson(7 轮 audit A1)
  // 注:projectId/episodeId/shotGroupId/providerId/modelId/action 在占位时已写,不重复 set
  const startedAt = new Date();
  const attempt = await prisma.generationAttempt.update({
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
        // 六八:人到声必到 — 自动附带的人物参考声线(只记 assetId,脱敏口径同 references)
        voiceRefAssetIds: voiceRefs.map((r) => r.assetId),
        // 六八下:身份级图参考(形象/三视图)条数(审计:这次喂了几张人物图)
        characterImageRefCount: characterImageRefs.length,
        // 缺声线人物记名(审计:该次生成没带谁的声音参考)
        voiceMissing: voiceMissing.map((m) => m.name),
      },
      status: 'RUNNING',
      startedAt,
      createdBy: userId,
    },
  });

  // 六八下(关联即全喂):token 引用图 + 人物身份级图参考(形象/三视图全送)合并去重
  const refImageUrls = Array.from(
    new Set([
      ...compiled.references
        .filter((r) => r.kind === 'IMAGE')
        .map((r) => r.mediaUrl)
        .filter((u): u is string => !!u),
      ...characterImageRefs.map((r) => r.mediaUrl),
    ]),
  );
  // 2026-05-27 audit r13:binding 含 AUDIO 类资产(角色配音 voiceMediaId)时收集
  // capsParams.supportsRefAudio !== true 时静默丢弃(Provider 不支持就别传,避 422)
  // 六八(人到声必到):voiceRefs(人物绑定的参考声线)无条件并入 — 不依赖 @音频N token;
  //   显式 SOUND_VOICE binding 与之重复时靠下方 Set 去重
  const rawRefAudioUrls = [
    ...compiled.references
      .filter((r) => r.kind === 'AUDIO')
      .map((r) => r.mediaUrl)
      .filter((u): u is string => !!u),
    ...voiceRefs.map((r) => r.mediaUrl),
  ];
  // 2026-05-27 audit r14 P1:audio 处理统一(input.refAudioUrl + binding 来的 audio 都 silent drop)
  const allAudioUrls =
    capsParams.supportsRefAudio === true
      ? [...rawRefAudioUrls, ...(args.refAudioUrl ? [args.refAudioUrl] : [])]
      : [];
  const droppedAudio =
    (capsParams.supportsRefAudio === true ? 0 : rawRefAudioUrls.length) +
    (capsParams.supportsRefAudio !== true && args.refAudioUrl ? 1 : 0);
  if (droppedAudio > 0) {
    console.warn(
      `[generateVideo] provider ${providerId} 不支持 refAudio,丢弃 ${droppedAudio} 个音频 URL`,
    );
  }
  // 五七-3:去重(角色形象绑定自动带的 voiceMediaId 可能与显式 SOUND_VOICE 绑定重复)
  const refAudioUrls = Array.from(new Set(allAudioUrls));
  // 六八:缺声线人物记警(不阻断 — 没有声线也允许生成,但日志可查"为什么这条没带某人声音")
  if (voiceMissing.length > 0) {
    console.warn(
      `[generateVideo] group ${grp.number} 人物缺参考声线,本次生成不带其声音参考:${voiceMissing.map((m) => m.name).join('、')}`,
    );
  }

  // M3a(六八)关键帧先行:组首 shot.startFrameMediaId 已确认 → 解析 URL 作首帧约束。
  // caps 门:supportsFirstFrame !== true 时静默丢弃 + 日志(口径同 refAudio)。
  let firstFrameUrl: string | undefined;
  const firstShot = await prisma.shot.findFirst({
    where: { groupId: grp.id, deletedAt: null },
    orderBy: { positionIdx: 'asc' },
    select: { startFrameMediaId: true },
  });
  if (firstShot?.startFrameMediaId) {
    if (capsParams.supportsFirstFrame === true) {
      const m = await prisma.mediaItem.findFirst({
        where: { id: firstShot.startFrameMediaId, deletedAt: null },
        select: { cdnUrl: true, storageKey: true },
      });
      const u = m ? await resolveMediaFetchUrl(m, { expiresInSeconds: 12 * 3600 }) : null;
      if (u) firstFrameUrl = u;
      else {
        console.warn(
          `[generateVideo] group ${grp.number} 首帧媒体 URL 解析失败,本次不带首帧约束`,
        );
      }
    } else {
      console.warn(
        `[generateVideo] provider ${providerId} 未声明 supportsFirstFrame,丢弃组 ${grp.number} 的首帧约束(去 admin/providers 配 supportsFirstFrame:true)`,
      );
    }
  }

  // 三十六收工 R2:入队 + 失败时回滚 attempt + REFUND 抽到 enqueueVideoJobOrRefund helper
  const payload: VideoGenJobData = {
    attemptId: attempt.id,
    projectId: grp.projectId,
    episodeId: grp.episodeId,
    shotGroupId: grp.id,
    userId,
    providerId,
    modelId: providerId,
    prompt: compiled.positive,
    durationS,
    aspectRatio,
    refImageUrls: refImageUrls.length > 0 ? refImageUrls : undefined,
    refAudioUrls: refAudioUrls.length > 0 ? refAudioUrls : undefined,
    // M3a:关键帧首帧约束(已过 caps 门;adapter 收 VideoRequest.firstFrameUrl)
    firstFrameUrl,
    // W5.5.1 扩展参数透传(Provider 自己消费 extra)
    resolution: args.resolution,
    generateAudio: wantAudio,
    addWatermark: args.addWatermark,
    webSearchEnabled: args.webSearchEnabled,
    refVideoUrl: args.refVideoUrl,
    refAudioUrl: args.refAudioUrl,
    groupNumber: grp.number,
    // 第 19 轮 audit P1:requestId 贯通到 worker,运维 grep 日志可看全链路
    requestId: args.requestId,
  };
  try {
    await enqueueVideoJobOrRefund(prisma, {
      attemptId: attempt.id,
      startedAt,
      userId,
      projectId: grp.projectId,
      episodeId: grp.episodeId,
      providerId,
      payload,
      enqueue: (p) => enqueueVideoGenJob(p),
    });
  } catch (enqueueErr) {
    // F5b:A 路入队失败时 B 占位仍 QUEUED+PREPAY — 一并释放(幂等),不留半态
    if (duelAttempt && duelProviderId) {
      await releaseDuelPlaceholder(prisma, {
        attemptId: duelAttempt.id,
        userId,
        projectId: grp.projectId,
        episodeId: grp.episodeId,
        providerId: duelProviderId,
        errorMsg: 'A 路入队失败,对决取消',
      }).catch((e) =>
        console.warn('[submit] 对决 B 占位释放失败(A 入队失败路):', sanitizeErrorMsg(e)),
      );
    }
    // 深审修(P2-1):BullMQ/Redis 报错常含内网 host:port(ECONNREFUSED 127.0.0.1:6379 等),
    // 必须脱敏 — 原 router 版就漏了这一处(enqueue.ts docstring 的承诺今天兑现)
    return {
      ok: false,
      code: 'ENQUEUE_FAILED',
      message: `视频任务入队失败,请稍后重试:${sanitizeErrorMsg(enqueueErr)}`,
      cause: enqueueErr,
    };
  }

  // ---- F5b(七二)B 路:对决第二家 ----
  // 纪律:A 路(上方)是审计过的资金主路,零改动;B 路独立支线,任何 provider 级失败
  // (compile/caps/入队)只「降级」:退 B 保 A,ok 返回带 duelDegraded 供 UI 提示。
  let duelAttemptId: string | undefined;
  let duelDegraded: string | undefined;
  if (duelAttempt && duelProviderId) {
    try {
      const duelCompiled = await compileVideoPromptForGroup(prisma, {
        group: {
          id: grp.id,
          prompt: grp.prompt,
          durationS: grp.durationS,
          episode: { projectId: grp.projectId },
        },
        providerId: duelProviderId,
        durationS,
        aspectRatio,
        extraInstruction: args.extraInstruction,
        extraNegative: args.extraNegative,
        includeVoiceDescriptions: wantAudio,
      });
      const capsB = await prisma.providerConfig.findUnique({
        where: { providerId: duelProviderId },
        select: { defaultParams: true },
      });
      const capsParamsB =
        capsB?.defaultParams && typeof capsB.defaultParams === 'object'
          ? (capsB.defaultParams as Record<string, unknown>)
          : {};
      if (args.refVideoUrl && capsParamsB.supportsRefVideo !== true) {
        throw new Error(`对决方 ${duelProviderId} 不支持 refVideo`);
      }
      const startedAtB = new Date();
      await prisma.generationAttempt.update({
        where: { id: duelAttempt.id },
        data: {
          inputJson: {
            kind: 'aigc.generateVideo',
            groupNumber: grp.number,
            positivePrompt: sanitizePromptForLedger(duelCompiled.compiled.positive),
            negativePrompt: sanitizePromptForLedger(duelCompiled.compiled.negative),
            aspectRatio,
            durationS,
            references: sanitizeReferencesForLedger(duelCompiled.compiled.references),
            voiceRefAssetIds: duelCompiled.voiceRefs.map((r) => r.assetId),
            characterImageRefCount: duelCompiled.characterImageRefs.length,
            voiceMissing: duelCompiled.voiceMissing.map((m) => m.name),
            duelOf: attempt.id, // 对决配对审计(标签 groupId=duel_* 已共享)
          },
          status: 'RUNNING',
          startedAt: startedAtB,
          createdBy: userId,
        },
      });
      const refImageUrlsB = Array.from(
        new Set([
          ...duelCompiled.compiled.references
            .filter((r) => r.kind === 'IMAGE')
            .map((r) => r.mediaUrl)
            .filter((u): u is string => !!u),
          ...duelCompiled.characterImageRefs.map((r) => r.mediaUrl),
        ]),
      );
      const rawAudioB = [
        ...duelCompiled.compiled.references
          .filter((r) => r.kind === 'AUDIO')
          .map((r) => r.mediaUrl)
          .filter((u): u is string => !!u),
        ...duelCompiled.voiceRefs.map((r) => r.mediaUrl),
      ];
      const refAudioUrlsB =
        capsParamsB.supportsRefAudio === true
          ? Array.from(new Set([...rawAudioB, ...(args.refAudioUrl ? [args.refAudioUrl] : [])]))
          : [];
      let firstFrameUrlB: string | undefined;
      if (firstShot?.startFrameMediaId && capsParamsB.supportsFirstFrame === true) {
        const mB = await prisma.mediaItem.findFirst({
          where: { id: firstShot.startFrameMediaId, deletedAt: null },
          select: { cdnUrl: true, storageKey: true },
        });
        const uB = mB ? await resolveMediaFetchUrl(mB, { expiresInSeconds: 12 * 3600 }) : null;
        if (uB) firstFrameUrlB = uB;
      }
      const payloadB: VideoGenJobData = {
        attemptId: duelAttempt.id,
        projectId: grp.projectId,
        episodeId: grp.episodeId,
        shotGroupId: grp.id,
        userId,
        providerId: duelProviderId,
        modelId: duelProviderId,
        prompt: duelCompiled.compiled.positive,
        durationS,
        aspectRatio,
        refImageUrls: refImageUrlsB.length > 0 ? refImageUrlsB : undefined,
        refAudioUrls: refAudioUrlsB.length > 0 ? refAudioUrlsB : undefined,
        firstFrameUrl: firstFrameUrlB,
        resolution: args.resolution,
        generateAudio: wantAudio,
        addWatermark: args.addWatermark,
        webSearchEnabled: args.webSearchEnabled,
        refVideoUrl: args.refVideoUrl,
        refAudioUrl: args.refAudioUrl,
        groupNumber: grp.number,
        requestId: args.requestId,
      };
      await enqueueVideoJobOrRefund(prisma, {
        attemptId: duelAttempt.id,
        startedAt: startedAtB,
        userId,
        projectId: grp.projectId,
        episodeId: grp.episodeId,
        providerId: duelProviderId,
        payload: payloadB,
        enqueue: (p) => enqueueVideoGenJob(p),
      });
      duelAttemptId = duelAttempt.id;
    } catch (duelErr) {
      // 降级:退 B 保 A(QUEUED 守卫 + 幂等退款 — enqueue 内部已回滚时这里全 no-op)
      duelDegraded = sanitizeErrorMsg(duelErr);
      await releaseDuelPlaceholder(prisma, {
        attemptId: duelAttempt.id,
        userId,
        projectId: grp.projectId,
        episodeId: grp.episodeId,
        providerId: duelProviderId,
        errorMsg: `对决降级:${duelDegraded}`,
      }).catch((e) =>
        console.warn('[submit] 对决 B 占位释放失败(降级路):', sanitizeErrorMsg(e)),
      );
      console.warn(
        `[submit] 组 ${grp.number} 对决 B 路(${duelProviderId})降级,A 路不受影响:`,
        duelDegraded,
      );
    }
  }

  return { ok: true, attemptId: attempt.id, duelAttemptId, duelDegraded };
}

/** F5b:释放对决 B 占位(FAILED + 退 PREPAY;QUEUED 守卫 + 幂等,可重复调) */
async function releaseDuelPlaceholder(
  prisma: PrismaClient,
  args: {
    attemptId: string;
    userId: string;
    projectId: string;
    episodeId: string;
    providerId: string;
    errorMsg: string;
  },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.generationAttempt.updateMany({
      where: { id: args.attemptId, status: 'QUEUED' },
      data: { status: 'FAILED', errorMsg: args.errorMsg, finishedAt: new Date() },
    });
    await refundPrepayForAttempt(tx, {
      attemptId: args.attemptId,
      userId: args.userId,
      projectId: args.projectId,
      episodeId: args.episodeId,
      providerId: args.providerId,
      reason: 'duel_leg_released',
    });
  });
}
