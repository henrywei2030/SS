/**
 * Storyboard Router — 分镜工坊（W3）
 *
 * 子模块边界：
 *   - Episode 级聚合 listEpisodes
 *   - Scene 级 listScenes（剧本场号）
 *   - Shot 级 CRUD
 *   - Group 级 merge / split / update
 *   - 整集 generate（剧本 → 单镜 + 提示词，一次性 LLM 调用）
 *   - publishEpisode 触发 EVENTS.STORYBOARD_PUBLISHED
 *   - recordEdit 把手改入 PromptEdit 表（训练数据集源）
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { generateStoryboard, mergeShots, type MergeableShot } from '@ss/core/storyboard';
import { parseScriptText } from '@ss/core/script';
import { EVENTS } from '@ss/shared/events';
import { getEventBus } from '@ss/adapters/eventbus';
// 第 18 轮 audit P1:LLM 失败错误信息脱敏(防真接 Claude 后泄漏 API URL/token)
import { sanitizeErrorMsg } from '@ss/shared';

import { router, protectedProcedure, rateLimit } from '../trpc.js';
import type { Context } from '../context.js';
import { logOperation } from '../middleware/audit.js';
import {
  acquireEpisodeLock,
  isEpisodeLockedNow,
  refreshEpisodeLock,
  releaseEpisodeLock,
  SOFT_LOCK_TTL_MS,
} from '../utils/episode-lock.js';

// ---------------------------------------------------------------------------
// 通用：项目访问校验
// ---------------------------------------------------------------------------

// W7+ audit R10:assertProjectAccess 抽到 middleware/access.ts
import { assertProjectAccess } from '../middleware/access.js';

/**
 * 性能优化:并发限流 map(自管 semaphore · 替代 p-limit 外部依赖)
 *   按输入顺序保留输出数组;每时刻最多 `limit` 个 fn() 在跑
 *   失败由 fn 自己 catch(返回 result 对象),不会 throw 中断其他任务
 */
async function pLimitMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * 反向解析 group.prompt 为各子镜的 prompt 数组
 *
 * 新格式(r3 之后):`[1/N] framing angle <prompt>\n[2/N] framing angle <prompt>\n...`
 *   - header `[i/N]` 后到下一个 `[i/N]`(行首)或文末是该镜内容
 *   - 内容以 framing+angle 开头(若 sortedShots[i] 提供),会被自动剥离
 *   - 兼容旧格式 `[i/N] header\n<prompt>` 多行结构(整段含 framing/angle 也能跳过前缀)
 *
 * 返回 string[] (长度 = sortedShots.length) 或 null(解析失败 → 调用方 fallback 保留原 shot.prompt)
 */
function parseGroupPromptSections(
  prompt: string,
  sortedShots: Array<{ framing: string | null; angle: string | null }>,
): string[] | null {
  const expectedCount = sortedShots.length;
  if (expectedCount <= 0) return null;
  // 匹配 [i/N] 标记位置(行首) — 仅匹配标记本身,不含后续内容
  const headerRegex = /^\[(\d+)\/(\d+)\]/gm;
  const headers: { idx: number; total: number; start: number; markerEnd: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRegex.exec(prompt)) !== null) {
    headers.push({
      idx: Number(m[1]),
      total: Number(m[2]),
      start: m.index,
      markerEnd: m.index + m[0].length,
    });
  }
  if (headers.length !== expectedCount) return null;
  for (let i = 0; i < headers.length; i++) {
    if (headers[i]!.idx !== i + 1) return null;
  }
  const result: string[] = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i]!.markerEnd;
    const end = i + 1 < headers.length ? headers[i + 1]!.start : prompt.length;
    let body = prompt.slice(start, end).replace(/^[\s\n]+|[\s\n]+$/g, '');
    // 尝试剥离 "framing angle" 前缀(若 shot 字段提供 + body 开头匹配)
    const framing = (sortedShots[i]?.framing ?? '').trim();
    const angle = (sortedShots[i]?.angle ?? '').trim();
    const prefix = `${framing} ${angle}`.replace(/\s+/g, ' ').trim();
    if (prefix && body.startsWith(prefix)) {
      body = body.slice(prefix.length).replace(/^[\s\n]+/, '');
    }
    result.push(body);
  }
  return result;
}

