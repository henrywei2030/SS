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

import { router, protectedProcedure } from '../trpc.js';
import type { Context } from '../context.js';
import { logOperation } from '../middleware/audit.js';

// ---------------------------------------------------------------------------
// 通用
// ---------------------------------------------------------------------------

async function assertProjectAccess(
  ctx: Context,
  projectId: string,
  userId: string,
): Promise<void> {
  const p = await ctx.prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
  });
  if (!p) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '无项目访问权限' });
  }
}

async function loadAssetWithAccess(ctx: Context, assetId: string) {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const asset = await ctx.prisma.asset.findFirst({
    where: { id: assetId, deletedAt: null },
  });
  if (!asset) throw new TRPCError({ code: 'NOT_FOUND', message: '资产不存在' });
  await assertProjectAccess(ctx, asset.projectId, ctx.user.id);
  return asset;
}

// ---------------------------------------------------------------------------
// PromptEdit — 资产文本字段训练集采集
// ---------------------------------------------------------------------------

const TRAINABLE_ASSET_FIELDS = new Set(['name', 'description', 'prompt']);

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
  /** 列出资产 — 按 type 过滤 */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        type: AssetTypeSchema.optional(),
        includeDeleted: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, ctx.user.id);
      return ctx.prisma.asset.findMany({
        where: {
          projectId: input.projectId,
          ...(input.type && { type: input.type }),
          ...(input.includeDeleted ? {} : { deletedAt: null }),
        },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      });
    }),

  /** 详情(含媒体引用 ID,前端再单独取 MediaItem) */
  get: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return loadAssetWithAccess(ctx, input.assetId);
    }),

  /** 单个手动创建 */
  create: protectedProcedure
    .input(
      DraftInputSchema.extend({
        projectId: z.string().cuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, ctx.user.id);

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
    .input(
      z.object({
        projectId: z.string().cuid(),
        drafts: z.array(DraftInputSchema).min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, ctx.user.id);

      // 先查同项目已有 name 集合,跳过重名
      const existing = await ctx.prisma.asset.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        select: { name: true },
      });
      const existingNames = new Set(existing.map((a) => a.name));

      const created: Array<{ id: string; name: string; type: string }> = [];
      const skipped: string[] = [];

      for (const draft of input.drafts) {
        if (existingNames.has(draft.name)) {
          skipped.push(draft.name);
          continue;
        }
        const asset = await ctx.prisma.asset.create({
          data: { projectId: input.projectId, ...draft },
        });
        created.push({ id: asset.id, name: asset.name, type: asset.type });
        existingNames.add(draft.name);
      }

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

      // name 改动需要检测同项目重名(不能撞已存在的)
      if (input.patch.name && input.patch.name !== before.name) {
        const dup = await ctx.prisma.asset.findFirst({
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

      const after = await ctx.prisma.asset.update({
        where: { id: input.assetId },
        data: input.patch,
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

  /** 软删 */
  delete: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      await ctx.prisma.asset.update({
        where: { id: input.assetId },
        data: { deletedAt: new Date() },
      });
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
    .input(
      z.object({
        projectId: z.string().cuid(),
        scriptId: z.string().cuid().optional(),
        episodeId: z.string().cuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, ctx.user.id);

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
      const modelId =
        map.get('binding.asset.breakdown.modelId') ?? 'claude-sonnet-4-5';
      const maxCharacters = Number(map.get('asset.breakdown.maxCharacters') ?? '20');

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
          },
        });
      } catch (e) {
        await logOperation(ctx, 'asset.breakdown.failed', 'project', input.projectId, null, {
          error: e instanceof Error ? e.message : String(e),
          scriptId: script.id,
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: e instanceof Error ? e.message : '资产拆解失败',
        });
      }

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
      const providerId =
        input.modelId ??
        (input.slot === 'panorama'
          ? settingMap.get('binding.asset.panorama.providerId') ?? 'gpt-image-2'
          : settingMap.get('binding.asset.image.providerId') ?? 'nano-banana-pro');

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

      // 创建 N 张占位 MediaItem + 一条 GenerationAttempt
      const candidates: Array<{ mediaId: string; attemptId: string }> = [];
      for (let i = 0; i < input.count; i++) {
        const media = await ctx.prisma.mediaItem.create({
          data: {
            projectId: asset.projectId,
            scope: 'PROJECT',
            kind: 'IMAGE',
            filename: `${asset.name}-${input.slot}-${Date.now()}-${i}.placeholder.png`,
            mimeType: 'image/png',
            sizeBytes: 0,
            storageKey: `placeholder://w4mm/${asset.id}/${input.slot}/${Date.now()}/${i}`,
            meta: {
              placeholder: true,
              slot: input.slot,
              prompt: compiled.positive,
              negative: compiled.negative,
            },
            aspectRatio,
            viewKind: input.slot,
            source: 'AIGC',
            sourceRef: asset.id,
          },
        });
        const attempt = await ctx.prisma.generationAttempt.create({
          data: {
            projectId: asset.projectId,
            assetId: asset.id,
            providerId,
            modelId: providerId,
            action: 'IMAGE',
            candidateForSlot: input.slot,
            inputJson: {
              prompt: compiled.positive,
              negative: compiled.negative,
              aspectRatio,
              sizePx: input.sizePx,
              parts: compiled.parts,
              mock: true,
              note: 'W4-MM mock:真实 ImageProvider 实装见 W4-MM.6',
            },
            outputMediaId: media.id,
            outputMediaIds: [media.id],
            inputUnits: 0,
            outputUnits: 1,
            unitPriceCny: '0',
            costCny: '0',
            status: 'SUCCESS',
            startedAt: new Date(),
            finishedAt: new Date(),
            createdBy: ctx.user.id,
          },
        });
        candidates.push({ mediaId: media.id, attemptId: attempt.id });
      }

      await logOperation(ctx, 'asset.generateImage.mock', 'asset', asset.id, null, {
        slot: input.slot,
        count: input.count,
        providerId,
        aspectRatio,
        projectId: asset.projectId,
      });

      return {
        candidates,
        providerId,
        aspectRatio,
        compiledPrompt: compiled,
        mock: true,
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
        media: a.outputMediaIds
          .map((id) => mediaMap.get(id))
          .filter((m): m is NonNullable<typeof m> => !!m),
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

      // 验证 mediaItem 存在 + 属于本项目
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

      const fieldName = SLOT_FIELD[input.slot];
      const patch: Record<string, string | null> = { [fieldName]: input.mediaItemId };

      // 重算 maturity
      const projected = {
        ...asset,
        [fieldName]: input.mediaItemId,
      } as Parameters<typeof computeMaturity>[0];
      const newMaturity = computeMaturity(projected);

      const updated = await ctx.prisma.asset.update({
        where: { id: asset.id },
        data: { ...patch, maturity: newMaturity },
      });

      await logOperation(ctx, 'asset.slot.confirm', 'asset', asset.id, asset, {
        slot: input.slot,
        mediaItemId: input.mediaItemId,
        maturity: newMaturity,
        projectId: asset.projectId,
      });

      return updated;
    }),

  /** 删除候选 — soft reject GenerationAttempt(不真删,保留训练审计) */
  rejectCandidate: protectedProcedure
    .input(z.object({ attemptId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const attempt = await ctx.prisma.generationAttempt.findUnique({
        where: { id: input.attemptId },
      });
      if (!attempt) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await assertProjectAccess(ctx, attempt.projectId, ctx.user.id);

      const updated = await ctx.prisma.generationAttempt.update({
        where: { id: input.attemptId },
        data: { rejected: true, rejectedAt: new Date(), rejectedBy: ctx.user.id },
      });
      await logOperation(ctx, 'asset.candidate.reject', 'generation_attempt', updated.id, attempt, updated);
      return updated;
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
      const fieldName = SLOT_FIELD[input.slot];
      const projected = {
        ...asset,
        [fieldName]: null,
      } as Parameters<typeof computeMaturity>[0];
      const newMaturity = computeMaturity(projected);

      const updated = await ctx.prisma.asset.update({
        where: { id: asset.id },
        data: { [fieldName]: null, maturity: newMaturity },
      });
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

  /** 列出本集所有用到的资产(给"按集补充"或"集详情资产卡"用) */
  listEpisodeAssets: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const ep = await ctx.prisma.episode.findFirst({
        where: { id: input.episodeId, deletedAt: null },
      });
      if (!ep) throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
      await assertProjectAccess(ctx, ep.projectId, ctx.user.id);

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

      const binding = existing
        ? await ctx.prisma.assetUsageBinding.update({
            where: { id: existing.id },
            data: {
              required: input.required,
              note: input.note,
              deletedAt: null, // 若被软删过,重新激活
            },
          })
        : await ctx.prisma.assetUsageBinding.create({
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
      await assertProjectAccess(ctx, binding.projectId, ctx.user.id);

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
      await assertProjectAccess(ctx, input.projectId, ctx.user.id);
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
      await assertProjectAccess(ctx, input.projectId, ctx.user.id);
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
   */
  complianceCheck: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .mutation(async ({ input }) => {
      void input;
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: '资产合规检查(W4.6)尚未上线 — ComplianceProvider 接入待实现',
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
      const after = await ctx.prisma.asset.update({
        where: { id: input.assetId },
        data: {
          complianceId: input.complianceId,
          complianceStatus: 'APPROVED',
          complianceCheckedAt: new Date(),
        },
      });
      await logOperation(
        ctx,
        'asset.compliance.manualSet',
        'asset',
        input.assetId,
        before,
        { ...after, projectId: after.projectId },
      );
      return after;
    }),
});
