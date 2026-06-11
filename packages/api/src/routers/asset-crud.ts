/**
 * Asset Router · CRUD 组(list/get/create/batchCreate/update/delete + relation + syncToArt)
 *
 * P2(ADR-31):从 asset.ts(god 路由)按组拆出的 sibling。纯搬运,无行为变化。
 * helper / schema / 常量见 ./asset-shared.ts;在 asset.ts 里 spread 回 assetRouter。
 */
import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "@ss/db";
import { asRecord } from "@ss/shared";
import { getStorageAdapter, buildStorageKey } from "@ss/adapters/storage";
import { extractVoiceLabel } from "@ss/core/asset";
import { normalizeAudio, normalizedVoiceFilename, probeMedia, syncMediaToRelay } from "@ss/core/media";
import {
  NANO_BUILTIN_VOICES,
  TTS_WEIGHTS_INSTALL_JOB_KIND,
  VOICE_SAMPLE_JOB_KIND,
  clearNanoWeightsCache,
  getNanoWeightsStatus,
  nanoModelsReady,
  recommendSeedVoice,
} from "@ss/core/voice";
import { enqueueJob } from "@ss/queue/job-queue";
import { protectedProcedure } from "../trpc.js";
import { logOperation } from "../middleware/audit.js";
import { assertProjectAccess } from "../middleware/access.js";
import { AssetTypeSchema, CharacterRoleSchema, computeMaturity, DraftInputSchema, loadAssetWithAccess, ProfileJsonSchema, recordAssetEdit, SLOT_FIELD } from "./asset-shared.js";