async function loadEpisodeOrThrow(ctx: Context, episodeId: string) {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  const ep = await ctx.prisma.episode.findFirst({
    where: { id: episodeId, deletedAt: null },
  });
  if (!ep) throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
  await assertProjectAccess(ctx, ep.projectId);
  return ep;
}

// ---------------------------------------------------------------------------
// 系统设置读取（modelId / maxDurationS / defaultShotDurationS）
// ---------------------------------------------------------------------------

async function getStoryboardBindings(ctx: Context): Promise<{
  modelId: string;
  maxDurationS: number;
  defaultShotDurationS: number;
  autoMerge: boolean;
}> {
  // r8 性能优化:storyboard bindings 高频读(每次 generateForEpisode + N 场并发都走)
  // 用 cache 缓 60s · admin.system.setSetting / admin.binding.set 后会 invalidate
  // 失败 fallback 直接查 DB(降级不崩)
  const { cacheGetOrSet } = await import('@ss/queue/cache');
  const settingsMap = await cacheGetOrSet<Record<string, string>>(
    'cache:bindings:storyboard',
    60,
    async () => {
      const rows = await ctx.prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              'binding.storyboard.generation.modelId',
              'storyboard.maxDurationS',
              'storyboard.defaultShotDurationS',
              'storyboard.autoMergeOnGenerate',
            ],
          },
        },
      });
      const out: Record<string, string> = {};
      for (const r of rows) out[r.key] = r.value;
      return out;
    },
  );
  const map = new Map(Object.entries(settingsMap));
  const modelId = map.get('binding.storyboard.generation.modelId') ?? '';
  // 二十收工后用户反馈:不 hardcode 默认 provider,binding 空时显式拒绝
  if (!modelId) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '分镜生成未配置 LLM Provider — 请去 /admin/bindings 选择 binding.storyboard.generation.modelId',
    });
  }
  return {
    modelId,
    maxDurationS: Number(map.get('storyboard.maxDurationS') ?? '15'),
    defaultShotDurationS: Number(map.get('storyboard.defaultShotDurationS') ?? '3'),
    // Phase 1.5.3 精炼 9:默认不自动合并组 — 用户用每行 ↑↓ 按钮手动组合
    autoMerge: (map.get('storyboard.autoMergeOnGenerate') ?? 'false') === 'true',
  };
}

// ---------------------------------------------------------------------------
// PromptEdit 写入辅助 — 训练数据集源
//
// 只对"AI 可生成的文本字段"写训练样本，避免污染数据集：
//   - framing/angle/content/prompt 是 AI 输出 → 人改 的核心训练对
//   - durationS/priority/sceneId 等是结构/调度字段，不进训练集
// ---------------------------------------------------------------------------

/** 训练数据集只采集这些 AI 文本字段 — 从 @ss/shared 常量集中管理 */
import { TRAINABLE_TEXT_FIELDS as TRAINABLE_TEXT_FIELD_LIST } from '@ss/shared';
const TRAINABLE_TEXT_FIELDS = new Set<string>(TRAINABLE_TEXT_FIELD_LIST);

