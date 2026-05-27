/**
 * admin.episode — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
 *
 * 注:共享 admin.ts 的 import header,部分 import 在本文件可能未使用(默认 tsconfig 不强检 unused-locals)
 */
/**
 * Admin Router — 后台管理（仅 isAdmin 可访问）
 *
 * 子路由：
 *   - admin.provider  AI Provider 配置（W2 重点：API Key 在此设置）
 *   - admin.style     风格管理
 *   - admin.prompt    提示词模板
 *   - admin.system    系统设置
 *   - admin.user      全局用户管理
 */
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  listProviderConfigs,
  setProviderApiKey,
  clearProviderApiKey,
  setProviderActive,
  getTextProvider,
  getImageProvider,
  getVideoProvider,
  // Phase 1.5.1 multi-credential RelayProvider 管理(2026-05-25 升级)
  listRelayProviders,
  createRelayProvider,
  updateRelayProvider,
  setRelayProviderApiKey,
  clearRelayProviderApiKey,
  deleteRelayProvider,
} from '@ss/adapters/provider';
import { prisma } from '@ss/db';
import {
  sanitizeErrorMsg,
  listCatalogSummaries,
  findRelayModel,
  getRelayModels,
} from '@ss/shared';

import { router, adminProcedure, rateLimit } from '../../trpc.js';
import { logOperation } from '../../middleware/audit.js';
// 第 23 轮 audit P1:apiUrl SSRF 防御
import { validateApiUrl } from '../../utils/url-safety.js';

// ---------------------------------------------------------------------------
// admin.episode — 集级管理(W3.1.followup:软锁逃生口)
// ---------------------------------------------------------------------------

const episodeRouter = router({
  /**
   * 强制解锁卡死的 GENERATING 集 — 用于进程崩溃后业务侧无法自然 release 的兜底。
   *
   * 行为:
   *   - 仅在当前状态 = GENERATING 才允许;非 GENERATING 直接抛 BAD_REQUEST
   *   - status 归位 NOT_STARTED + 清 generatingStartedAt
   *   - 写 OperationLog,可审计
   */
  forceUnlock: adminProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.episode.findUnique({
        where: { id: input.episodeId },
        select: {
          id: true,
          status: true,
          generatingStartedAt: true,
          projectId: true,
        },
      });
      if (!before) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
      }
      if (before.status !== 'GENERATING') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '本集未处于生成中状态,无需解锁',
        });
      }

      const updated = await ctx.prisma.episode.update({
        where: { id: before.id },
        data: { status: 'NOT_STARTED', generatingStartedAt: null },
      });

      await logOperation(
        ctx,
        'episode.force_unlock',
        'episode',
        before.id,
        before,
        updated,
      );
      return { ok: true, previousStartedAt: before.generatingStartedAt };
    }),

  /**
   * 归档(软删)整集 — W1-W5 audit P2 followup(P2-1)
   *
   * 一并软删:
   *   - episode.deletedAt
   *   - 本集 scenes / shots / shotGroups
   *   - 指向本集 assetId 的 AssetUsageBinding(防 binding 悬空)
   *
   * 不删除:
   *   - generationAttempts(保留审计 + cost ledger 链路)
   *   - mediaItems(可能被其它项目复用)
   */
  archive: adminProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.episode.findUnique({
        where: { id: input.episodeId },
      });
      if (!before) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
      }
      if (before.deletedAt) {
        return { ok: true, alreadyArchived: true };
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
});


export { episodeRouter };
