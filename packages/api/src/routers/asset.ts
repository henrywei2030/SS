/**
 * Asset Router — 美术工作台(W4)
 *
 * 子模块:
 *   - 列表 / 详情 / 创建 / 更新 / 删除
 *   - 从剧本批量拆解(LLM)
 *   - 图像生成(占位 W4.5)
 *   - 合规检查(占位 W4.6)
 *
 * 训练集采集:对 description / prompt / name / alias 等字段的手改自动入 PromptEdit
 * (target=ASSET)。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  breakdownAssets,
  type AssetDraft,
  compileAssetPrompt,
  type GenerationSlot,
} from '@ss/core/asset';
import { getImageProvider } from '@ss/adapters/provider';
import { getEventBus } from '@ss/adapters/eventbus';
// 第 18 轮 audit P1:errMsg 入库 + throw 前脱敏,防真接 NanoBanana / GPT Image 后泄漏 URL/token
// 第 19 轮 audit P1:加 EventBus publish(ASSET_GENERATED / ASSET_CONFIRMED),events.ts 定义但漏调
import { sanitizeErrorMsg, EVENTS } from '@ss/shared';

import { router, protectedProcedure } from '../trpc.js';
import type { Context } from '../context.js';
import { logOperation } from '../middleware/audit.js';

// ---------------------------------------------------------------------------
// 通用
// ---------------------------------------------------------------------------

// W7+ audit R10:assertProjectAccess 抽到 middleware/access.ts(原 5 router 各一份)
import { assertProjectAccess } from '../middleware/access.js';

async function loadAssetWithAccess(ctx: Context, assetId: string) {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const asset = await ctx.prisma.asset.findFirst({
    where: { id: assetId, deletedAt: null },
  });
  if (!asset) throw new TRPCError({ code: 'NOT_FOUND', message: '资产不存在' });
  await assertProjectAccess(ctx, asset.projectId);
  return asset;
}

// ---------------------------------------------------------------------------
// PromptEdit — 资产文本字段训练集采集
// 训练字段从 @ss/shared 拉,跟 storyboard.ts 同源
// ---------------------------------------------------------------------------

import { TRAINABLE_TEXT_FIELDS as TRAINABLE_TEXT_FIELD_LIST } from '@ss/shared';
const TRAINABLE_ASSET_FIELDS = new Set<string>(TRAINABLE_TEXT_FIELD_LIST);

async function recordAssetEdit(
  ctx: Context,
  args: {
    assetId: string;
    field: string;
    before: unknown;
    after: unknown;
    projectId: string;
    diffNote?: string;
  },
): Promise<void> {
  if (!ctx.user) return;
  if (!TRAINABLE_ASSET_FIELDS.has(args.field)) return;
  if (typeof args.before !== 'string' || typeof args.after !== 'string') return;
  if (args.before === args.after) return;
  try {
    await ctx.prisma.promptEdit.create({
      data: {
        targetType: 'ASSET',
        targetId: args.assetId,
        field: args.field,
        before: args.before,
        after: args.after,
        diffNote: args.diffNote,
        projectId: args.projectId,
        userId: ctx.user.id,
      },
    });
  } catch (e) {
    console.error('[assetEdit] PromptEdit write failed:', {
      assetId: args.assetId,
      field: args.field,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ---------------------------------------------------------------------------
// 输入 schema
// ---------------------------------------------------------------------------

const AssetTypeSchema = z.enum(['CHARACTER', 'SCENE', 'PROP', 'STYLE_REFERENCE']);
const CharacterRoleSchema = z.enum([
  '主演-男主',
  '主演-女主',
  '主演-反派',
  '配角-正派',
  '配角-反派',
  '配角-中性',
  '群演',
]);

const DraftInputSchema = z.object({
  type: AssetTypeSchema,
  name: z.string().min(1).max(100),
  alias: z.array(z.string().max(50)).max(5).default([]),
  description: z.string().max(2000).default(''),
  prompt: z.string().min(1).max(5000),
  characterRole: CharacterRoleSchema.optional(),
  tags: z.array(z.string().max(50)).max(20).default([]),
  styleId: z.string().cuid().optional(),
  archetypeKey: z.string().max(100).optional(),
  importance: z.enum(['S', 'A', 'B', 'C']).optional(),
});

const SlotSchema = z.enum([
  'portrait',
  'three_view',
  'scene_main',
  'scene_front',
  'scene_left',
  'scene_right',
  'scene_back',
  'panorama',
  'main',
  'detail',
  'reference',
]);

const UsageTypeSchema = z.enum([
  'APPEAR',
  'SPEAK',
  'HOLD',
  'WEAR',
  'ENVIRONMENT',
  'BACKGROUND',
  'SOUND_BG',
  'SOUND_VOICE',
  'THEME',
  'REFERENCE',
]);

// ---------------------------------------------------------------------------
// 槽位写入 + 成熟度计算
// ---------------------------------------------------------------------------

/** slot → Asset 上对应字段名 */
const SLOT_FIELD: Record<z.infer<typeof SlotSchema>, string> = {
  portrait: 'portraitMediaId',
  three_view: 'threeViewMediaId',
  scene_main: 'sceneMainMediaId',
  scene_front: 'sceneFrontMediaId',
  scene_left: 'sceneLeftMediaId',
  scene_right: 'sceneRightMediaId',
  scene_back: 'sceneBackMediaId',
  panorama: 'panoramaMediaId',
  main: 'mainMediaId',
  detail: 'mainMediaId', // detail 用作 main 的别名(暂)
  reference: 'mainMediaId', // 不该被用作槽位 confirm,先指 main
};

/**
 * 根据已填槽位 + 合规状态计算 L0-L5
 *
 * - L0:无任何字段
 * - L1:有 prompt
 * - L2:有任意候选(GenerationAttempt 存在,但前端先简化为槽位还未填)
 * - L3:对应 type 的主槽位已填(人物=portrait / 场景=sceneMain or mainMedia / 道具=main)
 * - L4:一致性槽位齐(人物=portrait+threeView / 场景=mainMedia+至少一个 front/left/right/back / 道具=main)
 * - L5:complianceStatus=APPROVED + L4 满足(人物);非人物只要 L4 满足
 */
