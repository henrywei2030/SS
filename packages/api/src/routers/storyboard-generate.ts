/**
 * Storyboard Router — 生成 / 发布组(listShotsByProject / listEligibleForGeneration /
 *   generateForEpisode / publishEpisode）。
 *
 * 机械重构(ADR-31):从 storyboard.ts 按逻辑组拆出,纯搬运无行为变化。
 *   共用 helper / schema / 常量见 storyboard-shared.ts。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { generateStoryboard } from '@ss/core/storyboard';
import { parseScriptText } from '@ss/core/script';
import { EVENTS } from '@ss/shared/events';
import { getEventBus } from '@ss/adapters/eventbus';
// 第 18 轮 audit P1:LLM 失败错误信息脱敏(防真接 Claude 后泄漏 API URL/token)
import { sanitizeErrorMsg } from '@ss/shared';

import { protectedProcedure, rateLimit } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';
// 三十二收工 S3 followup:batch SystemSetting 读 helper
import { loadSystemSettings } from '../utils/system-bindings.js';
import { acquireTxAdvisoryLock } from '../utils/advisory-lock.js';
import {
  acquireEpisodeLock,
  isEpisodeLockedNow,
  refreshEpisodeLock,
  releaseEpisodeLock,
  SOFT_LOCK_TTL_MS,
} from '../utils/episode-lock.js';

// W7+ audit R10:assertProjectAccess 抽到 middleware/access.ts
import { assertProjectAccess } from '../middleware/access.js';

import {
  loadEpisodeOrThrow,
  getStoryboardBindings,
  pLimitMap,
} from './storyboard-shared.js';

export const generateProcedures = {
  // -------- 生成（AI） --------

  /**
   * 整集生成分镜 — 调 LLM 把剧本拆为单镜 + 提示词
   *
   * 流程：
   *   1. 找到该集的当前剧本（含 Scene 拆解）
   *   2. 对每个 Scene 调 generateStoryboard()
   *   3. 单镜入库（规则:生成不自动形成组,组合由人工在分镜工坊手动调整）
   *   4. 触发 EVENTS.STORYBOARD_GENERATED
   */
  /**
   * 列出项目所有集的分镜 — 给"导出全部"用,一次返回省 N+1
   *
   * 返回结构按集分组,每集含 groups + ungrouped(同 listShots grouped=true 形状),
   * 前端用相同 buildShotsCsv 逻辑遍历各集即可拼出多集 CSV。
   *
   * Phase 1.5.3 点 3:全部集 CSV 导出
   */
  listShotsByProject: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const episodes = await ctx.prisma.episode.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        orderBy: { number: 'asc' },
      });
      const episodeIds = episodes.map((e) => e.id);
      if (episodeIds.length === 0) return { episodes: [] };

      const [allShots, allGroups] = await Promise.all([
        ctx.prisma.shot.findMany({
          where: { episodeId: { in: episodeIds }, deletedAt: null },
          orderBy: [{ episodeId: 'asc' }, { positionIdx: 'asc' }],
        }),
        ctx.prisma.shotGroup.findMany({
          where: { episodeId: { in: episodeIds }, deletedAt: null },
          orderBy: [{ episodeId: 'asc' }, { positionIdx: 'asc' }],
        }),
      ]);

      const shotsByEp = new Map<string, typeof allShots>();
      for (const s of allShots) {
        if (!shotsByEp.has(s.episodeId)) shotsByEp.set(s.episodeId, []);
        shotsByEp.get(s.episodeId)!.push(s);
      }
      const groupsByEp = new Map<string, typeof allGroups>();
      for (const g of allGroups) {
        if (!groupsByEp.has(g.episodeId)) groupsByEp.set(g.episodeId, []);
        groupsByEp.get(g.episodeId)!.push(g);
      }

      return {
        episodes: episodes.map((ep) => {
          const shots = shotsByEp.get(ep.id) ?? [];
          const groups = groupsByEp.get(ep.id) ?? [];
          const byGroup = new Map<string, typeof shots>();
          const ungrouped: typeof shots = [];
          for (const s of shots) {
            if (s.groupId) {
              if (!byGroup.has(s.groupId)) byGroup.set(s.groupId, []);
              byGroup.get(s.groupId)!.push(s);
            } else {
              ungrouped.push(s);
            }
          }
          return {
            episodeId: ep.id,
            episodeNumber: ep.number,
            title: ep.title,
            groups: groups.map((g) => ({ ...g, shots: byGroup.get(g.id) ?? [] })),
            ungrouped,
            shotCount: shots.length,
          };
        }),
      };
    }),

  /**
   * 列出项目内"可生成分镜"的集 — 给前端"全部集生成"用,先看再循环 generateForEpisode
   *
   * 筛选条件:
   *   - status NOT_STARTED 或 IN_PROGRESS(发布过的也可重新生成)
   *   - 有当前剧本(isCurrent=true)
   *   - 不在 fresh GENERATING 软锁中
   *
   * Phase 1.5.3 点 2:全集 vs 单集双模式
   */
  listEligibleForGeneration: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const episodes = await ctx.prisma.episode.findMany({
        where: {
          projectId: input.projectId,
          deletedAt: null,
          status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
          batchLocked: false, // Phase 1.5.3 精炼 4:用户锁定的集不进批量
        },
        include: {
          scripts: {
            where: { isCurrent: true, deletedAt: null },
            select: { id: true, version: true },
            take: 1,
          },
          _count: { select: { shots: { where: { deletedAt: null } } } },
        },
        orderBy: { number: 'asc' },
      });
      return episodes
        .filter((e) => e.scripts.length > 0 && !isEpisodeLockedNow(e))
        .map((e) => ({
          episodeId: e.id,
          episodeNumber: e.number,
          title: e.title,
          scriptVersion: e.scripts[0]?.version ?? 0,
          existingShotCount: e._count.shots,
          status: e.status,
        }));
    }),

  generateForEpisode: protectedProcedure
    // 第 19 轮 audit / ADR-27:Mastra agent 调用前必看 episode 状态 + LLM 配额
    .meta({
      agentTool: {
        description: '为指定 Episode 自动分镜:剧本拆场 → LLM 生成镜头 → 自动合并组,调 Claude/豆包',
        sideEffects: [
          'extern.api:TextProvider',
          'db.create:Scene',
          'db.create:Shot',
          'db.create:ShotGroup',
          'db.create:GenerationAttempt',
          'cost.deduct',
          'eventbus.publish:STORYBOARD_GENERATED',
        ],
        costEstimateCny: 5.0,
        requireConfirm: false,
      },
    })
    // W7 audit R8 P0:per-user 5 次 / 60s — 整集 LLM 调用最贵,严控
    .use(
      rateLimit({
        key: (ctx) => `storyboard.generateForEpisode:${ctx.user?.id ?? 'anon'}`,
        max: 5,
        windowMs: 60_000,
        message: '整集分镜生成过快(每分钟最多 5 次)',
      }),
    )
    .input(
      z.object({
        episodeId: z.string().cuid(),
        replaceExisting: z.boolean().default(false), // 是否清空现有 shots
        scriptId: z.string().cuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId);

      // W3.1.followup 软锁:抢锁失败抛 CONFLICT;抢到后必须配 release(finally 内)
      const lock = await acquireEpisodeLock(ctx.prisma, ep.id);

      // r9 audit:outer-scoped refresh timer · outer finally 兜底 clearInterval
      // 防 group 合并段(inner finally 之后)抛错时 timer 泄漏 → setInterval 仍跑 refresh
      let activeRefreshTimer: ReturnType<typeof setInterval> | null = null;

      try {
      const bindings = await getStoryboardBindings(ctx);

      // 1. 取剧本 — 严格按 projectId + deletedAt 过滤；未指定 scriptId 时取当前版本
      const script = input.scriptId
        ? await ctx.prisma.script.findFirst({
            where: {
              id: input.scriptId,
              projectId: ep.projectId,
              deletedAt: null,
            },
          })
        : await ctx.prisma.script.findFirst({
            where: {
              episodeId: ep.id,
              projectId: ep.projectId,
              isCurrent: true,
              deletedAt: null,
            },
          });
      if (!script) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '本集尚未上传剧本' });
      }

      // 2. 取场（若还没拆场则先 parse + 入库）
      let scenes = await ctx.prisma.scene.findMany({
        where: { episodeId: ep.id, deletedAt: null },
        orderBy: { positionIdx: 'asc' },
      });
      if (scenes.length === 0) {
        const parsed = parseScriptText(script.content);
        scenes = await ctx.prisma.$transaction(
          parsed.scenes.map((s, i) =>
            ctx.prisma.scene.create({
              data: {
                episodeId: ep.id,
                scriptId: script.id,
                number: s.number,
                timeOfDay: s.timeOfDay,
                location: s.location,
                place: s.place,
                characters: s.characters,
                content: s.rawContent,
                positionIdx: i + 1,
              },
            }),
          ),
        );
      }

      // 3. 若 replaceExisting:级联软删现有 shots + groups + scenes + 关联的 AssetUsageBinding
      //    防 W4 audit 永远报"悬空 binding" + 旧 sceneId 引用断裂
      if (input.replaceExisting) {
        const now = new Date();
        await ctx.prisma.$transaction([
          ctx.prisma.shot.updateMany({
            where: { episodeId: ep.id, deletedAt: null },
            data: { deletedAt: now },
          }),
          ctx.prisma.shotGroup.updateMany({
            where: { episodeId: ep.id, deletedAt: null },
            data: { deletedAt: now },
          }),
          ctx.prisma.scene.updateMany({
            where: { episodeId: ep.id, deletedAt: null },
            data: { deletedAt: now },
          }),
          // 本集相关的 AssetUsageBinding 一并清(防止 binding 引用已删 shot/scene)
          ctx.prisma.assetUsageBinding.updateMany({
            where: { episodeId: ep.id, deletedAt: null },
            data: { deletedAt: now },
          }),
        ]);
      }

      // 4. 项目风格 — 完整带过 StyleProfile 三段 prompt + forbidden,与 W4 拼接公式对齐
      const project = await ctx.prisma.project.findUnique({
        where: { id: ep.projectId },
        include: { style: true },
      });
      const styleSlug = project?.style?.slug;
      const stylePrompt = project?.style
        ? {
            scenePrompt: project.style.scenePrompt,
            characterPrompt: project.style.characterPrompt,
            // W7 audit R5:补 propPrompt(原漏传,W4/W5 拼接公式 3 段全读)
            propPrompt: project.style.propPrompt,
            forbiddenWords: project.style.forbiddenWords,
          }
        : undefined;

      // 5. 已建档资产名单（用于 @ 引用提示）
      const knownAssets = await ctx.prisma.asset.findMany({
        where: { projectId: ep.projectId, deletedAt: null, type: 'CHARACTER' },
        select: { name: true },
      });
      const knownCharacters = knownAssets.map((a) => a.name);

      // 5b. W7 followup:加载 4 大预设 — admin.preset.list 同源
      // (从 SystemSetting preset.<kind> 读;没配时 PRESET_DEFAULTS 兜底)
      // 三十二收工 S3 followup:helper batch
      const presetMap = await loadSystemSettings(ctx.prisma, [
        'preset.framing',
        'preset.angle',
        'preset.movement',
        'preset.lighting',
      ]);
      const parsePresetValue = (raw: string | undefined): string[] | undefined => {
        if (!raw) return undefined;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
            return parsed;
          }
        } catch {
          // 损坏 JSON,fallback undefined → LLM 走自由发挥
        }
        return undefined;
      };
      const presets = {
        framing: parsePresetValue(presetMap['preset.framing']),
        angle: parsePresetValue(presetMap['preset.angle']),
        movement: parsePresetValue(presetMap['preset.movement']),
        lighting: parsePresetValue(presetMap['preset.lighting']),
      };

      // 6. 逐场调 LLM
      let totalCost = 0;
      let globalIdx = 0;
      const createdShotIds: string[] = [];
      const errors: string[] = [];

      // 取当前 episode 历史 shot 的最大 positionIdx 作为起点(包含 soft-deleted)
      // Postgres unique 索引仍包含已 soft-del 的行,跳过会撞 unique
      const lastShot = await ctx.prisma.shot.findFirst({
        where: { episodeId: ep.id },
        orderBy: { positionIdx: 'desc' },
      });
      let positionIdx = (lastShot?.positionIdx ?? 0);

      // W1-W5 audit P1 followup(P1-3):stale TTL 动态续约 — 长剧本可能 >15min
      // r8 性能优化:并发改造后用 setInterval 续约(原 for-of 内同步续约失效)
      // r9 audit:用 outer-scoped let + outer finally 兜底 clearInterval,
      //   防 Phase 2 / group 合并段抛错时 timer 泄漏(原 inner finally 只保护 Phase 1+2)
      const REFRESH_INTERVAL_MS = Math.floor(SOFT_LOCK_TTL_MS / 3);
      const refreshTimer = setInterval(() => {
        void refreshEpisodeLock(ctx.prisma, ep.id).catch((err: unknown) =>
          console.error('[generateForEpisode] refresh lock failed:', err),
        );
      }, REFRESH_INTERVAL_MS);
      // 注册到 outer 作用域 · 外层 finally 兜底清理
      activeRefreshTimer = refreshTimer;

      // r8 性能优化:Phase 1 并发跑 LLM(限流 3)· Phase 2 顺序写 Shot 表
      //   原:5 场串行 × 8s/场 = 40s wall time
      //   改:并发 3 → max(LLM 各场耗时) ≈ ~15-20s · 实测 2-3x 加速
      //   关键约束:positionIdx / globalIdx 顺序递增,必须 Phase 2 顺序写
      type SceneResult =
        | {
            ok: true;
            dbScene: (typeof scenes)[number];
            attemptId: string;
            attemptStartedAt: Date;
            shots: Awaited<ReturnType<typeof generateStoryboard>>['shots'];
            cost: number;
            warning?: string;
          }
        | {
            ok: false;
            dbScene: (typeof scenes)[number];
            attemptId: string;
            attemptStartedAt: Date;
            errMsg: string;
          }
        | { skip: true; dbScene: (typeof scenes)[number] };

      try {
        // ----- Phase 1: 并发跑 LLM(限流 3)----------
        const LLM_CONCURRENCY = 3;
        const sceneResults: SceneResult[] = await pLimitMap(
          scenes,
          LLM_CONCURRENCY,
          async (dbScene): Promise<SceneResult> => {
            // 重新解析单场原文(已存的 rawContent 直接用)
            const parsedScene = parseScriptText(dbScene.content).scenes[0];
            if (!parsedScene) return { skip: true, dbScene };

            // W1-W5 audit P0(B1):每场起一条 GenerationAttempt
            const attemptStartedAt = new Date();
            const attempt = await ctx.prisma.generationAttempt.create({
              data: {
                projectId: ep.projectId,
                episodeId: ep.id,
                providerId: bindings.modelId,
                modelId: bindings.modelId,
                action: 'TEXT',
                inputJson: {
                  kind: 'storyboard.generateForEpisode',
                  sceneNumber: dbScene.number,
                  sceneId: dbScene.id,
                  styleSlug,
                  defaultShotDurationS: bindings.defaultShotDurationS,
                  maxShotDurationS: bindings.maxDurationS,
                },
                outputMediaIds: [],
                inputUnits: 0,
                outputUnits: 0,
                unitPriceCny: '0',
                costCny: '0',
                status: 'RUNNING',
                startedAt: attemptStartedAt,
                createdBy: ctx.user.id,
              },
            });

            try {
              const gen = await generateStoryboard({
                scene: parsedScene,
                modelId: bindings.modelId,
                styleSlug,
                stylePrompt,
                knownCharacters,
                presets,
                defaultShotDurationS: bindings.defaultShotDurationS,
                maxShotDurationS: bindings.maxDurationS,
                ctx: {
                  userId: ctx.user.id,
                  projectId: ep.projectId,
                  episodeId: ep.id,
                  attemptId: attempt.id,
                },
              });
              return {
                ok: true,
                dbScene,
                attemptId: attempt.id,
                attemptStartedAt,
                shots: gen.shots,
                cost: gen.cost,
                warning: gen.warning,
              };
            } catch (e) {
              console.error('[storyboard.generateForEpisode] LLM failed (raw):', e);
              return {
                ok: false,
                dbScene,
                attemptId: attempt.id,
                attemptStartedAt,
                errMsg: sanitizeErrorMsg(e),
              };
            }
          },
        );

        // ----- Phase 2: 顺序聚合 + 写 Shot 表(positionIdx/globalIdx 必须单调)
        for (const result of sceneResults) {
          if ('skip' in result) continue;

          if (!result.ok) {
            // 失败 attempt 更新 + 错误聚合
            await ctx.prisma.generationAttempt.update({
              where: { id: result.attemptId },
              data: {
                status: 'FAILED',
                errorMsg: result.errMsg,
                finishedAt: new Date(),
                durationMs: Date.now() - result.attemptStartedAt.getTime(),
              },
            });
            errors.push(`场 ${result.dbScene.number}: ${result.errMsg}`);
            continue;
          }

          // 成功:写 shots(顺序 positionIdx/globalIdx)+ 更新 attempt
          totalCost += result.cost;
          if (result.warning) {
            errors.push(`场 ${result.dbScene.number}: ${result.warning}`);
          }

          // 三十九收工 perf:N+1 串行 shot.create → createManyAndReturn(一集 N 镜单次往返,~50× 加速)
          //   生成只产单镜(不自动组),这是主热路径。globalIdx/positionIdx 前置自增保持单调,
          //   createManyAndReturn 返回顺序跟 data 数组一致(PostgreSQL),故 createdShotIds 顺序正确。
          const shotData = result.shots.map((s) => ({
            episodeId: ep.id,
            sceneId: result.dbScene.id,
            number: String((globalIdx += 1)),
            framing: s.framing,
            angle: s.angle,
            movement: s.movement,
            lighting: s.lighting,
            content: s.content,
            prompt: s.prompt,
            durationS: s.durationS,
            priority: s.priority,
            positionIdx: (positionIdx += 1),
          }));
          const createdShots = await ctx.prisma.shot.createManyAndReturn({
            data: shotData,
          });
          createdShotIds.push(...createdShots.map((c) => c.id));

          const finishedAt = new Date();
          await ctx.prisma.generationAttempt.update({
            where: { id: result.attemptId },
            data: {
              status: result.warning ? 'FAILED' : 'SUCCESS',
              errorMsg: result.warning ?? null,
              costCny: result.cost.toFixed(4),
              finishedAt,
              durationMs: finishedAt.getTime() - result.attemptStartedAt.getTime(),
            },
          });
        }
      } finally {
        clearInterval(refreshTimer);
      }

      // 规则:生成分镜后【不自动形成组】— 永远只产单镜,组合由人工在分镜工坊手动调整
      //   (手动合并走 storyboard.mergeShots endpoint,拆分走 splitGroup)。彻底移除生成时自动
      //   mergeShots,杜绝 autoMerge setting 各机漂移(原 mac-studio=false / mac-mini=true)。
      //   发布(publishEpisode)时仍会把 standalone shot 1:1 group 化供 AIGC。
      const createdGroupIds: string[] = [];

      await logOperation(ctx, 'storyboard.generate', 'episode', ep.id, null, {
        shotCount: createdShotIds.length,
        groupCount: createdGroupIds.length,
        cost: totalCost,
        errors,
      });

      // 第 19 轮 audit P1:真 publish 给订阅方(events.ts 已定义,router 之前漏调)
      // 失败不影响主流程返回,catch 内只 log(订阅方掉线不应让主 mutation 失败)
      await getEventBus()
        .publish(
          EVENTS.STORYBOARD_GENERATED,
          { episodeId: ep.id, shotCount: createdShotIds.length },
          { publisherId: 'storyboard.generateForEpisode' },
        )
        .catch((err) => {
          console.error('[storyboard.generateForEpisode] eventbus publish failed:', err);
        });

      return {
        eventName: EVENTS.STORYBOARD_GENERATED,
        episodeId: ep.id,
        shotCount: createdShotIds.length,
        groupCount: createdGroupIds.length,
        cost: totalCost,
        errors,
      };
      } finally {
        // r9 audit:兜底清 refreshTimer(inner finally 仅保护 Phase 1+2,group 合并抛错时漏清)
        if (activeRefreshTimer !== null) {
          clearInterval(activeRefreshTimer);
          activeRefreshTimer = null;
        }
        // 释放失败不能掩盖原始错误 — 只 log,等 stale TTL 自愈或人工解锁
        await releaseEpisodeLock(ctx.prisma, lock).catch((err) => {
          console.error('[generateForEpisode] failed to release lock', {
            episodeId: ep.id,
            err: err instanceof Error ? err.message : err,
          });
        });
      }
    }),

  // -------- 发布 --------

  publishEpisode: protectedProcedure
    // 第 20 轮 audit / ADR-27:发布是 episode-level 不可逆动作,Mastra agent 必须 human-in-loop
    .meta({
      agentTool: {
        description: '发布整集分镜:status DRAFT/IN_PROGRESS → IN_PROGRESS + publishedVersion+1 + shot/group → PUBLISHED;触发下游订阅方',
        sideEffects: [
          'db.update:Episode',
          'db.updateMany:Shot',
          'db.updateMany:ShotGroup',
          'eventbus.publish:STORYBOARD_PUBLISHED',
          'OperationLog.write',
        ],
        costEstimateCny: 0,
        requireConfirm: true,
      },
    })
    .input(z.object({ episodeId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId);

      // 发布语义(shot/group 的 status):
      //   - DRAFT → 升级为 PUBLISHED + 戳 publishedAt
      //   - PUBLISHED → 保持 PUBLISHED,publishedAt 戳更新(等于重新触发下游消费者)
      //   - QUEUED/GENERATING/GENERATED/ADOPTED/FINAL/FAILED/BUDGET_BLOCKED → 不动
      //     (已在制作流水中或终态,避免覆盖丢进度)
      const REPUBLISHABLE: Array<'DRAFT' | 'PUBLISHED'> = ['DRAFT', 'PUBLISHED'];

      // W1-W5 audit P1 followup(P1-1):TOCTOU 全事务化 + advisory_xact_lock
      //   原版只做事务内 status CAS,仍存在 read-then-act 窗口(读 ep 时未锁定 → 事务前其它请求
      //   可以把 GENERATING fresh→stale 之间状态变化,或并发 publish 重复增加 publishedVersion)。
      //   现把 lock check + status check + publish 全部锁内做,advisory_xact_lock 串行化
      //   同 episode 的所有 publish 请求,与 acquireEpisodeLock 用同一 key 派生空间但不同 namespace
      //   (这里用 'episode_publish:',与 'episode_lock:' 不冲突)。
      const now = new Date();
      const updated = await ctx.prisma.$transaction(async (tx) => {
        await acquireTxAdvisoryLock(tx, 'episode_publish', ep.id);
        // 锁内 re-read,拿到不可被并发改动的真实状态
        const fresh = await tx.episode.findUnique({
          where: { id: ep.id },
          select: {
            id: true,
            status: true,
            generatingStartedAt: true,
            publishedVersion: true,
          },
        });
        if (!fresh) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
        }
        // W3.1.followup 软锁:fresh GENERATING 不可发布
        if (isEpisodeLockedNow(fresh)) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: '本集正在生成分镜,无法发布(请稍候或在管理员后台强制解锁)',
          });
        }
        // W1-W5 audit P0(D2):只允许从 NOT_STARTED / IN_PROGRESS 发布
        if (fresh.status !== 'NOT_STARTED' && fresh.status !== 'IN_PROGRESS') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `本集状态为 ${fresh.status},不能发布(只允许从 NOT_STARTED / IN_PROGRESS 发布)`,
          });
        }

        const e = await tx.episode.update({
          where: { id: ep.id },
          data: {
            publishedAt: now,
            publishedVersion: fresh.publishedVersion + 1,
            status: 'IN_PROGRESS',
          },
        });
        await tx.shotGroup.updateMany({
          where: {
            episodeId: ep.id,
            deletedAt: null,
            status: { in: REPUBLISHABLE },
          },
          data: { status: 'PUBLISHED', publishedAt: now },
        });
        await tx.shot.updateMany({
          where: {
            episodeId: ep.id,
            deletedAt: null,
            status: { in: REPUBLISHABLE },
          },
          data: { status: 'PUBLISHED' },
        });

        // 三十七收工 P0 修(用户反馈):单分镜也要同步到 AIGC
        //   AIGC 工坊架构上只接受 ShotGroup(aigc.listGroups 拉 group 表),
        //   standalone shot(groupId=null)永远不会出现在 AIGC。
        //   解法:publish 时为每个 standalone shot 自动建 1:1 ShotGroup,
        //   group.number=shot.number,prompt=shot.prompt,positionIdx 顺延末位 +1
        const standaloneShots = await tx.shot.findMany({
          where: {
            episodeId: ep.id,
            deletedAt: null,
            groupId: null,
          },
          orderBy: { positionIdx: 'asc' },
        });
        if (standaloneShots.length > 0) {
          // P2 防御:filter deletedAt 让 positionIdx 紧凑(不带 soft-deleted 留下的空隙)
          // 实际 partial unique `WHERE deletedAt IS NULL` 不会让 nextIdx 跟 active 冲突,
          // 但带上 deletedAt=null 更稳健 + positionIdx 数字小用户看 UI 更顺
          const lastGroup = await tx.shotGroup.findFirst({
            where: { episodeId: ep.id, deletedAt: null },
            orderBy: { positionIdx: 'desc' },
            select: { positionIdx: true },
          });
          const baseIdx = (lastGroup?.positionIdx ?? 0) + 1;
          // 三十九收工 perf:N 个 group.create 串行 → 1 次 createManyAndReturn(返回顺序跟 data 一致,PG)
          //   single-shot group 沿用 shot 自己的 number/prompt/duration;shot.groupId 回填仍逐条(tx 内顺序安全)
          const newGroups = await tx.shotGroup.createManyAndReturn({
            data: standaloneShots.map((sh, i) => ({
              episodeId: ep.id,
              number: sh.number,
              positionIdx: baseIdx + i,
              durationS: sh.durationS,
              prompt: sh.prompt,
              status: 'PUBLISHED' as const,
              publishedAt: now,
            })),
          });
          for (let i = 0; i < standaloneShots.length; i++) {
            await tx.shot.update({
              where: { id: standaloneShots[i]!.id },
              data: { groupId: newGroups[i]!.id },
            });
          }
        }
        return e;
      });

      const groupCount = await ctx.prisma.shotGroup.count({
        where: { episodeId: ep.id, deletedAt: null },
      });
      const shotCount = await ctx.prisma.shot.count({
        where: { episodeId: ep.id, deletedAt: null },
      });

      await logOperation(ctx, 'storyboard.publish', 'episode', ep.id, ep, updated);

      // 第 19 轮 audit P0:真 publish 给订阅方(events.ts 定义但 router 之前漏调,下游 / Phase 2 Auto-Salvage 订阅方都收不到)
      const shotIds = await ctx.prisma.shot.findMany({
        where: { episodeId: ep.id, deletedAt: null },
        select: { id: true },
      });
      await getEventBus()
        .publish(
          EVENTS.STORYBOARD_PUBLISHED,
          {
            episodeId: ep.id,
            projectId: ep.projectId,
            version: updated.publishedVersion,
            shotIds: shotIds.map((s) => s.id),
          },
          { publisherId: 'storyboard.publishEpisode' },
        )
        .catch((err) => {
          console.error('[storyboard.publishEpisode] eventbus publish failed:', err);
        });

      return {
        eventName: EVENTS.STORYBOARD_PUBLISHED,
        episodeId: ep.id,
        projectId: ep.projectId,
        publishedAt: now,
        version: updated.publishedVersion,
        shotCount,
        groupCount,
      };
    }),
};