async function recordPromptEdit(
  ctx: Context,
  args: {
    targetType: 'SHOT' | 'SHOT_GROUP' | 'SCENE';
    targetId: string;
    field: string;
    before: unknown;
    after: unknown;
    diffNote?: string;
    projectId: string;
    episodeId?: string;
    scriptId?: string;
  },
): Promise<void> {
  if (!ctx.user) return;
  // 只记可训练的文本字段
  if (!TRAINABLE_TEXT_FIELDS.has(args.field)) return;
  // 只记字符串
  if (typeof args.before !== 'string' || typeof args.after !== 'string') return;
  if (args.before === args.after) return;
  try {
    await ctx.prisma.promptEdit.create({
      data: {
        targetType: args.targetType,
        targetId: args.targetId,
        field: args.field,
        before: args.before,
        after: args.after,
        diffNote: args.diffNote,
        projectId: args.projectId,
        episodeId: args.episodeId,
        scriptId: args.scriptId,
        userId: ctx.user.id,
      },
    });
  } catch (e) {
    // 训练数据采集失败不阻塞用户操作，但记录足够上下文以便排查
    console.error('[promptEdit] failed to record:', {
      targetType: args.targetType,
      targetId: args.targetId,
      field: args.field,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const storyboardRouter = router({
  // -------- Episode --------

  /** 列出某项目所有集 + 聚合元信息（场数 / 单镜数 / 合并组数） */
  listEpisodes: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const episodes = await ctx.prisma.episode.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        orderBy: { number: 'asc' },
        include: {
          _count: {
            select: {
              scenes: { where: { deletedAt: null } },
              shots: { where: { deletedAt: null } },
              shotGroups: { where: { deletedAt: null } },
            },
          },
        },
      });
      return episodes.map((e) => ({
        id: e.id,
        number: e.number,
        title: e.title,
        status: e.status,
        publishedAt: e.publishedAt,
        publishedVersion: e.publishedVersion,
        batchLocked: e.batchLocked,
        sceneCount: e._count.scenes,
        shotCount: e._count.shots,
        groupCount: e._count.shotGroups,
      }));
    }),

  /**
   * 切换集数批量生成锁定 — Phase 1.5.3 精炼 4
   *
   * 锁定后:storyboard.listEligibleForGeneration 不返回本集,
   * "全部集数生成" 会跳过(不影响"当前集生成"按钮)。
   */
  setBatchLock: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().cuid(),
        locked: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId);
      const updated = await ctx.prisma.episode.update({
        where: { id: ep.id },
        data: { batchLocked: input.locked },
      });
      await logOperation(
        ctx,
        input.locked ? 'episode.batch_lock' : 'episode.batch_unlock',
        'episode',
        ep.id,
        { batchLocked: ep.batchLocked },
        { batchLocked: updated.batchLocked },
      );
      return { ok: true, batchLocked: updated.batchLocked };
    }),

  /**
   * 软删整集 — 项目成员级
   *
   * Phase 1.5.3 点追加 1:用户在剧本工坊左栏需要直接删除测试集。
   * 复用 admin.archive 的级联逻辑(scenes/shots/shotGroups/bindings 一并软删),
   * 但允许项目成员调用而非仅 admin。
   *
   * 安全门槛:
   *   - 软锁中的集不允许删(防覆盖正在生成的工作)
   *   - 已发布的集不允许删(防止 AIGC 后续引用悬空)— 可改为 ARCHIVED 状态备份
   */
  archiveEpisode: protectedProcedure
    .meta({
      agentTool: {
        description: '软删整集 + 级联清 scenes/shots/shotGroups/bindings:不可逆,需 confirmDelete',
        sideEffects: [
          'db.update:Episode.deletedAt',
          'db.updateMany:Scene/Shot/ShotGroup/AssetUsageBinding.deletedAt',
          'OperationLog.write',
        ],
        costEstimateCny: 0,
        requireConfirm: true,
      },
    })
    .input(
      z.object({
        episodeId: z.string().cuid(),
        confirmDelete: z.literal(true, {
          errorMap: () => ({ message: '需显式 confirmDelete=true(防误删)' }),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await loadEpisodeOrThrow(ctx, input.episodeId);
      if (before.deletedAt) {
        return { ok: true, alreadyArchived: true };
      }
      if (isEpisodeLockedNow(before)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,无法删除(请等生成完成或解锁后再删)',
        });
      }
      if (before.publishedAt) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            '本集已发布,无法直接删除(下游 AIGC 可能引用)。需先在 admin 后台强制归档。',
        });
      }
      const now = new Date();
      await ctx.prisma.$transaction([
        ctx.prisma.episode.update({
          where: { id: before.id },
          data: { deletedAt: now, status: 'ARCHIVED' },
        }),
        ctx.prisma.scene.updateMany({
          where: { episodeId: before.id, deletedAt: null },
          data: { deletedAt: now },
        }),
        ctx.prisma.shot.updateMany({
          where: { episodeId: before.id, deletedAt: null },
          data: { deletedAt: now },
        }),
        ctx.prisma.shotGroup.updateMany({
          where: { episodeId: before.id, deletedAt: null },
          data: { deletedAt: now },
        }),
        ctx.prisma.assetUsageBinding.updateMany({
          where: { episodeId: before.id, deletedAt: null },
          data: { deletedAt: now },
        }),
      ]);
      await logOperation(ctx, 'episode.archive', 'episode', before.id, before, {
        deletedAt: now,
        projectId: before.projectId,
      });
      return { ok: true, alreadyArchived: false };
    }),

  getEpisode: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId);
      const [scenes, shots, groups] = await Promise.all([
        ctx.prisma.scene.findMany({
          where: { episodeId: ep.id, deletedAt: null },
          orderBy: { positionIdx: 'asc' },
        }),
        ctx.prisma.shot.findMany({
          where: { episodeId: ep.id, deletedAt: null },
          orderBy: { positionIdx: 'asc' },
        }),
        ctx.prisma.shotGroup.findMany({
          where: { episodeId: ep.id, deletedAt: null },
          orderBy: { positionIdx: 'asc' },
        }),
      ]);
      return { episode: ep, scenes, shots, groups };
    }),

  // -------- Scene --------

  listScenes: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await loadEpisodeOrThrow(ctx, input.episodeId);
      return ctx.prisma.scene.findMany({
        where: { episodeId: input.episodeId, deletedAt: null },
        orderBy: { positionIdx: 'asc' },
      });
    }),

  /**
   * 软删 Scene — W1-W5 audit P2 followup(P2-1):级联清 shots + shot groups + bindings
   * 防止 binding/shot 悬空指向已删 scene。事务内一次性完成,任一步失败回滚。
   */
  deleteScene: protectedProcedure
    .input(z.object({ sceneId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const scene = await ctx.prisma.scene.findFirst({
        where: { id: input.sceneId, deletedAt: null },
        include: {
          episode: {
            select: { id: true, projectId: true, status: true, generatingStartedAt: true },
          },
        },
      });
      if (!scene || !scene.episode) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '场不存在' });
      }
      await assertProjectAccess(ctx, scene.episode.projectId);
      if (isEpisodeLockedNow(scene.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,请等导演侧完成后再删除场',
        });
      }
      const now = new Date();
      await ctx.prisma.$transaction([
        ctx.prisma.scene.update({
          where: { id: input.sceneId },
          data: { deletedAt: now },
        }),
        // 级联软删本场所有 shots
        ctx.prisma.shot.updateMany({
          where: { sceneId: input.sceneId, deletedAt: null },
          data: { deletedAt: now },
        }),
        // 级联软删指向本场的 binding(P2-1 修复点)
        ctx.prisma.assetUsageBinding.updateMany({
          where: { sceneId: input.sceneId, deletedAt: null },
          data: { deletedAt: now },
        }),
      ]);
      await logOperation(
        ctx,
        'scene.delete',
        'scene',
        input.sceneId,
        { ...scene, projectId: scene.episode.projectId },
        null,
      );
      return { ok: true };
    }),

  // -------- Shot --------

  /**
   * 列出某集分镜
   * - grouped=true：返回 { groups, ungrouped } 视图（UI 主视图）
   * - grouped=false：返回扁平 shots[]（导出 / 编辑用）
   */
  listShots: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().cuid(),
        grouped: z.boolean().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      await loadEpisodeOrThrow(ctx, input.episodeId);

      const shots = await ctx.prisma.shot.findMany({
        where: { episodeId: input.episodeId, deletedAt: null },
        orderBy: { positionIdx: 'asc' },
      });

      if (!input.grouped) return { shots };

      const groups = await ctx.prisma.shotGroup.findMany({
        where: { episodeId: input.episodeId, deletedAt: null },
        orderBy: { positionIdx: 'asc' },
      });

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
        groups: groups.map((g) => ({ ...g, shots: byGroup.get(g.id) ?? [] })),
        ungrouped,
      };
    }),

  createShot: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().cuid(),
        sceneId: z.string().cuid().optional(),
        number: z.string(),
        framing: z.string().optional(),
        angle: z.string().optional(),
        // W1-W5 audit P1 followup:W7 4 预设全收
        movement: z.string().max(50).optional(),
        lighting: z.string().max(50).optional(),
        content: z.string(),
        prompt: z.string().default(''),
        durationS: z.number().positive().default(3),
        priority: z.enum(['S', 'A', 'B', 'C']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId);

      // 自动取末位 positionIdx + 1
      const last = await ctx.prisma.shot.findFirst({
        where: { episodeId: ep.id },
        orderBy: { positionIdx: 'desc' },
      });
      const positionIdx = (last?.positionIdx ?? 0) + 1;

      const shot = await ctx.prisma.shot.create({
        data: {
          episodeId: ep.id,
          sceneId: input.sceneId,
          number: input.number,
          framing: input.framing,
          angle: input.angle,
          movement: input.movement,
          lighting: input.lighting,
          content: input.content,
          prompt: input.prompt,
          durationS: input.durationS,
          priority: input.priority,
          positionIdx,
        },
      });
      await logOperation(
        ctx,
        'shot.create',
        'shot',
        shot.id,
        null,
        { ...shot, projectId: ep.projectId },
      );
      return shot;
    }),

  updateShot: protectedProcedure
    .input(
      z.object({
        shotId: z.string().cuid(),
        patch: z
          .object({
            framing: z.string().optional(),
            angle: z.string().optional(),
            // W1-W5 audit P1 followup:W7 4 预设全收
            movement: z.string().max(50).nullable().optional(),
            lighting: z.string().max(50).nullable().optional(),
            content: z.string().optional(),
            prompt: z.string().optional(),
            durationS: z.number().positive().optional(),
            priority: z.enum(['S', 'A', 'B', 'C']).nullable().optional(),
          })
          .strict(),
        diffNote: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.shot.findUnique({
        where: { id: input.shotId },
        include: {
          episode: {
            select: { id: true, projectId: true, status: true, generatingStartedAt: true },
          },
        },
      });
      if (!before || !before.episode) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '分镜不存在' });
      }
      await assertProjectAccess(ctx, before.episode.projectId);
      // W1-W5 audit P1 followup(P1-2):本集 fresh GENERATING 时不允许改 shot,
      // 防 generateForEpisode 跑到一半被人改字段产生跨版本数据
      if (isEpisodeLockedNow(before.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,请等导演侧完成后再编辑(避免数据被覆盖)',
        });
      }

      const after = await ctx.prisma.shot.update({
        where: { id: input.shotId },
        data: input.patch,
      });

      // 关联当前剧本版本(scriptId)到训练数据 — ML pipeline 还原 prompt 上下文必需
      const currentScript = await ctx.prisma.script.findFirst({
        where: { episodeId: before.episodeId, isCurrent: true, deletedAt: null },
        select: { id: true },
      });

      // 把每个变化的字段都写成一条 PromptEdit 训练数据
      // recordPromptEdit 内部过滤：只记 framing/angle/content/prompt 等可训练字段
      for (const [field, newVal] of Object.entries(input.patch)) {
        if (newVal === undefined) continue;
        const oldVal = (before as unknown as Record<string, unknown>)[field];
        await recordPromptEdit(ctx, {
          targetType: 'SHOT',
          targetId: input.shotId,
          field,
          before: oldVal ?? '',
          after: newVal,
          diffNote: input.diffNote,
          projectId: before.episode.projectId,
          episodeId: before.episodeId,
          scriptId: currentScript?.id,
        });
      }

      // 若改了 durationS 且 shot 在某个 group 里 → 重算组总时长
      if (input.patch.durationS !== undefined && before.groupId) {
        const groupShots = await ctx.prisma.shot.findMany({
          where: { groupId: before.groupId, deletedAt: null },
          select: { durationS: true },
        });
        const total = groupShots.reduce((s, x) => s + x.durationS, 0);
        await ctx.prisma.shotGroup.update({
          where: { id: before.groupId },
          data: { durationS: total },
        });
      }

      await logOperation(
        ctx,
        'shot.update',
        'shot',
        after.id,
        { ...before, projectId: before.episode.projectId },
        { ...after, projectId: before.episode.projectId },
      );
      return after;
    }),

  deleteShot: protectedProcedure
    .input(z.object({ shotId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const shot = await ctx.prisma.shot.findFirst({
        where: { id: input.shotId, deletedAt: null },
        include: {
          episode: {
            select: { projectId: true, status: true, generatingStartedAt: true },
          },
        },
      });
      if (!shot || !shot.episode) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await assertProjectAccess(ctx, shot.episode.projectId);
      // W1-W5 audit P1 followup(P1-2):本集 fresh GENERATING 时不允许删 shot
      if (isEpisodeLockedNow(shot.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,请等导演侧完成后再删除分镜',
        });
      }

      // 联动清理 W4 AssetUsageBinding 指向本 shot 的引用,防止悬空 binding
      const now = new Date();
      await ctx.prisma.$transaction([
        ctx.prisma.shot.update({
          where: { id: input.shotId },
          data: { deletedAt: now },
        }),
        ctx.prisma.assetUsageBinding.updateMany({
          where: { shotId: input.shotId, deletedAt: null },
          data: { deletedAt: now },
        }),
      ]);
      await logOperation(
        ctx,
        'shot.delete',
        'shot',
        input.shotId,
        { ...shot, projectId: shot.episode.projectId },
        null,
      );
      return { ok: true };
    }),

  // -------- ShotGroup (合并组) --------

  /**
   * 合并若干 Shot 成一组
   * - 若 shots 已在其它组里，先解除
   * - 组的 positionIdx 取所选 shots 的最小 positionIdx
   * - 组的 number 用首尾镜号拼接（如 "1-8"）
   */
  mergeShots: protectedProcedure
    // 第 20 轮 audit / ADR-27:合并镜头改变 ShotGroup 结构,Mastra agent 需 confirm 防误操作
    .meta({
      agentTool: {
        description: '把 N 个相邻镜头(shotIds)合并到一个 ShotGroup,自动算 number=首-末',
        sideEffects: ['db.create:ShotGroup', 'db.update:Shot.groupId', 'OperationLog.write'],
        costEstimateCny: 0,
        requireConfirm: true,
      },
    })
    .input(
      z.object({
        shotIds: z.array(z.string().cuid()).min(2, '至少选 2 个镜头才能合并'),
        promptOverride: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 一次性按"id ∈ list AND 项目对当前用户可访问"过滤；
      // 任何 shot 缺失（不存在 / 跨项目 / 无权访问）都统一 NOT_FOUND，避免泄漏归属
      const shots = await ctx.prisma.shot.findMany({
        where: {
          id: { in: input.shotIds },
          deletedAt: null,
          episode: {
            deletedAt: null,
            project: {
              deletedAt: null,
              OR: [
                { ownerId: ctx.user.id },
                { members: { some: { userId: ctx.user.id } } },
              ],
            },
          },
        },
        include: {
          episode: {
            select: { projectId: true, status: true, generatingStartedAt: true },
          },
        },
      });
      if (shots.length !== input.shotIds.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '部分分镜不存在或无访问权限' });
      }
      const episodeIds = new Set(shots.map((s) => s.episodeId));
      if (episodeIds.size !== 1) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '只能合并同一集分镜' });
      }
      // r10 audit:防御性 narrow · 替代链式 ! non-null(若 prisma include 未返 episode 则给明确错而非运行时崩)
      const firstShot = shots[0];
      if (!firstShot || !firstShot.episode) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '分镜数据不完整(缺 episode 关联)— 可能数据异常,请刷新重试',
        });
      }
      const episodeId = firstShot.episodeId;
      const projectId = firstShot.episode.projectId;

      // W1-W5 audit P1 followup(P1-2):本集 fresh GENERATING 时不允许 merge
      if (isEpisodeLockedNow(firstShot.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,请等导演侧完成后再合并镜头',
        });
      }

      const sorted = [...shots].sort((a, b) => a.positionIdx - b.positionIdx);
      const firstNum = sorted[0]!.number;
      const lastNum = sorted[sorted.length - 1]!.number;
      const groupNumber = firstNum === lastNum ? firstNum : `${firstNum}-${lastNum}`;

      const totalDuration = sorted.reduce((s, x) => s + x.durationS, 0);

      // 默认提示词：组内 shots 的 prompt 拼接(用户后续可编辑)
      // 用户反馈 r3:[i/N] 标题 + prompt 同一行空格分隔(原本是 \n 换行)+ 段间用 \n 隔开
      // 格式:[1/N] framing angle prompt\n[2/N] framing angle prompt\n...
      const defaultPrompt =
        input.promptOverride ??
        sorted
          .map((s, i) => {
            const title = `[${i + 1}/${sorted.length}] ${s.framing ?? ''} ${s.angle ?? ''}`.replace(/\s+/g, ' ').trim();
            return `${title} ${s.prompt}`;
          })
          .join('\n');

      // 记录被选中 shots 当前所属的旧组 — 合并后这些组可能变空,需要清理
      const oldGroupIds = Array.from(
        new Set(shots.map((s) => s.groupId).filter((id): id is string => id !== null)),
      );

      // group.positionIdx 用 max+1 单调递增（含 soft-deleted）
      // advisory lock 保证读 max + create + 清空组的整个过程原子
      const group = await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext('storyboard_group:' || $1)::bigint)`,
          episodeId,
        );
        const lastGroup = await tx.shotGroup.findFirst({
          where: { episodeId },
          orderBy: { positionIdx: 'desc' },
        });
        const groupPositionIdx = (lastGroup?.positionIdx ?? 0) + 1;

        const g = await tx.shotGroup.create({
          data: {
            episodeId,
            number: groupNumber,
            positionIdx: groupPositionIdx,
            durationS: totalDuration,
            prompt: defaultPrompt,
          },
        });
        // 若选中的 shots 已在其它组，updateMany 直接覆盖 groupId 即可
        await tx.shot.updateMany({
          where: { id: { in: input.shotIds } },
          data: { groupId: g.id },
        });

        // 清理变空的旧组(剩 0 个 shot 的)
        if (oldGroupIds.length > 0) {
          const emptyOldGroups = await tx.shotGroup.findMany({
            where: {
              id: { in: oldGroupIds },
              deletedAt: null,
              shots: { none: { deletedAt: null } },
            },
            select: { id: true },
          });
          if (emptyOldGroups.length > 0) {
            await tx.shotGroup.updateMany({
              where: { id: { in: emptyOldGroups.map((x) => x.id) } },
              data: { deletedAt: new Date() },
            });
          }
        }

        return g;
      });

      await logOperation(ctx, 'shot_group.merge', 'shot_group', group.id, null, {
        shotIds: input.shotIds,
        number: groupNumber,
        projectId,
      });

      return group;
    }),

  /**
   * 解散一组 — soft-delete ShotGroup + 清 shots.groupId
   *
   * 不复用 Prisma 的 onDelete: SetNull（我们用 soft-delete 不真删行），
   * 因此必须手动 updateMany 清 groupId，且与 group soft-delete 同事务避免半成品状态。
   */
  splitGroup: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.prisma.shotGroup.findFirst({
        where: { id: input.groupId, deletedAt: null },
        include: {
          episode: {
            select: { projectId: true, status: true, generatingStartedAt: true },
          },
          shots: true,
        },
      });
      if (!group || !group.episode) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '合并组不存在或已删除' });
      }
      await assertProjectAccess(ctx, group.episode.projectId);
      // W1-W5 audit P1 followup(P1-2):本集 fresh GENERATING 时不允许拆组
      if (isEpisodeLockedNow(group.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,请等导演侧完成后再拆分合并组',
        });
      }

      // 用户反馈:在分镜组保存修改的 prompt,拆分时需同步到对应子镜
      // 按合并时的拼接格式 `[i/N] <标题行>\n<prompt 内容>` 反向解析
      // 解析失败(用户改乱了格式)→ fallback 保留 shot.prompt 原值
      const sortedShots = [...group.shots].sort((a, b) => a.positionIdx - b.positionIdx);
      const sectionUpdates = parseGroupPromptSections(group.prompt, sortedShots);

      await ctx.prisma.$transaction(async (tx) => {
        await tx.shotGroup.update({
          where: { id: input.groupId },
          data: { deletedAt: new Date() },
        });
        await tx.shot.updateMany({
          where: { groupId: input.groupId },
          data: { groupId: null },
        });
        // 解析成功(段数等于子镜数)才回写,否则保留原 shot.prompt
        if (sectionUpdates && sectionUpdates.length === sortedShots.length) {
          for (let i = 0; i < sortedShots.length; i++) {
            const newPrompt = sectionUpdates[i]!;
            if (newPrompt !== sortedShots[i]!.prompt) {
              await tx.shot.update({
                where: { id: sortedShots[i]!.id },
                data: { prompt: newPrompt },
              });
            }
          }
        }
      });

      await logOperation(
        ctx,
        'shot_group.split',
        'shot_group',
        input.groupId,
        { ...group, projectId: group.episode.projectId },
        null,
      );
      return {
        ok: true,
        shotCount: group.shots.length,
        promptSynced: sectionUpdates !== null,
      };
    }),

  updateGroup: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        patch: z
          .object({
            prompt: z.string().optional(),
            number: z.string().optional(),
          })
          .strict(),
        diffNote: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.shotGroup.findUnique({
        where: { id: input.groupId },
        include: {
          episode: {
            select: { projectId: true, status: true, generatingStartedAt: true },
          },
        },
      });
      if (!before || !before.episode) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await assertProjectAccess(ctx, before.episode.projectId);
      // W1-W5 audit P1 followup(P1-2):本集 fresh GENERATING 时不允许改 group
      if (isEpisodeLockedNow(before.episode)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,请等导演侧完成后再编辑合并组',
        });
      }

      const after = await ctx.prisma.shotGroup.update({
        where: { id: input.groupId },
        data: input.patch,
      });

      const currentScript = await ctx.prisma.script.findFirst({
        where: { episodeId: before.episodeId, isCurrent: true, deletedAt: null },
        select: { id: true },
      });

      for (const [field, newVal] of Object.entries(input.patch)) {
        if (newVal === undefined) continue;
        const oldVal = (before as unknown as Record<string, unknown>)[field];
        await recordPromptEdit(ctx, {
          targetType: 'SHOT_GROUP',
          targetId: input.groupId,
          field,
          before: oldVal ?? '',
          after: newVal,
          diffNote: input.diffNote,
          projectId: before.episode.projectId,
          episodeId: before.episodeId,
          scriptId: currentScript?.id,
        });
      }

      await logOperation(
        ctx,
        'shot_group.update',
        'shot_group',
        after.id,
        { ...before, projectId: before.episode.projectId },
        { ...after, projectId: before.episode.projectId },
      );
      return after;
    }),

  // -------- 生成（AI） --------

  /**
   * 整集生成分镜 — 调 LLM 把剧本拆为单镜 + 提示词
   *
   * 流程：
   *   1. 找到该集的当前剧本（含 Scene 拆解）
   *   2. 对每个 Scene 调 generateStoryboard()
   *   3. 单镜入库
   *   4. 若 autoMerge=true，调 mergeShots 算法预合并组
   *   5. 触发 EVENTS.STORYBOARD_GENERATED
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
      const presetRows = await ctx.prisma.systemSetting.findMany({
        where: {
          key: { in: ['preset.framing', 'preset.angle', 'preset.movement', 'preset.lighting'] },
        },
      });
      const presetMap = new Map(presetRows.map((s) => [s.key, s.value]));
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
        framing: parsePresetValue(presetMap.get('preset.framing')),
        angle: parsePresetValue(presetMap.get('preset.angle')),
        movement: parsePresetValue(presetMap.get('preset.movement')),
        lighting: parsePresetValue(presetMap.get('preset.lighting')),
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

          for (const s of result.shots) {
            globalIdx += 1;
            positionIdx += 1;
            const created = await ctx.prisma.shot.create({
              data: {
                episodeId: ep.id,
                sceneId: result.dbScene.id,
                number: String(globalIdx),
                framing: s.framing,
                angle: s.angle,
                movement: s.movement,
                lighting: s.lighting,
                content: s.content,
                prompt: s.prompt,
                durationS: s.durationS,
                priority: s.priority,
                positionIdx,
              },
            });
            createdShotIds.push(created.id);
          }

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

      // 7. 自动合并组（按 maxDurationS）
      //
      // 用 advisory lock 串行化同一 episode 的 group 写入，
      // 防两个并发 generate 各自读到 max positionIdx=10 → 都从 11 起,撞 unique。
      let createdGroupIds: string[] = [];
      if (bindings.autoMerge && createdShotIds.length > 0) {
        const allShots = await ctx.prisma.shot.findMany({
          where: { id: { in: createdShotIds }, deletedAt: null },
          orderBy: { positionIdx: 'asc' },
        });
        const merge = mergeShots(
          allShots.map<MergeableShot>((s) => ({
            id: s.id,
            number: s.number,
            durationS: s.durationS,
            framing: s.framing ?? undefined,
            angle: s.angle ?? undefined,
            content: s.content,
            prompt: s.prompt,
            positionIdx: s.positionIdx,
            priority: s.priority ?? undefined,
          })),
          {
            maxDurationS: bindings.maxDurationS,
            isolateSPriority: true,
          },
        );

        createdGroupIds = await ctx.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock(hashtext('storyboard_group:' || $1)::bigint)`,
            ep.id,
          );
          // 锁内读 max positionIdx,起点单调递增
          const lastExistingGroup = await tx.shotGroup.findFirst({
            where: { episodeId: ep.id },
            orderBy: { positionIdx: 'desc' },
          });
          let gIdx = lastExistingGroup?.positionIdx ?? 0;
          const ids: string[] = [];
          for (const g of merge.groups) {
            if (g.shots.length < 2) continue; // 单镜不建组
            gIdx += 1;
            const grp = await tx.shotGroup.create({
              data: {
                episodeId: ep.id,
                number: g.number,
                positionIdx: gIdx,
                durationS: g.durationS,
                prompt: g.mergedPrompt,
              },
            });
            await tx.shot.updateMany({
              where: { id: { in: g.shots.map((x) => x.id) } },
              data: { groupId: grp.id },
            });
            ids.push(grp.id);
          }
          return ids;
        });
      }

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
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext('episode_publish:' || $1)::bigint)`,
          ep.id,
        );
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
});