export const crudProcedures = {
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

      // M2′(2026-06-10):voiceMediaId 写入校验 — 原先不校验,可悬空/指向图片,
      // 视频生成 compile 时静默拿不到 URL,配音参考无声无息丢失
      if (input.patch.voiceMediaId) {
        const voiceMedia = await ctx.prisma.mediaItem.findFirst({
          where: { id: input.patch.voiceMediaId, kind: 'AUDIO', deletedAt: null },
          select: { id: true },
        });
        if (!voiceMedia) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: '参考音频无效:媒体不存在或不是音频类型',
          });
        }
      }

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

  /**
   * 批量软删资产(2026-06-08 剧本拆解清空/多选删除)。一个口覆盖三场景:
   *   - ids 指定   → 删这些(多选删除)
   *   - 否则 type  → 清空该类(单类清空)
   *   - 否则 confirmAll=true → 清空本项目全部资产(一键清空,防误触须显式 confirmAll)
   * 软删资产 + 关联 AssetUsageBinding(与单删 delete 同语义),严格限定 projectId 防越权。
   */
  deleteMany: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        ids: z.array(z.string().cuid()).max(1000).optional(),
        type: AssetTypeSchema.optional(),
        confirmAll: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const hasIds = !!input.ids && input.ids.length > 0;
      if (!hasIds && !input.type && !input.confirmAll) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '需指定 ids(多选删) / type(清空该类) / confirmAll(清空全部)之一',
        });
      }
      // 严格 scope projectId + 未删;ids 优先 > type > 全部
      const where: Prisma.AssetWhereInput = {
        projectId: input.projectId,
        deletedAt: null,
        ...(hasIds ? { id: { in: input.ids } } : input.type ? { type: input.type } : {}),
      };
      const targets = await ctx.prisma.asset.findMany({ where, select: { id: true } });
      const ids = targets.map((t) => t.id);
      if (ids.length === 0) return { deleted: 0 };
      const now = new Date();
      await ctx.prisma.$transaction([
        ctx.prisma.asset.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } }),
        ctx.prisma.assetUsageBinding.updateMany({
          where: { assetId: { in: ids }, deletedAt: null },
          data: { deletedAt: now },
        }),
      ]);
      await logOperation(
        ctx,
        'asset.deleteMany',
        'project',
        input.projectId,
        { count: ids.length, mode: hasIds ? 'ids' : input.type ? `type:${input.type}` : 'all' },
        null,
      );
      return { deleted: ids.length };
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
   * 参考音频一键规范化(M2′ 声线小工具 · 2026-06-10):
   * 掐头尾静音 + 响度归一(-16 LUFS)+ 截断 15s → 新 MediaItem(parentId 版本链)→ 改指 voiceMediaId。
   * 音频只有几秒,同步跑 ffmpeg(@ss/core/media),不入队。原音频保留可回退。
   */
  normalizeVoice: protectedProcedure
    .input(z.object({ assetId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      if (!asset.voiceMediaId) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '该角色还没有参考音频' });
      }
      const media = await ctx.prisma.mediaItem.findFirst({
        where: { id: asset.voiceMediaId, deletedAt: null },
        select: { id: true, storageKey: true, filename: true },
      });
      if (!media) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '参考音频媒体不存在' });
      }

      const storage = getStorageAdapter();
      const tmp = mkdtempSync(join(tmpdir(), 'ss-voice-norm-'));
      try {
        const inPath = join(tmp, 'in-audio');
        const outPath = join(tmp, 'out.m4a');
        if (media.storageKey.startsWith('external://')) {
          const res = await fetch(media.storageKey.slice('external://'.length), {
            signal: AbortSignal.timeout(60_000),
          });
          if (!res.ok || !res.body) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '参考音频外链拉取失败(可能已过期),请重新上传' });
          }
          await pipeline(Readable.fromWeb(res.body as never), createWriteStream(inPath));
        } else {
          await pipeline(await storage.getObject(media.storageKey), createWriteStream(inPath));
        }

        const beforeProbe = await probeMedia(inPath).catch(() => null);
        await normalizeAudio({ input: inPath, output: outPath });
        const afterProbe = await probeMedia(outPath);

        const outBuf = await readFile(outPath);
        const key = buildStorageKey({
          scope: 'project',
          projectId: asset.projectId,
          kind: 'audio',
          ext: 'm4a',
        });
        await storage.putObject(key, outBuf, { contentType: 'audio/mp4' });
        const normalizedName = normalizedVoiceFilename(media.filename ?? 'voice');
        // 六八:按开关 best-effort 同步中转站素材库(规范化产物是实际投喂 provider 的版本)
        const syncSetting = await ctx.prisma.systemSetting.findUnique({
          where: { key: 'voice.sample.syncToRelay' },
          select: { value: true },
        });
        const relayMeta =
          syncSetting?.value === 'true'
            ? await syncMediaToRelay({ storageKey: key, kind: 'AUDIO', filename: normalizedName })
            : null;
        const newMedia = await ctx.prisma.mediaItem.create({
          data: {
            projectId: asset.projectId,
            scope: 'PROJECT',
            kind: 'AUDIO',
            // 六八命名规范:原名_规范化(版本链可读)+ 归人物类便于素材库筛选
            filename: normalizedName,
            assetCategory: 'CHARACTER',
            mimeType: 'audio/mp4',
            sizeBytes: outBuf.length,
            storageKey: key,
            parentId: media.id, // 版本链:原音频保留,可在素材库回溯
            meta: {
              durationS: afterProbe.durationS,
              normalized: true,
              targetLufs: -16,
              sourceMediaId: media.id,
              ...(relayMeta ?? {}),
            },
            source: 'UPLOAD',
            sourceRef: `voice-normalize:${asset.id}`,
          },
          select: { id: true },
        });
        await ctx.prisma.asset.update({
          where: { id: asset.id },
          data: { voiceMediaId: newMedia.id },
        });

        await logOperation(ctx, 'asset.voice.normalize', 'asset', asset.id, null, {
          projectId: asset.projectId,
          fromMediaId: media.id,
          toMediaId: newMedia.id,
          beforeDurationS: beforeProbe?.durationS ?? null,
          afterDurationS: afterProbe.durationS,
        });

        return {
          mediaId: newMedia.id,
          beforeDurationS: beforeProbe?.durationS ?? null,
          afterDurationS: afterProbe.durationS,
        };
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }),

  /**
   * 声线种子清单(TTS-B)— 18 条内置 + 本地模型就绪状态(未就绪=首次生成会自动下载 ~850MB)。
   * 六八:传 assetId 时按角色设定(声音描述/性别/年龄)推荐种子声线,UI 默认选中。
   */
  listVoiceSeeds: protectedProcedure
    .input(z.object({ assetId: z.string().cuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      let recommended: ReturnType<typeof recommendSeedVoice> | null = null;
      if (input?.assetId) {
        const asset = await loadAssetWithAccess(ctx, input.assetId);
        recommended = recommendSeedVoice({
          gender: asset.gender,
          age: asset.age,
          voiceLabel: extractVoiceLabel(asset.profileJson),
        });
      }
      return {
        ready: nanoModelsReady(),
        seeds: NANO_BUILTIN_VOICES,
        recommended,
      };
    }),

  /**
   * 按角色设定生成参考声音样本(TTS-B · 2026-06-10):
   * 本地 MOSS-TTS-Nano(onnxruntime,零 Python 零扣费)→ queue kind `voice-sample` 异步跑
   * → 完成自动写 voiceMediaId + 铃铛通知。文案默认取角色独白/小传。
   */
  generateVoiceSample: protectedProcedure
    .input(
      z.object({
        assetId: z.string().cuid(),
        seedVoice: z.string().max(60).default('builtin:Yuewen'),
        textOverride: z.string().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      if (input.seedVoice === 'current' && !asset.voiceMediaId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '该角色还没有参考音频,无法用「克隆现有声线」',
        });
      }
      const jobId = await enqueueJob(
        VOICE_SAMPLE_JOB_KIND,
        {
          assetId: asset.id,
          userId: ctx.user.id,
          seedVoice: input.seedVoice,
          ...(input.textOverride ? { textOverride: input.textOverride } : {}),
        },
        { jobId: `voice-sample:${asset.id}:${Date.now().toString(36)}` },
      );
      await logOperation(ctx, 'asset.voice.generate', 'asset', asset.id, null, {
        projectId: asset.projectId,
        seedVoice: input.seedVoice,
        jobId,
      });
      return { queued: true, jobId, modelsReady: nanoModelsReady() };
    }),

  /**
   * 批量按设定生成声线(六八):项目内所有缺 voiceMediaId 的**主演/配角**,逐个用
   * recommendSeedVoice 推荐种子声线入队(本地 TTS 零扣费)。
   * 范围(用户定调):群演/未分类不需要声线 → 跳过(编辑面板手动生成不受限)。
   * silent=true 静默成功铃铛(防 N 连铃),失败仍逐条通知;完成后人物卡/编辑面板自动出现声线。
   */
  batchGenerateVoiceSamples: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const chars = await ctx.prisma.asset.findMany({
        where: {
          projectId: input.projectId,
          type: 'CHARACTER',
          deletedAt: null,
          voiceMediaId: null,
          // 六八:只有主演/配角需要参考声音(shared characterNeedsVoice 同口径)
          OR: [
            { characterRole: { startsWith: '主演' } },
            { characterRole: { startsWith: '配角' } },
          ],
        },
        select: { id: true, name: true, gender: true, age: true, profileJson: true },
        orderBy: { name: 'asc' },
        take: 100, // 单次上限,防极端项目把队列灌爆(够当前规模;超出再点一次)
      });
      const queued: Array<{ assetId: string; name: string; seed: string }> = [];
      for (const c of chars) {
        const rec = recommendSeedVoice({
          gender: c.gender,
          age: c.age,
          voiceLabel: extractVoiceLabel(c.profileJson),
        });
        await enqueueJob(
          VOICE_SAMPLE_JOB_KIND,
          {
            assetId: c.id,
            userId: ctx.user.id,
            seedVoice: `builtin:${rec.seed}`,
            silent: true,
          },
          { jobId: `voice-sample:${c.id}:${Date.now().toString(36)}` },
        );
        queued.push({ assetId: c.id, name: c.name, seed: rec.seed });
      }
      await logOperation(ctx, 'asset.voice.batchGenerate', 'project', input.projectId, null, {
        projectId: input.projectId,
        queuedCount: queued.length,
        seeds: queued.map((q) => `${q.name}:${q.seed}`),
      });
      return { queued: queued.length, items: queued, modelsReady: nanoModelsReady() };
    }),

  // =========================================================================
  // 七二(用户需求①):TTS 权重可观测安装 — 状态轮询 / 后台安装 / 清理缓存。
  // 此前 845MB 权重藏在首次声线 job 里同步下载(新环境实测 ~20 分钟),UI 零反馈。
  // =========================================================================

  /** 权重安装状态(UI 轮询;纯本地文件检查零网络) */
  voiceWeightsStatus: protectedProcedure.query(async () => {
    return getNanoWeightsStatus();
  }),

  /** 触发后台安装(job 进 ss-jobs;进度看 voiceWeightsStatus,完成/失败发铃铛) */
  voiceWeightsInstall: protectedProcedure.mutation(async ({ ctx }) => {
    const st = getNanoWeightsStatus();
    if (st.ready) return { queued: false, alreadyReady: true as const };
    const jobId = await enqueueJob(
      TTS_WEIGHTS_INSTALL_JOB_KIND,
      { userId: ctx.user.id },
      // 时间戳后缀防 bullmq 撞已完成 jobId;真正去重靠 ensureNanoModels 进程内单例
      { jobId: `tts-weights-install:${Date.now().toString(36)}` },
    );
    await logOperation(ctx, 'asset.voice.weightsInstall', 'system', 'tts-weights', null, {
      jobId,
    });
    return { queued: true, alreadyReady: false as const, jobId };
  }),

  /** 清理权重缓存(损坏自救/重装前;下载进行中拒绝) */
  voiceWeightsClear: protectedProcedure.mutation(async ({ ctx }) => {
    const r = clearNanoWeightsCache();
    await logOperation(ctx, 'asset.voice.weightsClear', 'system', 'tts-weights', null, {
      cleared: r.cleared,
      reason: r.reason ?? null,
    });
    return r;
  }),

};
