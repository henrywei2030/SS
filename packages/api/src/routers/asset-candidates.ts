/**
 * Asset Router · 候选组(listCandidates / confirm / reject / unconfirmSlot)
 *
 * P2(ADR-31):从 asset.ts(god 路由)按组拆出的 sibling。纯搬运,无行为变化。
 * helper / schema / 常量见 ./asset-shared.ts;在 asset.ts 里 spread 回 assetRouter。
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getEventBus } from "@ss/adapters/eventbus";
import { EVENTS } from "@ss/shared";
import { protectedProcedure } from "../trpc.js";
import { logOperation } from "../middleware/audit.js";
import { assertProjectAccess } from "../middleware/access.js";
import { acquireTxAdvisoryLock } from "../utils/advisory-lock.js";
import { computeMaturity, loadAssetWithAccess, SLOT_FIELD, SlotSchema } from "./asset-shared.js";

export const candidatesProcedures = {
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
        await acquireTxAdvisoryLock(tx, 'asset_confirm', asset.id);
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
        await acquireTxAdvisoryLock(tx, 'asset_confirm', asset.id);
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

};
