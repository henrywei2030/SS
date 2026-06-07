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
  breakdownFullSettings,
  type AssetDraft,
  compileAssetPrompt,
} from '@ss/core/asset';
import { getImageProvider, getTextProvider } from '@ss/adapters/provider';
import { getStorageAdapter } from '@ss/adapters/storage';
import { getEventBus } from '@ss/adapters/eventbus';
import { Prisma } from '@ss/db';
// 第 18 轮 audit P1:errMsg 入库 + throw 前脱敏,防真接 NanoBanana / GPT Image 后泄漏 URL/token
// 第 19 轮 audit P1:加 EventBus publish(ASSET_GENERATED / ASSET_CONFIRMED),events.ts 定义但漏调
import { sanitizeErrorMsg, EVENTS, asRecord } from '@ss/shared';

import { router, protectedProcedure } from '../trpc.js';
import type { Context } from '../context.js';
import { logOperation } from '../middleware/audit.js';
// 三十二收工 S3 followup:batch SystemSetting 读 helper
import { loadSystemSettings } from '../utils/system-bindings.js';

// ---------------------------------------------------------------------------
// 通用
// ---------------------------------------------------------------------------

// W7+ audit R10:assertProjectAccess 抽到 middleware/access.ts(原 5 router 各一份)
import { assertProjectAccess, loadEpisodeOrThrow } from '../middleware/access.js';
// P2(ADR-31):helper / schema / 常量抽到 asset-shared.ts(供拆分后各 sub-module 复用)
import {
  loadAssetWithAccess,
  loadProjectFullScript,
  recordAssetEdit,
  AssetTypeSchema,
  CharacterRoleSchema,
  LifeNodeSchema,
  ProfileJsonSchema,
  ProfileFieldsSchema,
  DraftInputSchema,
  SlotSchema,
  UsageTypeSchema,
  SLOT_FIELD,
  computeMaturity,
} from './asset-shared.js';

// ---------------------------------------------------------------------------
// Router(helper / schema / 常量见 ./asset-shared.ts)
// ---------------------------------------------------------------------------

