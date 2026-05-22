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

import { breakdownAssets, type AssetDraft } from '@ss/core/asset';

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
});

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
            mainMediaId: z.string().cuid().nullable().optional(),
            status: z.enum(['DRAFT', 'CANDIDATE', 'CONFIRMED', 'RETIRED']).optional(),
          })
          .strict(),
        diffNote: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await loadAssetWithAccess(ctx, input.assetId);

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
   * [W4.5 占位] 图像生成 — 主形象 / 三视图 / 全景
   *
   * 真实实现:
   *   1. 取 Asset.prompt + project style + 风格 prompt 拼接编译
   *   2. 调 binding.asset.image.providerId 对应 ImageProvider
   *   3. 返回的图存 MediaItem,关联到 Asset.mainMediaId / threeViewIds / panorama360Id
   *   4. 记 GenerationAttempt 走 Cost Ledger
   */
  generateImage: protectedProcedure
    .input(
      z.object({
        assetId: z.string().cuid(),
        kind: z.enum(['main', 'three-view', 'panorama']),
      }),
    )
    .mutation(async ({ input }) => {
      void input;
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: '资产图像生成(W4.5)尚未上线 — Image Provider 实例化 + MediaItem 入库待实现',
      });
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