function computeMaturity(asset: {
  type: string;
  prompt: string;
  portraitMediaId: string | null;
  threeViewMediaId: string | null;
  sceneMainMediaId: string | null;
  sceneFrontMediaId: string | null;
  sceneLeftMediaId: string | null;
  sceneRightMediaId: string | null;
  sceneBackMediaId: string | null;
  panoramaMediaId: string | null;
  mainMediaId: string | null;
  complianceStatus: string;
}):
  | 'L0_IDENTIFIED'
  | 'L1_PROMPT_READY'
  | 'L2_CANDIDATE'
  | 'L3_MAIN_CONFIRMED'
  | 'L4_CONSISTENCY_READY'
  | 'L5_PRODUCTION_READY' {
  if (!asset.prompt.trim()) return 'L0_IDENTIFIED';

  const hasMain =
    asset.type === 'CHARACTER'
      ? !!asset.portraitMediaId
      : asset.type === 'SCENE'
        ? !!asset.sceneMainMediaId || !!asset.mainMediaId
        : !!asset.mainMediaId;

  if (!hasMain) return 'L1_PROMPT_READY';

  const consistencyReady =
    asset.type === 'CHARACTER'
      ? !!asset.threeViewMediaId
      : asset.type === 'SCENE'
        ? !!asset.sceneFrontMediaId ||
          !!asset.sceneLeftMediaId ||
          !!asset.sceneRightMediaId ||
          !!asset.sceneBackMediaId ||
          !!asset.panoramaMediaId
        : true; // 道具 / 风格只要主图即可

  if (!consistencyReady) return 'L3_MAIN_CONFIRMED';

  if (asset.type === 'CHARACTER' && asset.complianceStatus !== 'APPROVED') {
    return 'L4_CONSISTENCY_READY';
  }
  return 'L5_PRODUCTION_READY';
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const assetRouter = router({
  /** 列出资产 — 按 type 过滤,附 MediaItem URL map(避免前端 N+1 查) */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        type: AssetTypeSchema.optional(),
        includeDeleted: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const assets = await ctx.prisma.asset.findMany({
        where: {
          projectId: input.projectId,
          ...(input.type && { type: input.type }),
          ...(input.includeDeleted ? {} : { deletedAt: null }),
        },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      });

      // 收集所有 mediaId 一次 batch 查
      const mediaIds = new Set<string>();
      for (const a of assets) {
        for (const id of [
          a.portraitMediaId,
          a.threeViewMediaId,
          a.sceneMainMediaId,
          a.sceneFrontMediaId,
          a.sceneLeftMediaId,
          a.sceneRightMediaId,
          a.sceneBackMediaId,
          a.panoramaMediaId,
          a.mainMediaId,
        ]) {
          if (id) mediaIds.add(id);
        }
      }
      const medias =
        mediaIds.size > 0
          ? await ctx.prisma.mediaItem.findMany({
              where: { id: { in: Array.from(mediaIds) } },
              select: {
                id: true,
                storageKey: true,
                cdnUrl: true,
                aspectRatio: true,
                viewKind: true,
              },
            })
          : [];
      const mediaMap: Record<string, (typeof medias)[number]> = {};
      for (const m of medias) mediaMap[m.id] = m;

      return { assets, mediaMap };
    }),

  /** 详情(含所有 slot 关联的 MediaItem,前端可直接渲染图片) */
  get: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);

      const slotIds = [
        asset.portraitMediaId,
        asset.threeViewMediaId,
        asset.sceneMainMediaId,
        asset.sceneFrontMediaId,
        asset.sceneLeftMediaId,
        asset.sceneRightMediaId,
        asset.sceneBackMediaId,
        asset.panoramaMediaId,
        asset.mainMediaId,
      ].filter((id): id is string => !!id);

      const medias =
        slotIds.length > 0
          ? await ctx.prisma.mediaItem.findMany({
              where: { id: { in: slotIds } },
              select: {
                id: true,
                storageKey: true,
                cdnUrl: true,
                aspectRatio: true,
                viewKind: true,
              },
            })
          : [];
      const mediaMap: Record<string, (typeof medias)[number]> = {};
      for (const m of medias) mediaMap[m.id] = m;

      return Object.assign(asset, { mediaMap });
    }),

  /** 单个手动创建 */
  create: protectedProcedure
    // 第 19 轮 audit / ADR-26+27:Mastra agent 自动注册接入点
    .meta({
      agentTool: {
        description: '创建一个新的美术资产(角色/场景/道具/特效)',
        sideEffects: ['db.create:Asset', 'OperationLog.write'],
        costEstimateCny: 0,
        requireConfirm: false,
      },
    })
    .input(
      DraftInputSchema.extend({
        projectId: z.string().cuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      // 同项目同名重复检测(防分镜 @ 匹配混乱)
      const dup = await ctx.prisma.asset.findFirst({
        where: { projectId: input.projectId, name: input.name, deletedAt: null },
      });
      if (dup) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `项目内已存在同名资产 "${input.name}",请用 alias 区分或改名`,
        });
      }

      const { projectId, ...rest } = input;
      const asset = await ctx.prisma.asset.create({
        data: { projectId, ...rest },
      });
      await logOperation(ctx, 'asset.create', 'asset', asset.id, null, asset);
      return asset;
    }),

  /** 批量创建 — 拆解结果一次性入库,跳过重名 */
  batchCreate: protectedProcedure
    // 第 20 轮 audit / ADR-27:批量创建(从 breakdown 草稿一次性入库)
    .meta({
      agentTool: {
        description: '批量创建美术资产(从 LLM breakdown 草稿一次性入库,最多 100 个)',
        sideEffects: ['db.createMany:Asset', 'OperationLog.write'],
        costEstimateCny: 0,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        projectId: z.string().cuid(),
        drafts: z.array(DraftInputSchema).min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      // 先查同项目已有 name 集合,跳过重名
      const existing = await ctx.prisma.asset.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        select: { name: true },
      });
      const existingNames = new Set(existing.map((a) => a.name));

      // W7 audit R7:从串行 create N 次改 createManyAndReturn,~50× 加速
      const toCreate = input.drafts.filter((d) => {
        if (existingNames.has(d.name)) return false;
        existingNames.add(d.name);
        return true;
      });
      const skipped: string[] = input.drafts
        .filter((d) => !toCreate.some((c) => c.name === d.name))
        .map((d) => d.name);
      const created =
        toCreate.length > 0
          ? await ctx.prisma.asset.createManyAndReturn({
              data: toCreate.map((d) => ({ projectId: input.projectId, ...d })),
              select: { id: true, name: true, type: true },
            })
          : [];

      await logOperation(ctx, 'asset.batchCreate', 'asset', input.projectId, null, {
        projectId: input.projectId,
        createdCount: created.length,
        skippedCount: skipped.length,
        skippedNames: skipped,
      });

      return { created, skipped };
    }),

  /** 更新字段 — 任意可改字段都接,文本字段改动自动入 PromptEdit */
  update: protectedProcedure
    .input(
      z.object({
        assetId: z.string().cuid(),
        patch: z
          .object({
            name: z.string().min(1).max(100).optional(),
            alias: z.array(z.string().max(50)).max(5).optional(),
            description: z.string().max(2000).optional(),
            prompt: z.string().min(1).max(5000).optional(),
            characterRole: CharacterRoleSchema.nullable().optional(),
            tags: z.array(z.string().max(50)).max(20).optional(),
            styleId: z.string().cuid().nullable().optional(),
            archetypeKey: z.string().max(100).nullable().optional(),
            importance: z.enum(['S', 'A', 'B', 'C']).nullable().optional(),
            voiceMediaId: z.string().cuid().nullable().optional(),
            voiceModelId: z.string().max(100).nullable().optional(),
            refImageIds: z.array(z.string().cuid()).optional(),
            mainMediaId: z.string().cuid().nullable().optional(),
            status: z.enum(['DRAFT', 'CANDIDATE', 'CONFIRMED', 'RETIRED']).optional(),
          })
          .strict(),
        diffNote: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await loadAssetWithAccess(ctx, input.assetId);

      // 锁定的资产不允许直接改 prompt / name / description(改 prompt 等关键字段要走"新版本"流程)
      if (before.lockedAt) {
        const blockedFields = ['name', 'prompt', 'description', 'characterRole'];
        const blocked = blockedFields.filter(
          (f) => (input.patch as Record<string, unknown>)[f] !== undefined,
        );
        if (blocked.length > 0) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `资产已锁定,字段 [${blocked.join(', ')}] 不可直接修改;请先解锁或创建新变体`,
          });
        }
      }

      // 若改了 prompt 或任何槽位字段,联动重算 maturity — 与 patch 同事务一次写入
      // 防"先 update patch → 再 update maturity"中间他人 confirm 把 maturity 覆盖
      const slotFieldNames = Object.values(SLOT_FIELD);
      const touchesPromptOrSlot =
        input.patch.prompt !== undefined ||
        Object.keys(input.patch).some((k) => slotFieldNames.includes(k));

      // 7 轮 audit A5:name 重复检测必须在 transaction 内,防 TOCTOU(check 通过后,
      // 另一并发 update 写入同 name,本 update 也写入,致同项目同 name 双行)
      const after = await ctx.prisma.$transaction(async (tx) => {
        if (input.patch.name && input.patch.name !== before.name) {
          const dup = await tx.asset.findFirst({
            where: {
              projectId: before.projectId,
              name: input.patch.name,
              deletedAt: null,
              id: { not: before.id },
            },
          });
          if (dup) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `项目内已存在同名资产 "${input.patch.name}"`,
            });
          }
        }
        const fresh = await tx.asset.findFirstOrThrow({
          where: { id: input.assetId, deletedAt: null },
        });
        const projected = {
          ...fresh,
          ...input.patch,
        } as Parameters<typeof computeMaturity>[0];
        const maturityUpdate = touchesPromptOrSlot
          ? { maturity: computeMaturity(projected) }
          : {};
        return tx.asset.update({
          where: { id: input.assetId },
          data: { ...input.patch, ...maturityUpdate },
        });
      });

      // 文本字段改动入训练集
      for (const [field, newVal] of Object.entries(input.patch)) {
        if (newVal === undefined) continue;
        const oldVal = (before as unknown as Record<string, unknown>)[field];
        await recordAssetEdit(ctx, {
          assetId: input.assetId,
          field,
          before: oldVal ?? '',
          after: newVal,
          projectId: before.projectId,
          diffNote: input.diffNote,
        });
      }

      await logOperation(ctx, 'asset.update', 'asset', after.id, before, after);
      return after;
    }),

  /** 软删 — 联动软删该 asset 所有 AssetUsageBinding(防 audit 永远报悬空) */
  delete: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      const now = new Date();
      await ctx.prisma.$transaction([
        ctx.prisma.asset.update({
          where: { id: input.assetId },
          data: { deletedAt: now },
        }),
        ctx.prisma.assetUsageBinding.updateMany({
          where: { assetId: input.assetId, deletedAt: null },
          data: { deletedAt: now },
        }),
      ]);
      await logOperation(ctx, 'asset.delete', 'asset', input.assetId, asset, null);
      return { ok: true };
    }),

  /**
   * 从剧本拆解资产 — 调 LLM
   *
   * 不直接入库,返回 drafts 给前端预览。前端用户审阅后再调 batchCreate。
   * (避免 LLM 乱拆把脏数据直接写库,人工把关一遍)
   */
  breakdown: protectedProcedure
    // 第 20 轮 audit / ADR-27:LLM 调用,有真成本,Mastra agent 需 budget 决策
    .meta({
      agentTool: {
        description: '调 Claude/豆包 从剧本拆解出角色/场景/道具/特效,返回草稿(不入库)',
        sideEffects: ['extern.api:TextProvider', 'cost.deduct', 'db.create:GenerationAttempt'],
        costEstimateCny: 0.3,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        projectId: z.string().cuid(),
        scriptId: z.string().cuid().optional(),
        episodeId: z.string().cuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      // 取剧本 — 优先 scriptId,其次 episodeId 的 isCurrent,最后整剧 isCurrent
      const script = input.scriptId
        ? await ctx.prisma.script.findFirst({
            where: {
              id: input.scriptId,
              projectId: input.projectId,
              deletedAt: null,
            },
          })
        : input.episodeId
          ? await ctx.prisma.script.findFirst({
              where: {
                episodeId: input.episodeId,
                projectId: input.projectId,
                isCurrent: true,
                deletedAt: null,
              },
            })
          : await ctx.prisma.script.findFirst({
              where: {
                projectId: input.projectId,
                isCurrent: true,
                deletedAt: null,
              },
              orderBy: { createdAt: 'desc' },
            });

      if (!script) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '未找到可拆解的剧本(请先上传剧本)',
        });
      }

      // 取项目类型 + 风格
      const project = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
        include: { style: true },
      });

      // 读绑定 model + maxCharacters
      const settings = await ctx.prisma.systemSetting.findMany({
        where: {
          key: {
            in: ['binding.asset.breakdown.modelId', 'asset.breakdown.maxCharacters'],
          },
        },
      });
      const map = new Map(settings.map((s) => [s.key, s.value]));
      // 二十收工后用户反馈:不 hardcode 默认 provider,binding 空时显式拒绝
      const modelId = map.get('binding.asset.breakdown.modelId') ?? '';
      if (!modelId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '资产拆解未配置 LLM Provider — 请去 /admin/bindings 选择 binding.asset.breakdown.modelId',
        });
      }
      const maxCharacters = Number(map.get('asset.breakdown.maxCharacters') ?? '20');

      // W1-W5 audit P0(B1):写 GenerationAttempt(action=TEXT),Phase 1 资产拆解扣费回溯链路
      const attemptStartedAt = new Date();
      const attempt = await ctx.prisma.generationAttempt.create({
        data: {
          projectId: input.projectId,
          episodeId: input.episodeId,
          providerId: modelId,
          modelId,
          action: 'TEXT',
          inputJson: {
            kind: 'asset.breakdown',
            scriptId: script.id,
            projectType: project?.type,
            styleSlug: project?.style?.slug,
            maxCharacters,
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

      let result;
      try {
        result = await breakdownAssets({
          scriptText: script.content,
          projectType: project?.type,
          styleSlug: project?.style?.slug,
          modelId,
          maxCharacters,
          ctx: {
            userId: ctx.user.id,
            projectId: input.projectId,
            episodeId: input.episodeId,
            attemptId: attempt.id,
          },
        });
      } catch (e) {
        const finishedAt = new Date();
        // 第 18 轮 audit P1:errMsg 入 attempt.errorMsg + TRPCError + log 前脱敏
        console.error('[asset.breakdown] LLM failed (raw):', e);
        const errMsg = sanitizeErrorMsg(e);
        await ctx.prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'FAILED',
            errorMsg: errMsg,
            finishedAt,
            durationMs: finishedAt.getTime() - attemptStartedAt.getTime(),
          },
        });
        await logOperation(ctx, 'asset.breakdown.failed', 'project', input.projectId, null, {
          error: errMsg,
          scriptId: script.id,
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: errMsg || '资产拆解失败',
          cause: e, // W7 audit R9
        });
      }

      const finishedAt = new Date();
      await ctx.prisma.generationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: result.warning ? 'FAILED' : 'SUCCESS',
          errorMsg: result.warning ?? null,
          costCny: result.cost.toFixed(4),
          finishedAt,
          durationMs: finishedAt.getTime() - attemptStartedAt.getTime(),
        },
      });

      await logOperation(ctx, 'asset.breakdown', 'project', input.projectId, null, {
        scriptId: script.id,
        characters: result.characters.length,
        scenes: result.scenes.length,
        props: result.props.length,
        cost: result.cost,
        modelId,
      });

      // 把 drafts 标记 type(给前端 batchCreate 时复用)
      const charactersTyped: AssetDraft[] = result.characters;
      const scenesTyped: AssetDraft[] = result.scenes;
      const propsTyped: AssetDraft[] = result.props;

      return {
        characters: charactersTyped.map((d) => ({ ...d, type: 'CHARACTER' as const })),
        scenes: scenesTyped.map((d) => ({ ...d, type: 'SCENE' as const })),
        props: propsTyped.map((d) => ({ ...d, type: 'PROP' as const })),
        cost: result.cost,
        modelId,
        scriptId: script.id,
        warning: result.warning,
      };
    }),

  /**
   * 编译资产 prompt — 给前端"预览最终送图像模型的完整 prompt"用
   * 不调 LLM,纯函数计算,可频繁调
   */
  compilePrompt: protectedProcedure
    .input(
      z.object({
        assetId: z.string().cuid(),
        slot: SlotSchema.optional(),
        extraInstruction: z.string().max(500).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      const style = asset.styleId
        ? await ctx.prisma.styleProfile.findUnique({ where: { id: asset.styleId } })
        : null;
      // 项目默认风格
      const project = !style
        ? await ctx.prisma.project.findUnique({
            where: { id: asset.projectId },
            include: { style: true },
          })
        : null;
      const effectiveStyle = style ?? project?.style ?? null;

      return compileAssetPrompt({
        asset: {
          type: asset.type as 'CHARACTER' | 'SCENE' | 'PROP' | 'STYLE_REFERENCE',
          name: asset.name,
          description: asset.description,
          prompt: asset.prompt,
          archetypeKey: asset.archetypeKey,
        },
        style: effectiveStyle,
        slot: input.slot,
        extraInstruction: input.extraInstruction,
      });
    }),

  /**
   * [W4-MM mock 实现] 图像生成 — 留 W4-MM.6 接真实 ImageProvider
   *
   * 当前行为:
   *   1. 用 compileAssetPrompt 拼接最终 prompt(展示在 GenerationAttempt.inputJson)
   *   2. 创建 GenerationAttempt(action=IMAGE,candidateForSlot=slot,status=SUCCESS)
   *   3. 创建占位 MediaItem(storageKey 用 placeholder://,前端展示占位图)
   *   4. 不真扣费(unitPrice=0)
   *
   * W4-MM.6 替换:把占位换成真实 ImageProvider.generate() + MinIO 上传 + storageKey
   */
  generateImage: protectedProcedure
    // 第 19 轮 audit / ADR-27:扣费 + 调外部 Provider,Mastra agent 调用需 budget 决策
    .meta({
      agentTool: {
        description: '为资产某槽位(portrait / threeView 等)抽卡生成参考图,调 NanoBanana/GPT-Image/豆包',
        sideEffects: [
          'extern.api:ImageProvider',
          'cost.deduct',
          'db.create:GenerationAttempt',
          'db.create:MediaItem',
          'db.create:CostLedgerEntry',
        ],
        costEstimateCny: 0.5,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        assetId: z.string().cuid(),
        slot: SlotSchema,
        count: z.number().int().min(1).max(4).default(1),
        modelId: z.string().max(100).optional(),
        aspectRatio: z.string().max(20).optional(),
        sizePx: z.string().max(20).optional(),
        extraInstruction: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);

      // 项目风格
      const project = await ctx.prisma.project.findUnique({
        where: { id: asset.projectId },
        include: { style: true },
      });

      // 读 binding
      const settings = await ctx.prisma.systemSetting.findMany({
        where: {
          key: {
            in: ['binding.asset.image.providerId', 'binding.asset.panorama.providerId'],
          },
        },
      });
      const settingMap = new Map(settings.map((s) => [s.key, s.value]));
      // 二十收工后用户反馈:不 hardcode 默认 provider,binding 空时显式拒绝(input.modelId 优先,测试调试用)
      const providerId =
        input.modelId ??
        (input.slot === 'panorama'
          ? settingMap.get('binding.asset.panorama.providerId') ?? ''
          : settingMap.get('binding.asset.image.providerId') ?? '');
      if (!providerId) {
        const bindingKey = input.slot === 'panorama'
          ? 'binding.asset.panorama.providerId'
          : 'binding.asset.image.providerId';
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `资产${input.slot === 'panorama' ? '全景图' : '图像'}生成未配置 Image Provider — 请去 /admin/bindings 选择 ${bindingKey}(或在调用时传 input.modelId 显式指定)`,
        });
      }

      const compiled = compileAssetPrompt({
        asset: {
          type: asset.type as 'CHARACTER' | 'SCENE' | 'PROP' | 'STYLE_REFERENCE',
          name: asset.name,
          description: asset.description,
          prompt: asset.prompt,
          archetypeKey: asset.archetypeKey,
        },
        style: project?.style ?? null,
        slot: input.slot,
        extraInstruction: input.extraInstruction,
      });

      const aspectRatio =
        input.aspectRatio ??
        (input.slot === 'portrait'
          ? '9:16'
          : input.slot === 'three_view'
            ? '16:9'
            : input.slot === 'panorama'
              ? '2:1'
              : '1:1');

      // 调 ImageProvider(W4-MM.6 真接入,当前 MockImageProvider 走 picsum.photos)
      const startedAt = new Date();
      let imageResult;
      try {
        const provider = await getImageProvider(providerId);
        imageResult = await provider.generate(
          {
            prompt: compiled.positive,
            count: input.count,
            aspectRatio,
            mode: input.slot === 'three_view' ? 'three_view' : input.slot === 'panorama' ? 'panorama_360' : 'standard',
            model: input.modelId,
          },
          {
            userId: ctx.user.id,
            projectId: asset.projectId,
            assetId: asset.id,
            // W1-W5 audit P1 followup:防 ImageProvider 内置 ledger + router 双写。
            // 真接 NanoBanana / GPT Image 时这条防 cost 翻倍。router 用真实
            // imageResult.imageUrls.length 算 outputUnits + realUnitPriceCny。
            skipLedger: true,
          },
        );
      } catch (e) {
        // W1-W5 audit P0(B2):失败路径也必须留 attempt + ledger 行,
        // 否则抽卡率(成功 / (成功+失败))分母会缺,Phase 2 ROI 监控失真
        const failedAt = new Date();
        // 第 18 轮 audit P1:errMsg 入库 + throw 前脱敏(防真接 Provider 后泄漏 URL/token)
        // 原始 e 通过 TRPCError.cause 透传,服务端日志仍可见
        console.error('[asset.generateImage] provider failed (raw):', e);
        const errMsg = sanitizeErrorMsg(e);
        const failedAttempt = await ctx.prisma.generationAttempt.create({
          data: {
            projectId: asset.projectId,
            assetId: asset.id,
            providerId,
            modelId: input.modelId ?? providerId,
            action: 'IMAGE',
            candidateForSlot: input.slot,
            inputJson: {
              prompt: compiled.positive,
              negative: compiled.negative,
              aspectRatio,
              sizePx: input.sizePx,
              count: input.count,
            },
            outputMediaIds: [],
            inputUnits: 0,
            outputUnits: 0,
            unitPriceCny: '0',
            costCny: '0',
            status: 'FAILED',
            errorMsg: errMsg,
            startedAt,
            finishedAt: failedAt,
            durationMs: failedAt.getTime() - startedAt.getTime(),
            createdBy: ctx.user.id,
          },
        });
        await ctx.prisma.costLedgerEntry.create({
          data: {
            userId: ctx.user.id,
            projectId: asset.projectId,
            assetId: asset.id,
            attemptId: failedAttempt.id,
            providerId,
            modelId: input.modelId ?? providerId,
            action: 'image.generate',
            inputUnits: 0,
            outputUnits: 0,
            unitPriceCny: '0',
            costCny: '0',
            success: false,
            billingCycle: new Date().toISOString().slice(0, 7),
          },
        });

        await logOperation(ctx, 'asset.generateImage.failed', 'asset', asset.id, null, {
          error: errMsg,
          providerId,
          slot: input.slot,
          projectId: asset.projectId,
          attemptId: failedAttempt.id,
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `图像生成失败: ${errMsg}`,
          cause: e, // W7 audit R9
        });
      }
      const finishedAt = new Date();

      // W1-W5 audit P0(B3):从 imageResult 反推真单价,不再硬编码 '0',
      // Phase 2 真 ImageProvider 接入后对账才不会全错
      const realUnitPriceCny =
        imageResult.imageUrls.length > 0
          ? (imageResult.costCny / imageResult.imageUrls.length).toFixed(6)
          : '0';

      // 三类写入(MediaItem×N + GenerationAttempt + CostLedgerEntry)用同一事务
      // 任一失败回滚全部 — 防出现"图片入库但没账单"或"账单但找不到图"
      const safeName = asset.name
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .slice(0, 40);
      const { mediaIds, attempt } = await ctx.prisma.$transaction(async (tx) => {
        const createdMedias = await Promise.all(
          imageResult.imageUrls.map((url, i) =>
            tx.mediaItem.create({
              data: {
                projectId: asset.projectId,
                scope: 'PROJECT',
                kind: 'IMAGE',
                filename: `${safeName}-${input.slot}-${startedAt.getTime()}-${i}.png`,
                mimeType: 'image/png',
                sizeBytes:
                  imageResult.width && imageResult.height
                    ? Math.round(imageResult.width * imageResult.height * 0.5)
                    : 0,
                storageKey: url.startsWith('http')
                  ? `placeholder://external?u=${encodeURIComponent(url)}`
                  : url,
                cdnUrl: url,
                meta: {
                  slot: input.slot,
                  prompt: compiled.positive,
                  negative: compiled.negative,
                  width: imageResult.width,
                  height: imageResult.height,
                  providerId,
                  modelId: input.modelId ?? providerId,
                },
                aspectRatio,
                viewKind: input.slot,
                source: 'AIGC',
                sourceRef: asset.id,
              },
            }),
          ),
        );
        const ids = createdMedias.map((m) => m.id);
        const attemptRow = await tx.generationAttempt.create({
          data: {
            projectId: asset.projectId,
            assetId: asset.id,
            providerId,
            modelId: input.modelId ?? providerId,
            action: 'IMAGE',
            candidateForSlot: input.slot,
            inputJson: {
              prompt: compiled.positive,
              negative: compiled.negative,
              aspectRatio,
              sizePx: input.sizePx,
              count: input.count,
              parts: compiled.parts,
            },
            outputMediaId: ids[0],
            outputMediaIds: ids,
            inputUnits: 0,
            outputUnits: imageResult.imageUrls.length,
            unitPriceCny: realUnitPriceCny,
            costCny: imageResult.costCny.toFixed(4),
            status: 'SUCCESS',
            startedAt,
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            createdBy: ctx.user.id,
          },
        });
        // Cost Ledger 同事务双写,失败回滚 attempt + medias
        await tx.costLedgerEntry.create({
          data: {
            userId: ctx.user.id,
            projectId: asset.projectId,
            assetId: asset.id,
            attemptId: attemptRow.id,
            providerId,
            modelId: input.modelId ?? providerId,
            action: 'image.generate',
            inputUnits: 0,
            outputUnits: imageResult.imageUrls.length,
            unitPriceCny: realUnitPriceCny,
            costCny: imageResult.costCny.toFixed(4),
            success: true,
            billingCycle: new Date().toISOString().slice(0, 7),
          },
        });
        return { mediaIds: ids, attempt: attemptRow };
      });

      await logOperation(ctx, 'asset.generateImage', 'asset', asset.id, null, {
        slot: input.slot,
        count: imageResult.imageUrls.length,
        providerId,
        aspectRatio,
        cost: imageResult.costCny,
        projectId: asset.projectId,
      });

      // 第 19 轮 audit P1:真 publish ASSET_GENERATED(events.ts 定义但 router 漏调)
      // 每个 mediaId 推一条,订阅方按 mediaItemId 跟踪
      for (const mediaId of mediaIds) {
        await getEventBus()
          .publish(
            EVENTS.ASSET_GENERATED,
            { assetId: asset.id, version: 0, mediaItemId: mediaId },
            { publisherId: 'asset.generateImage' },
          )
          .catch((err) => {
            console.error('[asset.generateImage] eventbus publish failed:', err);
          });
      }

      // 为 UI 方便,返回 candidates 数组(每张图对应一个伪 attempt — 实际 1 个 attempt 多图)
      const candidates = mediaIds.map((mediaId) => ({
        mediaId,
        attemptId: attempt.id,
      }));

      return {
        candidates,
        providerId,
        aspectRatio,
        compiledPrompt: compiled,
        cost: imageResult.costCny,
      };
    }),

  // -------- 候选管理 --------

  /** 列出某资产的所有候选(GenerationAttempt + 关联 MediaItem),按 slot 过滤 */
  listCandidates: protectedProcedure
    .input(
      z.object({
        assetId: z.string().cuid(),
        slot: SlotSchema.optional(),
        includeRejected: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      const attempts = await ctx.prisma.generationAttempt.findMany({
        where: {
          assetId: asset.id,
          action: 'IMAGE',
          ...(input.slot && { candidateForSlot: input.slot }),
          ...(input.includeRejected ? {} : { rejected: false }),
        },
        orderBy: { createdAt: 'desc' },
      });

      // 取关联的 MediaItem
      const mediaIds = attempts
        .flatMap((a) => a.outputMediaIds)
        .filter(Boolean);
      const medias =
        mediaIds.length > 0
          ? await ctx.prisma.mediaItem.findMany({
              where: { id: { in: mediaIds } },
            })
          : [];
      const mediaMap = new Map(medias.map((m) => [m.id, m]));

      // 当前已确认槽位列表(便于 UI 标"已确认"图)
      const confirmedMediaIds = new Set<string>(
        [
          asset.portraitMediaId,
          asset.threeViewMediaId,
          asset.sceneMainMediaId,
          asset.sceneFrontMediaId,
          asset.sceneLeftMediaId,
          asset.sceneRightMediaId,
          asset.sceneBackMediaId,
          asset.panoramaMediaId,
          asset.mainMediaId,
        ].filter((id): id is string => !!id),
      );

      return attempts.map((a) => ({
        attempt: a,
        // 每张 media 单独标 isConfirmed,让前端 Card 级别准确显示(不再整批标 confirmed)
        media: a.outputMediaIds
          .map((id) => {
            const m = mediaMap.get(id);
            if (!m) return null;
            return { ...m, isConfirmed: confirmedMediaIds.has(m.id) };
          })
          .filter((m): m is NonNullable<typeof m> => !!m),
        // 保留 attempt 级 isConfirmed(向前兼容)— 表示"本次生成有任意一张被确认"
        isConfirmed: a.outputMediaIds.some((id) => confirmedMediaIds.has(id)),
      }));
    }),

  /** 确认某候选图为资产指定槽位 — 更新 Asset.<slot>MediaId + 重算 maturity */
  confirmCandidate: protectedProcedure
    .input(
      z.object({
        assetId: z.string().cuid(),
        slot: SlotSchema,
        mediaItemId: z.string().cuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);

      // reference / detail 不是合法的确认槽位(仅用于生成参考,不写到资产槽位)
      if (input.slot === 'reference' || input.slot === 'detail') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `slot '${input.slot}' 不能确认到资产槽位 — 仅作为生成参考`,
        });
      }

      // 锁定资产禁止改槽位(配合 update 的锁定守卫)
      if (asset.lockedAt) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '资产已锁定,先解锁才能改槽位图',
        });
      }

      // 验证 mediaItem 属于本项目 + 必须源自本资产的 GenerationAttempt
      // 防"把 A 资产的图设到 B 资产槽位"数据混淆
      const media = await ctx.prisma.mediaItem.findFirst({
        where: {
          id: input.mediaItemId,
          projectId: asset.projectId,
          deletedAt: null,
        },
      });
      if (!media) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'MediaItem 不存在或不属于本项目',
        });
      }
      // MediaItem 归属校验 — 多层防御:
      //   1. AIGC 来源:sourceRef 必须 === 本 asset.id(不接受 null,不允许跨资产挪用)
      //   2. UPLOAD/IMPORTED:必须同 projectId(上面已查过 projectId,这里冗余确认)
      //   3. EXTERNAL:暂不允许直接 confirm(Phase 2 决策)
      if (media.source === 'AIGC') {
        if (!media.sourceRef || media.sourceRef !== asset.id) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'MediaItem 来自其他资产的生成 — 跨资产挪用破坏一致性,请重新为本资产生成',
          });
        }
        // W1-W5 audit P2 followup(P2-2):校验 attempt.candidateForSlot === input.slot
        // 防"为 portrait 槽位生成的图被强塞到 three_view 槽位"导致比例 / 视角错配
        // 仅在 AIGC 来源校验:UPLOAD 没有 candidateForSlot 概念,不校验
        const sourceAttempt = await ctx.prisma.generationAttempt.findFirst({
          where: { outputMediaIds: { has: media.id } },
          select: { candidateForSlot: true },
        });
        if (
          sourceAttempt?.candidateForSlot &&
          sourceAttempt.candidateForSlot !== input.slot
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `候选图原为 "${sourceAttempt.candidateForSlot}" 槽位生成,不可塞到 "${input.slot}" 槽位(比例/视角可能不匹配,重新为该槽位生成)`,
          });
        }
      } else if (media.source === 'EXTERNAL') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'EXTERNAL 来源的 MediaItem 暂不允许直接确认到资产槽位,请先入库为正式资产',
        });
      }
      // UPLOAD / IMPORTED 来源:已经过 projectId 校验,放行(允许用户上传图作为资产参考)

      const fieldName = SLOT_FIELD[input.slot];

      // 事务内重新读 + 计算 + 更新,防并发 confirm 不同 slot 时基于陈旧状态算 maturity
      // 第 18 轮 audit P1:加 advisory_xact_lock(asset.id) 串行化同一 asset 的并发 confirm,
      // 否则两个并发不同 slot 在 Read Committed 下各自 fresh 读看不到对方 update,
      // 最终 maturity 字段只反映最后一个 update 的视角(漏算对方新增 slot)
      const updated = await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'asset_confirm:' + asset.id})::bigint)`;
        const fresh = await tx.asset.findFirstOrThrow({
          where: { id: asset.id, deletedAt: null },
        });
        const projected = {
          ...fresh,
          [fieldName]: input.mediaItemId,
        } as Parameters<typeof computeMaturity>[0];
        const newMaturity = computeMaturity(projected);
        return tx.asset.update({
          where: { id: asset.id },
          data: { [fieldName]: input.mediaItemId, maturity: newMaturity },
        });
      });
      const newMaturity = updated.maturity;

      await logOperation(ctx, 'asset.slot.confirm', 'asset', asset.id, asset, {
        slot: input.slot,
        mediaItemId: input.mediaItemId,
        maturity: newMaturity,
        projectId: asset.projectId,
      });

      // 第 19 轮 audit P1:真 publish ASSET_CONFIRMED(events.ts 定义但 router 漏调)
      await getEventBus()
        .publish(
          EVENTS.ASSET_CONFIRMED,
          { assetId: asset.id, confirmedBy: ctx.user.id },
          { publisherId: 'asset.confirmCandidate' },
        )
        .catch((err) => {
          console.error('[asset.confirmCandidate] eventbus publish failed:', err);
        });

      return updated;
    }),

  /**
   * 删除候选 — 单张 media 粒度(MediaItem 软删 + 从 attempt.outputMediaIds 移除)
   *
   * 修正历史 bug:之前 `rejectCandidate({ attemptId })` 会把整个 attempt 标 rejected,
   * 即 4 张候选图同一 attempt 时点删 1 张会"误杀"另外 3 张。
   * 现按 mediaItemId 单图操作:
   *   - 软删 MediaItem (deletedAt)
   *   - 从 GenerationAttempt.outputMediaIds 数组移除该 id
   *   - 若 attempt.outputMediaIds 全空 → 顺手把 attempt 标 rejected(无残留 attempt)
   */
  rejectCandidate: protectedProcedure
    .input(
      z.object({
        mediaItemId: z.string().cuid().optional(),
        // 向前兼容:旧前端传 attemptId 时 reject 整个 attempt
        attemptId: z.string().cuid().optional(),
      }).refine((d) => !!d.mediaItemId || !!d.attemptId, {
        message: '必须提供 mediaItemId 或 attemptId',
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 模式 A:mediaItemId 单图删
      if (input.mediaItemId) {
        const media = await ctx.prisma.mediaItem.findFirst({
          where: { id: input.mediaItemId, deletedAt: null },
        });
        if (!media) throw new TRPCError({ code: 'NOT_FOUND', message: 'MediaItem 不存在' });
        if (media.projectId) {
          await assertProjectAccess(ctx, media.projectId);
        }

        return ctx.prisma.$transaction(async (tx) => {
          // 1. 软删 media
          await tx.mediaItem.update({
            where: { id: media.id },
            data: { deletedAt: new Date() },
          });
          // 2. 从所有引用本 media 的 attempt 中移除该 mediaId
          const refs = await tx.generationAttempt.findMany({
            where: { outputMediaIds: { has: media.id } },
          });
          for (const a of refs) {
            const next = a.outputMediaIds.filter((x) => x !== media.id);
            const allCleared = next.length === 0;
            await tx.generationAttempt.update({
              where: { id: a.id },
              data: {
                outputMediaIds: next,
                // 若 attempt 已无任何输出 → 标 rejected(无残留)
                ...(allCleared
                  ? { rejected: true, rejectedAt: new Date(), rejectedBy: ctx.user.id }
                  : {}),
              },
            });
          }
          await logOperation(ctx, 'asset.candidate.rejectMedia', 'media_item', media.id, media, null);
          return { ok: true, deletedMediaId: media.id };
        });
      }

      // 模式 B:旧逻辑(attemptId 整组 reject) — 保留兼容
      const attempt = await ctx.prisma.generationAttempt.findUnique({
        where: { id: input.attemptId! },
      });
      if (!attempt) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertProjectAccess(ctx, attempt.projectId);

      const updated = await ctx.prisma.generationAttempt.update({
        where: { id: input.attemptId! },
        data: { rejected: true, rejectedAt: new Date(), rejectedBy: ctx.user.id },
      });
      await logOperation(ctx, 'asset.candidate.reject', 'generation_attempt', updated.id, attempt, updated);
      return { ok: true, attemptId: updated.id };
    }),

  /** 取消槽位确认(清除 Asset.<slot>MediaId,候选图回到备用区) */
  unconfirmSlot: protectedProcedure
    .input(
      z.object({
        assetId: z.string().cuid(),
        slot: SlotSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      if (asset.lockedAt) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '资产已锁定,先解锁才能清除槽位图',
        });
      }
      const fieldName = SLOT_FIELD[input.slot];

      // 事务内重新读 + 计算 + 更新 — 同 confirmCandidate
      // 第 19 轮 audit P1:加 advisory_xact_lock(跟 confirmCandidate 配套),
      // 否则 confirm A + unconfirm B 并发时 maturity 会基于陈旧状态算
      const updated = await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'asset_confirm:' + asset.id})::bigint)`;
        const fresh = await tx.asset.findFirstOrThrow({
          where: { id: asset.id, deletedAt: null },
        });
        const projected = {
          ...fresh,
          [fieldName]: null,
        } as Parameters<typeof computeMaturity>[0];
        const newMaturity = computeMaturity(projected);
        return tx.asset.update({
          where: { id: asset.id },
          data: { [fieldName]: null, maturity: newMaturity },
        });
      });
      const newMaturity = updated.maturity;
      await logOperation(ctx, 'asset.slot.unconfirm', 'asset', asset.id, asset, {
        slot: input.slot,
        maturity: newMaturity,
        projectId: asset.projectId,
      });
      return updated;
    }),

  // -------- 出场绑定 (AssetUsageBinding) --------

  /** 列出某资产的所有出场绑定(group by episode 便于前端展示卡片底部 1-1, 2-1, 14-2) */
  listBindings: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      return ctx.prisma.assetUsageBinding.findMany({
        where: { assetId: asset.id, deletedAt: null },
        include: {
          episode: { select: { id: true, number: true, title: true } },
          scene: { select: { id: true, number: true, place: true } },
          shot: { select: { id: true, number: true, positionIdx: true } },
        },
        orderBy: [{ episode: { number: 'asc' } }, { createdAt: 'asc' }],
      });
    }),

  /**
   * W6 polish:批量列出多个资产的出场绑定,按 assetId group 返回
   *
   * 修复 N+1:art-workspace 资产列表里每张 AssetCard 原来各调 listBindings,
   * 50 张资产 = 50 次 query。现父级批量查一次,返回 { assetId → bindings[] }。
   */
  listBindingsByAssetIds: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        assetIds: z.array(z.string().cuid()).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
      if (input.assetIds.length === 0) return {} as Record<string, never>;
      await assertProjectAccess(ctx, input.projectId);

      const bindings = await ctx.prisma.assetUsageBinding.findMany({
        where: {
          assetId: { in: input.assetIds },
          deletedAt: null,
          asset: { projectId: input.projectId, deletedAt: null },
        },
        include: {
          episode: { select: { id: true, number: true, title: true } },
          scene: { select: { id: true, number: true, place: true } },
          shot: { select: { id: true, number: true, positionIdx: true } },
        },
        orderBy: [{ episode: { number: 'asc' } }, { createdAt: 'asc' }],
      });

      const grouped: Record<string, typeof bindings> = {};
      for (const b of bindings) {
        const list = grouped[b.assetId] ?? [];
        list.push(b);
        grouped[b.assetId] = list;
      }
      return grouped;
    }),

  /**
   * 按 shotId 列出 binding(W1-W5 audit P1 followup P1-8)
   *
   * AIGC 工作台跑 group 级查询,但导演侧编辑单镜时(原 W3 ShotAssetRef 兼容路径)
   * 需要按 shotId 查 binding。当前 binding 已有 shotId 字段(W4-MM 加),只是没暴露查询端点。
   */
  listShotBindings: protectedProcedure
    .input(z.object({ shotId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const shot = await ctx.prisma.shot.findFirst({
        where: { id: input.shotId, deletedAt: null },
        select: { id: true, episodeId: true, episode: { select: { projectId: true } } },
      });
      if (!shot || !shot.episode) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '分镜不存在' });
      }
      await assertProjectAccess(ctx, shot.episode.projectId);
      return ctx.prisma.assetUsageBinding.findMany({
        where: { shotId: input.shotId, deletedAt: null },
        include: {
          asset: {
            select: {
              id: true,
              type: true,
              name: true,
              alias: true,
              maturity: true,
              complianceStatus: true,
              portraitMediaId: true,
              sceneMainMediaId: true,
              mainMediaId: true,
            },
          },
        },
        orderBy: [{ createdAt: 'asc' }],
      });
    }),

  /** 列出本集所有用到的资产(给"按集补充"或"集详情资产卡"用) */
  listEpisodeAssets: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const ep = await ctx.prisma.episode.findFirst({
        where: { id: input.episodeId, deletedAt: null },
      });
      if (!ep) throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
      await assertProjectAccess(ctx, ep.projectId);

      const bindings = await ctx.prisma.assetUsageBinding.findMany({
        where: { episodeId: ep.id, deletedAt: null },
        include: {
          asset: true,
          scene: { select: { id: true, number: true } },
          shot: { select: { id: true, number: true } },
        },
      });
      return bindings;
    }),

  /** 新建出场绑定 */
  bindUsage: protectedProcedure
    .input(
      z.object({
        assetId: z.string().cuid(),
        episodeId: z.string().cuid(),
        sceneId: z.string().cuid().optional(),
        shotId: z.string().cuid().optional(),
        usageType: UsageTypeSchema.default('APPEAR'),
        required: z.boolean().default(true),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      const ep = await ctx.prisma.episode.findFirst({
        where: { id: input.episodeId, projectId: asset.projectId, deletedAt: null },
      });
      if (!ep) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '集不存在或不属于本项目',
        });
      }

      // 用 findFirst + 条件 create/update 替代 upsert
      // (Prisma 不允许 composite unique 含 null 字段的 upsert.where)
      const existing = await ctx.prisma.assetUsageBinding.findFirst({
        where: {
          assetId: input.assetId,
          episodeId: input.episodeId,
          sceneId: input.sceneId ?? null,
          shotId: input.shotId ?? null,
          usageType: input.usageType,
        },
      });

      // 并发兜底:即使 findFirst 没查到,两个并发请求都走 create 分支也会撞 unique。
      // 抓 P2002 → 回退 update 走完。
      let binding;
      if (existing) {
        binding = await ctx.prisma.assetUsageBinding.update({
          where: { id: existing.id },
          data: {
            required: input.required,
            note: input.note,
            deletedAt: null,
          },
        });
      } else {
        try {
          binding = await ctx.prisma.assetUsageBinding.create({
            data: {
              assetId: input.assetId,
              projectId: asset.projectId,
              episodeId: input.episodeId,
              sceneId: input.sceneId,
              shotId: input.shotId,
              usageType: input.usageType,
              required: input.required,
              note: input.note,
            },
          });
        } catch (e) {
          // P2002 — 并发产生,重读后 update
          const dup = await ctx.prisma.assetUsageBinding.findFirst({
            where: {
              assetId: input.assetId,
              episodeId: input.episodeId,
              sceneId: input.sceneId ?? null,
              shotId: input.shotId ?? null,
              usageType: input.usageType,
            },
          });
          if (!dup) throw e;
          binding = await ctx.prisma.assetUsageBinding.update({
            where: { id: dup.id },
            data: {
              required: input.required,
              note: input.note,
              deletedAt: null,
            },
          });
        }
      }
      await logOperation(
        ctx,
        existing ? 'asset.binding.update' : 'asset.binding.create',
        'asset_usage_binding',
        binding.id,
        existing,
        binding,
      );
      return binding;
    }),

  /** 删除出场绑定(软删) */
  unbindUsage: protectedProcedure
    .input(z.object({ bindingId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const binding = await ctx.prisma.assetUsageBinding.findUnique({
        where: { id: input.bindingId },
      });
      if (!binding) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertProjectAccess(ctx, binding.projectId);

      await ctx.prisma.assetUsageBinding.update({
        where: { id: input.bindingId },
        data: { deletedAt: new Date() },
      });
      await logOperation(ctx, 'asset.binding.delete', 'asset_usage_binding', binding.id, binding, null);
      return { ok: true };
    }),

  // -------- archetype 变体管理 --------

  /** 取同 archetypeKey 的所有变体(年轻版/重生初期/疗伤期等同一角色不同时期) */
  listArchetypeVariants: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        archetypeKey: z.string().min(1).max(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      return ctx.prisma.asset.findMany({
        where: {
          projectId: input.projectId,
          archetypeKey: input.archetypeKey,
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
      });
    }),

  /** 取本项目所有 archetypeKey 列表(供前端"同人物多变体"分组) */
  listArchetypeKeys: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const rows = await ctx.prisma.asset.findMany({
        where: {
          projectId: input.projectId,
          archetypeKey: { not: null },
          deletedAt: null,
        },
        select: { archetypeKey: true, type: true },
      });
      // 聚合 { archetypeKey, type, count }
      const map = new Map<string, { archetypeKey: string; type: string; count: number }>();
      for (const r of rows) {
        const key = `${r.type}::${r.archetypeKey}`;
        const hit = map.get(key);
        if (hit) hit.count++;
        else map.set(key, { archetypeKey: r.archetypeKey!, type: r.type, count: 1 });
      }
      return Array.from(map.values()).filter((v) => v.count > 1);
    }),

  // -------- 缺口检测(W4-MM.8) --------

  /**
   * 检测某集的资产缺口 — 用于"按集补充"
   *
   * 比对:
   *   - Scene.characters 字段(剧本拆出来的本场角色名)
   *   - Scene.place 字段(场景地点)
   *   vs
   *   - 已建 Asset(同 projectId + 同 name 或 alias 命中)
   *
   * 返回:
   *   - existingCount: 已有资产数
   *   - missingCharacters: 剧本提到但未建的角色名列表
   *   - missingScenes: 剧本提到但未建的场景列表
   *   - sceneCount: 本集场数(供前端显示进度)
   */
  detectGaps: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const ep = await ctx.prisma.episode.findFirst({
        where: { id: input.episodeId, deletedAt: null },
      });
      if (!ep) throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
      await assertProjectAccess(ctx, ep.projectId);

      const scenes = await ctx.prisma.scene.findMany({
        where: { episodeId: ep.id, deletedAt: null },
        orderBy: { positionIdx: 'asc' },
      });

      // 收集本集所有 character / place
      const mentionedCharacters = new Set<string>();
      const mentionedScenes = new Map<string, { number: string; place: string }>();
      for (const sc of scenes) {
        for (const c of sc.characters) {
          const trimmed = c.trim();
          if (trimmed) mentionedCharacters.add(trimmed);
        }
        if (sc.place && sc.place.trim()) {
          mentionedScenes.set(sc.place.trim(), { number: sc.number, place: sc.place });
        }
      }

      // 取本项目已有资产(含 alias 匹配)
      const projectAssets = await ctx.prisma.asset.findMany({
        where: { projectId: ep.projectId, deletedAt: null },
        select: { id: true, type: true, name: true, alias: true, archetypeKey: true },
      });

      // 构建已有名字集合(name + alias + archetypeKey 都算命中)
      const knownNames = new Set<string>();
      for (const a of projectAssets) {
        knownNames.add(a.name.trim());
        if (a.archetypeKey) knownNames.add(a.archetypeKey.trim());
        for (const al of a.alias) knownNames.add(al.trim());
      }

      const missingCharacters = Array.from(mentionedCharacters).filter(
        (c) => !knownNames.has(c),
      );
      const missingScenes = Array.from(mentionedScenes.entries())
        .filter(([place]) => !knownNames.has(place))
        .map(([place, info]) => ({ name: place, sceneNumber: info.number }));

      // 本集已绑定的资产数
      const existingBindings = await ctx.prisma.assetUsageBinding.count({
        where: { episodeId: ep.id, deletedAt: null },
      });

      return {
        episodeId: ep.id,
        episodeNumber: ep.number,
        episodeTitle: ep.title,
        sceneCount: scenes.length,
        existingBindingCount: existingBindings,
        mentionedCharactersCount: mentionedCharacters.size,
        mentionedScenesCount: mentionedScenes.size,
        missingCharacters,
        missingScenes,
      };
    }),

  // -------- 资产-剧集 二次匹配审计(W4-MM.9) --------

  /**
   * 审计本项目的资产-剧集关联完整性,返回三类问题清单
   *
   * (a) noAssetForMentioned:剧本提到但没建资产(全项目维度)
   * (b) noBindingAssets:资产建了但 0 个 binding(可能是被遗忘了)
   * (c) danglingBindings:binding 指向已 soft-deleted 的 scene/shot/asset(数据脏)
   */
  auditProject: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      // (a) 只查本项目下的 scene(经 episode.projectId 过滤,DB 层完成,避免拉全表 + 跨租户信息泄漏)
      const projectScenes = await ctx.prisma.scene.findMany({
        where: {
          episode: { projectId: input.projectId },
          deletedAt: null,
        },
        include: { episode: { select: { id: true, number: true } } },
      });

      const allMentionedChars = new Set<string>();
      const allMentionedScenes = new Map<string, { episodeNumber: number; sceneNumber: string }>();
      for (const sc of projectScenes) {
        for (const c of sc.characters) {
          if (c.trim()) allMentionedChars.add(c.trim());
        }
        if (sc.place?.trim()) {
          allMentionedScenes.set(sc.place.trim(), {
            episodeNumber: sc.episode.number,
            sceneNumber: sc.number,
          });
        }
      }

      const allAssets = await ctx.prisma.asset.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        include: { usageBindings: { where: { deletedAt: null } } },
      });
      const knownNames = new Set<string>();
      for (const a of allAssets) {
        knownNames.add(a.name.trim());
        if (a.archetypeKey) knownNames.add(a.archetypeKey.trim());
        for (const al of a.alias) knownNames.add(al.trim());
      }
      const noAssetForMentioned = {
        characters: Array.from(allMentionedChars).filter((c) => !knownNames.has(c)),
        scenes: Array.from(allMentionedScenes.entries())
          .filter(([place]) => !knownNames.has(place))
          .map(([place, info]) => ({ name: place, ...info })),
      };

      // (b) 资产 0 binding
      const noBindingAssets = allAssets
        .filter((a) => a.usageBindings.length === 0)
        .map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          archetypeKey: a.archetypeKey,
        }));

      // (c) 悬空 binding — 指向已 soft-deleted 的 scene/shot/asset
      const allBindings = await ctx.prisma.assetUsageBinding.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        include: {
          asset: { select: { id: true, name: true, deletedAt: true } },
          scene: { select: { id: true, number: true, deletedAt: true } },
          shot: { select: { id: true, number: true, deletedAt: true } },
        },
      });
      const danglingBindings = allBindings
        .filter(
          (b) =>
            (b.asset && b.asset.deletedAt) ||
            (b.scene && b.scene.deletedAt) ||
            (b.shot && b.shot.deletedAt),
        )
        .map((b) => ({
          id: b.id,
          assetName: b.asset?.name ?? '(已删)',
          reason: b.asset?.deletedAt
            ? 'asset 已软删'
            : b.scene?.deletedAt
              ? 'scene 已软删'
              : 'shot 已软删',
        }));

      return {
        noAssetForMentioned,
        noBindingAssets,
        danglingBindings,
        summary: {
          missingCharCount: noAssetForMentioned.characters.length,
          missingSceneCount: noAssetForMentioned.scenes.length,
          unboundCount: noBindingAssets.length,
          danglingCount: danglingBindings.length,
        },
      };
    }),

  // -------- 锁定 / 解锁 --------

  lockAsset: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      if (asset.lockedAt) return { ok: true, alreadyLocked: true };
      await ctx.prisma.asset.update({
        where: { id: input.assetId },
        data: { lockedAt: new Date() },
      });
      await logOperation(ctx, 'asset.lock', 'asset', asset.id, asset, {
        lockedAt: new Date(),
        projectId: asset.projectId,
      });
      return { ok: true };
    }),

  unlockAsset: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      if (!asset.lockedAt) return { ok: true, alreadyUnlocked: true };
      await ctx.prisma.asset.update({
        where: { id: input.assetId },
        data: { lockedAt: null },
      });
      await logOperation(ctx, 'asset.unlock', 'asset', asset.id, asset, {
        lockedAt: null,
        projectId: asset.projectId,
      });
      return { ok: true };
    }),

  /**
   * [W4.6 占位] 合规检查 — 火山引擎人脸 ID
   *
   * 真实实现:
   *   1. 取 Asset.mainMediaId 对应的图片 URL
   *   2. 调 binding.asset.compliance.providerId 对应 ComplianceProvider
   *   3. 提交人脸 → 拿到 complianceId
   *   4. 写回 Asset.complianceId + complianceStatus=APPROVED + complianceCheckedAt
   *   5. 后续视频生成时复用同一 ID 不再扣费
   *
   * W1-W5 audit P1 followup(P1-5):读 binding.asset.compliance.providerId,
   * 即使占位也把 binding 真用上,errorMsg 显示当前 binding 值便于调试。
   */
  complianceCheck: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      const binding = await ctx.prisma.systemSetting.findUnique({
        where: { key: 'binding.asset.compliance.providerId' },
        select: { value: true },
      });
      const providerId = binding?.value ?? '(未配置)';
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: `资产合规检查(W4.6)尚未上线 — 当前绑定 provider=${providerId},接入实现待补(asset=${asset.id})`,
      });
    }),

  /** 手动设置合规 ID — 过渡用(W4.6 真实接入前,允许 admin 手动填) */
  setComplianceManually: protectedProcedure
    .input(
      z.object({
        assetId: z.string().cuid(),
        complianceId: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await loadAssetWithAccess(ctx, input.assetId);

      // W1-W5 audit P0(A1):合规通过后必须重算 maturity,否则 L4 人物永远卡 L4 升不上 L5
      const after = await ctx.prisma.$transaction(async (tx) => {
        const fresh = await tx.asset.findFirstOrThrow({
          where: { id: input.assetId, deletedAt: null },
        });
        const projected = {
          ...fresh,
          complianceStatus: 'APPROVED',
        } as Parameters<typeof computeMaturity>[0];
        const newMaturity = computeMaturity(projected);
        return tx.asset.update({
          where: { id: input.assetId },
          data: {
            complianceId: input.complianceId,
            complianceStatus: 'APPROVED',
            complianceCheckedAt: new Date(),
            maturity: newMaturity,
          },
        });
      });

      await logOperation(
        ctx,
        'asset.compliance.manualSet',
        'asset',
        input.assetId,
        before,
        { ...after, projectId: after.projectId, maturity: after.maturity },
      );
      return after;
    }),
});