export const assetRouter = router({
  /** 列出资产 — 按 type 过滤,附 MediaItem URL map(避免前端 N+1 查) */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        type: AssetTypeSchema.optional(),
        includeDeleted: z.boolean().default(false),
        // 同步闸视图:all(剧本拆解全量)/ synced(美术工坊只看已同步)/ unsynced(待同步)
        syncFilter: z.enum(['all', 'synced', 'unsynced']).default('all'),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const assets = await ctx.prisma.asset.findMany({
        where: {
          projectId: input.projectId,
          ...(input.type && { type: input.type }),
          ...(input.includeDeleted ? {} : { deletedAt: null }),
          ...(input.syncFilter === 'synced' && { syncedToArtAt: { not: null } }),
          ...(input.syncFilter === 'unsynced' && { syncedToArtAt: null }),
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

      const { projectId, profileJson, ...rest } = input;
      const asset = await ctx.prisma.asset.create({
        data: {
          projectId,
          ...rest,
          ...(profileJson !== undefined && { profileJson: profileJson as Prisma.InputJsonValue }),
        },
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
              data: toCreate.map(({ profileJson, ...d }) => ({
                projectId: input.projectId,
                ...d,
                ...(profileJson !== undefined && {
                  profileJson: profileJson as Prisma.InputJsonValue,
                }),
              })),
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
            // 剧本拆解角色档案(2026-06 P1)
            gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable().optional(),
            age: z.number().int().min(0).max(200).nullable().optional(),
            heightCm: z.number().int().min(0).max(300).nullable().optional(),
            mbti: z.string().max(8).nullable().optional(),
            personalityTags: z.array(z.string().max(30)).max(20).optional(),
            monologue: z.string().max(2000).nullable().optional(),
            bio: z.string().max(4000).nullable().optional(),
            episodes: z.array(z.number().int().min(1).max(99999)).max(2000).optional(),
            profileJson: ProfileJsonSchema.optional(),
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
        // profileJson 是 Json 字段:cast 成 Prisma.InputJsonValue,且为「整体覆盖」语义。
        //   ⚠️ 前端改 profileJson 须读-改-写全量(只传 voiceLabel 会清掉 lifeNodes),否则丢字段
        const { profileJson: patchProfileJson, ...patchRest } = input.patch;
        return tx.asset.update({
          where: { id: input.assetId },
          data: {
            ...patchRest,
            ...(patchProfileJson !== undefined && {
              profileJson: patchProfileJson as Prisma.InputJsonValue,
            }),
            ...maturityUpdate,
          },
        });
      });

      // 文本字段改动入训练集
      for (const [field, newVal] of Object.entries(input.patch)) {
        if (newVal === undefined) continue;
        const oldVal = asRecord(before)?.[field];
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

  // ---- 资产关联(2026-06 P1:图2 右侧「关联人物 / 关联资产」)----
  createRelation: protectedProcedure
    .meta({
      agentTool: {
        description: '创建两个资产之间的关联(from→to + 关系描述)',
        sideEffects: ['db.create:AssetRelation', 'OperationLog.write'],
        costEstimateCny: 0,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        fromAssetId: z.string().cuid(),
        toAssetId: z.string().cuid(),
        relationLabel: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.fromAssetId === input.toAssetId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '不能关联资产自身' });
      }
      const from = await loadAssetWithAccess(ctx, input.fromAssetId);
      const to = await loadAssetWithAccess(ctx, input.toAssetId);
      if (from.projectId !== to.projectId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '只能关联同项目内的资产' });
      }
      // 防重复:同 from→to 未删的已存在则更新 label
      const existing = await ctx.prisma.assetRelation.findFirst({
        where: { fromAssetId: input.fromAssetId, toAssetId: input.toAssetId, deletedAt: null },
      });
      if (existing) {
        return ctx.prisma.assetRelation.update({
          where: { id: existing.id },
          data: { relationLabel: input.relationLabel ?? existing.relationLabel },
        });
      }
      const rel = await ctx.prisma.assetRelation.create({
        data: {
          projectId: from.projectId,
          fromAssetId: input.fromAssetId,
          toAssetId: input.toAssetId,
          relationLabel: input.relationLabel,
          createdBy: ctx.user.id,
        },
      });
      await logOperation(ctx, 'asset.relation.create', 'asset_relation', rel.id, null, rel);
      return rel;
    }),

  /** 列某资产的全部关联(双向),归一化返回「对端资产 + 方向」 */
  listRelations: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      const rels = await ctx.prisma.assetRelation.findMany({
        where: { deletedAt: null, OR: [{ fromAssetId: asset.id }, { toAssetId: asset.id }] },
        include: {
          fromAsset: { select: { id: true, name: true, type: true, portraitMediaId: true } },
          toAsset: { select: { id: true, name: true, type: true, portraitMediaId: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return rels.map((r) => {
        const isFrom = r.fromAssetId === asset.id;
        return {
          id: r.id,
          direction: isFrom ? ('OUT' as const) : ('IN' as const),
          relationLabel: r.relationLabel,
          other: isFrom ? r.toAsset : r.fromAsset,
        };
      });
    }),

  deleteRelation: protectedProcedure
    .input(z.object({ relationId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const rel = await ctx.prisma.assetRelation.findFirst({
        where: { id: input.relationId, deletedAt: null },
      });
      if (!rel) throw new TRPCError({ code: 'NOT_FOUND', message: '关联不存在' });
      await assertProjectAccess(ctx, rel.projectId);
      await ctx.prisma.assetRelation.update({
        where: { id: rel.id },
        data: { deletedAt: new Date() },
      });
      await logOperation(ctx, 'asset.relation.delete', 'asset_relation', rel.id, rel, null);
      return { ok: true };
    }),

  // ---- AI 生成档案字段(2026-06 P1:图2「AI 生成」按钮后端;返回草案不直接入库,前端编辑后再 update)----
  generateProfileField: protectedProcedure
    .meta({
      agentTool: {
        description: '基于已有人物信息 AI 生成某档案字段草案(mbti/personalityTags/monologue/lifeNodes)',
        sideEffects: ['extern.api:TextProvider', 'cost.deduct'],
        costEstimateCny: 0.01,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        assetId: z.string().cuid(),
        field: z.enum(['mbti', 'personalityTags', 'monologue', 'lifeNodes']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      const settings = await loadSystemSettings(ctx.prisma, ['binding.asset.breakdown.modelId']);
      const modelId = settings['binding.asset.breakdown.modelId'];
      if (!modelId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '资产设定 AI 生成未配置 LLM — 去 /admin/bindings 配 binding.asset.breakdown.modelId',
        });
      }
      const provider = await getTextProvider(modelId);
      const known = [
        `姓名:${asset.name}`,
        asset.gender ? `性别:${asset.gender}` : null,
        asset.age != null ? `年龄:${asset.age}` : null,
        asset.characterRole ? `角色定位:${asset.characterRole}` : null,
        asset.description ? `外观/描述:${asset.description}` : null,
        asset.personalityTags.length ? `性格标签:${asset.personalityTags.join('、')}` : null,
        asset.mbti ? `MBTI:${asset.mbti}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      const FIELD_SPEC: Record<typeof input.field, { task: string; json: boolean }> = {
        mbti: { task: '推断该角色最可能的 MBTI 类型,只输出 4 个大写字母(如 INTJ),不要解释。', json: false },
        monologue: { task: '写一句体现该角色内核的第一人称独白,≤40 字,只输出独白本身。', json: false },
        personalityTags: { task: '生成 3-5 个性格标签。严格输出 JSON:{"tags":["标签1","标签2"]}', json: true },
        lifeNodes: {
          task: '生成 3-5 个人生关键节点(按时间排序)。严格输出 JSON:{"lifeNodes":[{"year":"2076","title":"出生","desc":"≤80字"}]}',
          json: true,
        },
      };
      const spec = FIELD_SPEC[input.field];

      // 五六收工:补 GenerationAttempt 审计行(对齐 asset.breakdown 的 TEXT 链路)。
      //   原本调 LLM 不留 attempt,BaseProvider 写的 ledger 行 attemptId 为空、无法回溯。
      //   建 attempt + 传 attemptId 让 ledger 关联;不传 skipLedger(保持原计费,纯增审计)。
      const attemptStartedAt = new Date();
      const attempt = await ctx.prisma.generationAttempt.create({
        data: {
          projectId: asset.projectId,
          assetId: asset.id,
          providerId: modelId,
          modelId,
          action: 'TEXT',
          inputJson: { kind: 'asset.generateProfileField', field: input.field },
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
        result = await provider.generate(
          {
            system: '你是资深编剧 / 人物设定师。基于已知人物信息补全指定字段。严格只输出要求的内容,不要解释。',
            prompt: `【已知人物信息】\n${known}\n\n【任务】${spec.task}`,
            // 五六-2:放宽到 4000 给 thinking 模型(如 gemini-3-flash)留推理预算 —— 实测小 maxTokens
            //   会被 thinking token 耗尽返空文本;非 thinking 模型产短字段会提前停,cap 大不浪费
            maxTokens: 4000,
            temperature: 0.85,
            ...(spec.json ? { jsonSchema: {} } : {}),
          },
          { userId: ctx.user.id, projectId: asset.projectId, assetId: asset.id, attemptId: attempt.id },
        );
      } catch (e) {
        const failedAt = new Date();
        // 对齐 breakdown:errMsg 入库 + throw 前脱敏(防真接 Provider 泄漏 URL/token)
        console.error('[asset.generateProfileField] LLM failed (raw):', e);
        const errMsg = sanitizeErrorMsg(e);
        await ctx.prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'FAILED',
            errorMsg: errMsg,
            finishedAt: failedAt,
            durationMs: failedAt.getTime() - attemptStartedAt.getTime(),
          },
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: errMsg || 'AI 生成失败',
          cause: e,
        });
      }

      // json 字段解析失败(result.json == null)记 FAILED,但仍返回让前端拿 warning 重试
      const parseFailed = spec.json && result.json == null;
      const finishedAt = new Date();
      await ctx.prisma.generationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: parseFailed ? 'FAILED' : 'SUCCESS',
          errorMsg: parseFailed ? 'AI 输出解析失败' : null,
          inputUnits: result.inputTokens,
          outputUnits: result.outputTokens,
          costCny: result.costCny.toFixed(4),
          finishedAt,
          durationMs: finishedAt.getTime() - attemptStartedAt.getTime(),
        },
      });

      let value: unknown;
      if (input.field === 'mbti' || input.field === 'monologue') {
        value = result.text.trim().replace(/^["'「」]+|["'「」]+$/g, '');
      } else if (input.field === 'personalityTags') {
        const obj = asRecord(result.json);
        value = Array.isArray(obj?.tags)
          ? obj.tags.filter((t): t is string => typeof t === 'string').slice(0, 10)
          : [];
      } else {
        const obj = asRecord(result.json);
        const arr = Array.isArray(obj?.lifeNodes) ? obj.lifeNodes : [];
        value = arr
          .map((n) => {
            const r = asRecord(n);
            if (!r) return null;
            return {
              year: typeof r.year === 'string' ? r.year : String(r.year ?? ''),
              title: typeof r.title === 'string' ? r.title : '',
              desc: typeof r.desc === 'string' ? r.desc : '',
            };
          })
          .filter((n): n is { year: string; title: string; desc: string } => n !== null);
      }
      return {
        field: input.field,
        value,
        warning: parseFailed ? 'AI 输出解析失败,请重试' : undefined,
      };
    }),

  /**
   * 五六-2:定点(重)生成某资产的某段设定(description 形象/场景/道具描述 · prompt 生图词 · bio 人物小传)。
   * 用「完整剧本」+「该资产已知设定」做上下文,支撑前端每段的「AI 重新生成」。建 attempt 审计。
   */
  generateAssetText: protectedProcedure
    .meta({
      agentTool: {
        description: '基于完整剧本 + 已知设定,(重)生成资产的 description/prompt/bio',
        sideEffects: ['extern.api:TextProvider', 'cost.deduct', 'db.create:GenerationAttempt'],
        costEstimateCny: 0.05,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        assetId: z.string().cuid(),
        field: z.enum(['description', 'prompt', 'bio']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      if (input.field === 'bio' && asset.type !== 'CHARACTER') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '人物小传仅人物资产适用' });
      }
      const settings = await loadSystemSettings(ctx.prisma, ['binding.asset.breakdown.modelId']);
      const modelId = settings['binding.asset.breakdown.modelId'];
      if (!modelId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '资产设定 AI 生成未配置 LLM — 去 /admin/bindings 配 binding.asset.breakdown.modelId',
        });
      }
      const provider = await getTextProvider(modelId);
      const { text: scriptText } = await loadProjectFullScript(ctx, asset.projectId, 40_000);

      const typeLabel = asset.type === 'CHARACTER' ? '人物' : asset.type === 'SCENE' ? '场景' : '道具';
      const known = [
        `姓名/名称:${asset.name}`,
        asset.characterRole ? `角色定位:${asset.characterRole}` : null,
        asset.gender ? `性别:${asset.gender}` : null,
        asset.age != null ? `年龄:${asset.age}` : null,
        asset.description ? `现有外形/描述:${asset.description}` : null,
        asset.bio ? `现有小传:${asset.bio}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      const FIELD_TASK: Record<typeof input.field, string> = {
        description:
          asset.type === 'CHARACTER'
            ? '人物形象设定(120-200字:脸型/五官/眼神 + 体型身高 + 发型发色 + 典型服饰款式材质配饰 + 标志特征/气质,稳定视觉锚,利于生图一致)'
            : asset.type === 'SCENE'
              ? '场景设定描述(120-200字:空间结构 + 陈设布局 + 材质色调 + 时段天气 + 光影方向质感 + 氛围情绪,尽量完善利于生图)'
              : '道具设定描述(80-150字:外形尺寸 + 材质工艺 + 年代磨损使用痕迹 + 颜色纹理 + 戏剧功能与象征)',
        prompt: '生图提示词(把视觉设定浓缩为可直接送图像模型的 spec,不含镜头/构图/机位词)',
        bio: '人物小传(200-400字:出身家世 + 核心动机/欲望/创伤 + 贯穿全剧人物弧光 + 与主要人物关系,基于剧本合理推演)',
      };

      const attemptStartedAt = new Date();
      const attempt = await ctx.prisma.generationAttempt.create({
        data: {
          projectId: asset.projectId,
          assetId: asset.id,
          providerId: modelId,
          modelId,
          action: 'TEXT',
          inputJson: { kind: 'asset.generateAssetText', field: input.field },
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
        result = await provider.generate(
          {
            system:
              '你是顶级影视制作设计 + 编剧。基于【完整剧本】和【已知设定】(重新)生成指定字段。严格只输出该字段正文,不要解释 / markdown / 字段名前缀。',
            prompt: `【完整剧本】\n${scriptText || '(暂无剧本,仅据已知设定专业发挥)'}\n\n【该${typeLabel}已知设定】\n${known}\n\n【任务】为「${asset.name}」生成${FIELD_TASK[input.field]}。`,
            // 五六-2:放宽到 4000 给 thinking 模型留推理预算(同 generateProfileField)
            maxTokens: 4000,
            temperature: 0.5,
          },
          { userId: ctx.user.id, projectId: asset.projectId, assetId: asset.id, attemptId: attempt.id },
        );
      } catch (e) {
        const failedAt = new Date();
        console.error('[asset.generateAssetText] LLM failed (raw):', e);
        const errMsg = sanitizeErrorMsg(e);
        await ctx.prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'FAILED',
            errorMsg: errMsg,
            finishedAt: failedAt,
            durationMs: failedAt.getTime() - attemptStartedAt.getTime(),
          },
        });
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: errMsg || 'AI 生成失败', cause: e });
      }

      const finishedAt = new Date();
      await ctx.prisma.generationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'SUCCESS',
          inputUnits: result.inputTokens,
          outputUnits: result.outputTokens,
          costCny: result.costCny.toFixed(4),
          finishedAt,
          durationMs: finishedAt.getTime() - attemptStartedAt.getTime(),
        },
      });

      return { field: input.field, value: result.text.trim() };
    }),

  // ---- 同步到美术工坊(2026-06 P1:剧本拆解文字定稿 → 翻转同步闸)----
  //   只把「未同步」的资产标记 syncedToArtAt=now(幂等);已同步的不重新覆盖,
  //   保证「最终以美术工坊微调为准」—— 同步只翻转闸、不复制/回灌数据。
  syncToArt: protectedProcedure
    .meta({
      agentTool: {
        description: '把剧本拆解定稿的资产同步到美术工坊(标记 syncedToArtAt;只处理未同步的)',
        sideEffects: ['db.updateMany:Asset', 'OperationLog.write'],
        costEstimateCny: 0,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        projectId: z.string().cuid(),
        // 不传 = 同步该项目所有「未同步」资产;传则只同步指定的
        assetIds: z.array(z.string().cuid()).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const result = await ctx.prisma.asset.updateMany({
        where: {
          projectId: input.projectId,
          deletedAt: null,
          syncedToArtAt: null, // 只翻转未同步的 → 已同步资产的美术工坊改动永不被覆盖
          ...(input.assetIds && input.assetIds.length > 0 ? { id: { in: input.assetIds } } : {}),
        },
        data: { syncedToArtAt: new Date() },
      });
      await logOperation(ctx, 'asset.syncToArt', 'asset', input.projectId, null, {
        projectId: input.projectId,
        syncedCount: result.count,
      });
      return { syncedCount: result.count };
    }),

  /**
   * 列出所有 active IMAGE Provider — 五六收工:美术工坊视觉生成器图片模型下拉
   *
   * 对齐 aigc.listVideoProviders 模式。原 GenerationPanel hardcode 3 个占位模型
   * (nano-banana-pro / gpt-image-2 / seedance-2.0),与真实 ProviderConfig 脱节。
   * 改读真实配置:默认空 = 用 binding.asset.image.providerId,用户可切换后传 input.modelId 覆盖。
   */
  listImageProviders: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.providerConfig.findMany({
      where: { kind: 'IMAGE', isActive: true },
      orderBy: [{ providerId: 'asc' }],
      select: { providerId: true, displayName: true },
    });
    return rows;
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

      // 读绑定 model + maxCharacters(三十二收工 S3 followup:helper batch)
      const settings = await loadSystemSettings(ctx.prisma, [
        'binding.asset.breakdown.modelId',
        'asset.breakdown.maxCharacters',
      ]);
      // 二十收工后用户反馈:不 hardcode 默认 provider,binding 空时显式拒绝
      const modelId = settings['binding.asset.breakdown.modelId'] ?? '';
      if (!modelId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '资产拆解未配置 LLM Provider — 请去 /admin/bindings 选择 binding.asset.breakdown.modelId',
        });
      }
      const maxCharacters = Number(settings['asset.breakdown.maxCharacters'] ?? '20');

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
   * 五六-2:从「完整剧本」拆解富设定 → 返回草稿(不写库,草稿审阅再应用)。
   * 聚合项目所有集当前剧本喂 LLM,产人物(形象 + 小传)/ 场景 / 道具富设定;
   * 每条附 matchedAssetId(按 archetypeKey/name 匹配已有资产),前端据此区分 新建/更新。
   */
  breakdownProject: protectedProcedure
    .meta({
      agentTool: {
        description: '从完整剧本拆解人物/场景/道具完整文字设定(形象+小传),返回草稿不入库',
        sideEffects: ['extern.api:TextProvider', 'cost.deduct', 'db.create:GenerationAttempt'],
        costEstimateCny: 0.5,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        projectId: z.string().cuid(),
        modelId: z.string().max(100).optional(),
        // 五六-2:分类型拆(整本剧本作上下文,只产一类)避免单请求超时;不传=一次全拆
        type: z.enum(['CHARACTER', 'SCENE', 'PROP']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const { text: scriptText, scriptCount } = await loadProjectFullScript(ctx, input.projectId);
      if (!scriptText.trim()) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '本项目还没有剧本 — 先在「剧本管理」上传,或从「灵感创作」关联剧本',
        });
      }

      const project = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
        include: { style: true },
      });
      const settings = await loadSystemSettings(ctx.prisma, ['binding.asset.breakdown.modelId']);
      const modelId = input.modelId ?? settings['binding.asset.breakdown.modelId'] ?? '';
      if (!modelId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '剧本拆解未配置 LLM — 去 /admin/bindings 配 binding.asset.breakdown.modelId',
        });
      }

      const attemptStartedAt = new Date();
      const attempt = await ctx.prisma.generationAttempt.create({
        data: {
          projectId: input.projectId,
          providerId: modelId,
          modelId,
          action: 'TEXT',
          inputJson: { kind: 'asset.breakdownProject', scriptCount, focusType: input.type, styleSlug: project?.style?.slug },
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
        result = await breakdownFullSettings({
          scriptText,
          projectType: project?.type,
          styleSlug: project?.style?.slug,
          modelId,
          maxCharacters: 40,
          focusType: input.type,
          ctx: { userId: ctx.user.id, projectId: input.projectId, attemptId: attempt.id },
        });
      } catch (e) {
        const failedAt = new Date();
        console.error('[asset.breakdownProject] LLM failed (raw):', e);
        const errMsg = sanitizeErrorMsg(e);
        await ctx.prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'FAILED',
            errorMsg: errMsg,
            finishedAt: failedAt,
            durationMs: failedAt.getTime() - attemptStartedAt.getTime(),
          },
        });
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: errMsg || '剧本拆解失败', cause: e });
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

      // 匹配已有资产(archetypeKey 优先,其次 name + 同 type)→ 前端区分 新建/更新
      const existing = await ctx.prisma.asset.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        select: { id: true, name: true, archetypeKey: true, type: true },
      });
      const matchOf = (
        name: string,
        archetypeKey: string | undefined,
        type: 'CHARACTER' | 'SCENE' | 'PROP',
      ): string | undefined => {
        if (archetypeKey) {
          const m = existing.find((a) => a.archetypeKey === archetypeKey && a.type === type);
          if (m) return m.id;
        }
        return existing.find((a) => a.name === name && a.type === type)?.id;
      };

      await logOperation(ctx, 'asset.breakdownProject', 'project', input.projectId, null, {
        scriptCount,
        characters: result.characters.length,
        scenes: result.scenes.length,
        props: result.props.length,
        cost: result.cost,
        modelId,
      });

      return {
        characters: result.characters.map((d) => ({
          ...d,
          type: 'CHARACTER' as const,
          matchedAssetId: matchOf(d.name, d.archetypeKey, 'CHARACTER'),
        })),
        scenes: result.scenes.map((d) => ({
          ...d,
          type: 'SCENE' as const,
          matchedAssetId: matchOf(d.name, d.archetypeKey, 'SCENE'),
        })),
        props: result.props.map((d) => ({
          ...d,
          type: 'PROP' as const,
          matchedAssetId: matchOf(d.name, d.archetypeKey, 'PROP'),
        })),
        cost: result.cost,
        modelId,
        scriptCount,
        warning: result.warning,
      };
    }),

  /**
   * 五六-2:应用拆解草稿 — 逐条 create 新的 / update 匹配的(草稿审阅再应用)。
   * create 跳过重名;update 跳过已锁定;只写用户审阅过的字段。
   */
  applyBreakdown: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        items: z
          .array(
            DraftInputSchema.extend({
              mode: z.enum(['create', 'update']),
              assetId: z.string().cuid().optional(),
            }),
          )
          .min(1)
          .max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const creates = input.items.filter((i) => i.mode === 'create');
      const updates = input.items.filter((i) => i.mode === 'update' && i.assetId);

      // 创建:跳过同项目重名
      const existing = await ctx.prisma.asset.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        select: { name: true },
      });
      const names = new Set(existing.map((a) => a.name));
      const toCreate = creates.filter((i) => {
        if (names.has(i.name)) return false;
        names.add(i.name);
        return true;
      });
      const skippedNames = creates.filter((i) => !toCreate.includes(i)).map((i) => i.name);

      // 更新:校验存在 + 同项目 + 未删 + 未锁
      const updIds = updates.map((u) => u.assetId!).filter(Boolean);
      const valid =
        updIds.length > 0
          ? await ctx.prisma.asset.findMany({
              where: { id: { in: updIds }, projectId: input.projectId, deletedAt: null },
              select: { id: true, lockedAt: true },
            })
          : [];
      const validMap = new Map(valid.map((a) => [a.id, a]));

      const result = await ctx.prisma.$transaction(async (tx) => {
        const created =
          toCreate.length > 0
            ? await tx.asset.createManyAndReturn({
                data: toCreate.map(({ mode: _m, assetId: _a, profileJson, ...d }) => ({
                  projectId: input.projectId,
                  ...d,
                  ...(profileJson !== undefined
                    ? { profileJson: profileJson as Prisma.InputJsonValue }
                    : {}),
                })),
                select: { id: true, name: true, type: true },
              })
            : [];
        let updatedCount = 0;
        const skippedLocked: string[] = [];
        for (const u of updates) {
          const v = validMap.get(u.assetId!);
          if (!v) continue;
          if (v.lockedAt) {
            skippedLocked.push(u.name);
            continue;
          }
          const { mode: _m, assetId, profileJson, ...patch } = u;
          await tx.asset.update({
            where: { id: assetId! },
            data: {
              ...patch,
              ...(profileJson !== undefined
                ? { profileJson: profileJson as Prisma.InputJsonValue }
                : {}),
            },
          });
          updatedCount++;
        }
        return { created, updatedCount, skippedLocked };
      });

      await logOperation(ctx, 'asset.applyBreakdown', 'project', input.projectId, null, {
        created: result.created.length,
        updated: result.updatedCount,
        skippedNames,
        skippedLocked: result.skippedLocked,
      });
      return {
        created: result.created,
        updated: result.updatedCount,
        skippedNames,
        skippedLocked: result.skippedLocked,
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
        // 五七-3:图生图参考图(mediaId)+ 强度 + 负面词
        refImageIds: z.array(z.string().cuid()).max(16).optional(),
        strength: z.number().min(0).max(1).optional(),
        extraNegative: z.array(z.string().max(50)).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);

      // 项目风格
      const project = await ctx.prisma.project.findUnique({
        where: { id: asset.projectId },
        include: { style: true },
      });

      // 读 binding(三十二收工 S3 followup:helper batch)
      const imgSettings = await loadSystemSettings(ctx.prisma, [
        'binding.asset.image.providerId',
        'binding.asset.panorama.providerId',
      ]);
      // 二十收工后用户反馈:不 hardcode 默认 provider,binding 空时显式拒绝(input.modelId 优先,测试调试用)
      const providerId =
        input.modelId ??
        (input.slot === 'panorama'
          ? imgSettings['binding.asset.panorama.providerId'] ?? ''
          : imgSettings['binding.asset.image.providerId'] ?? '');
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
        extraNegative: input.extraNegative,
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

      // 五七-3:解析参考图 mediaId → 可 fetch 的 http URL(给图生图 /images/edits;adapter 会 fetch bytes)
      let refImageUrls: string[] | undefined;
      if (input.refImageIds && input.refImageIds.length > 0) {
        const refMedias = await ctx.prisma.mediaItem.findMany({
          where: { id: { in: input.refImageIds }, deletedAt: null },
          select: { storageKey: true, cdnUrl: true },
        });
        const storage = getStorageAdapter();
        const urls: string[] = [];
        for (const m of refMedias) {
          if (m.cdnUrl) {
            urls.push(m.cdnUrl);
          } else if (m.storageKey.startsWith('external://')) {
            urls.push(m.storageKey.replace(/^external:\/\//, ''));
          } else if (m.storageKey.startsWith('placeholder://')) {
            // mock 占位图无法 fetch,跳过
          } else {
            try {
              urls.push(await storage.getSignedUrl(m.storageKey, 3600));
            } catch {
              /* sign 失败跳过该参考图 */
            }
          }
        }
        refImageUrls = urls.length > 0 ? urls : undefined;
      }

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
            // 五八-fix:不要把 input.modelId(= providerId,带 moyu- 前缀)当 model 名发给中转站!
            //   providerId 只用于上面 getImageProvider() 选配置;真实模型名由该配置 defaultModel 提供
            //   (adapter:req.model ?? cfg.defaultModel)。原来误传 providerId → moyu 找不到模型 → 无可用渠道(从没到引擎)。
            refImageUrls,
            ...(input.strength != null ? { extra: { strength: input.strength } } : {}),
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
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId, { skipLockCheck: true });

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
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId, { skipLockCheck: true });

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

});
