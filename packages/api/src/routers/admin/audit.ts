/**
 * admin.audit — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
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
// admin.audit — OperationLog 浏览(W7)
//
// 全局审计日志:分页 + 筛选 actor / action / targetType / projectId / 时间。
// 提供 distinctActions / distinctTargetTypes 给筛选下拉用。
// ---------------------------------------------------------------------------

const auditRouter = router({
  list: adminProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(10).max(100).default(50),
        actorId: z.string().cuid().optional(),
        action: z.string().max(100).optional(),
        targetType: z.string().max(50).optional(),
        projectId: z.string().cuid().optional(),
        since: z.string().datetime().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.actorId) where.actorId = input.actorId;
      // audit 修 P0-2 → P2:contains 大小写不敏感(用户搜 "Aigc" 应找到 "aigc.generate")
      if (input.action) where.action = { contains: input.action, mode: 'insensitive' };
      if (input.targetType) where.targetType = input.targetType;
      if (input.projectId) where.projectId = input.projectId;
      if (input.since) where.createdAt = { gte: new Date(input.since) };

      const [logs, total] = await Promise.all([
        ctx.prisma.operationLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: input.pageSize,
          skip: (input.page - 1) * input.pageSize,
          include: {
            user: { select: { displayName: true, email: true } },
            project: { select: { name: true } },
          },
        }),
        ctx.prisma.operationLog.count({ where }),
      ]);

      return {
        logs: logs.map((l) => ({
          id: l.id,
          actorId: l.actorId,
          actorName: l.user.displayName ?? l.user.email,
          projectId: l.projectId,
          projectName: l.project?.name ?? null,
          action: l.action,
          targetType: l.targetType,
          targetId: l.targetId,
          beforeJson: l.beforeJson,
          afterJson: l.afterJson,
          ip: l.ip,
          userAgent: l.userAgent,
          createdAt: l.createdAt,
        })),
        total,
        page: input.page,
        pageSize: input.pageSize,
        hasMore: input.page * input.pageSize < total,
      };
    }),

  distinctActions: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.operationLog.groupBy({
      by: ['action'],
      _count: { _all: true },
      orderBy: { _count: { action: 'desc' } },
      take: 50,
    });
    return rows.map((r) => ({ action: r.action, count: r._count._all }));
  }),

  distinctTargetTypes: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.operationLog.groupBy({
      by: ['targetType'],
      _count: { _all: true },
      orderBy: { _count: { targetType: 'desc' } },
    });
    return rows.map((r) => ({ targetType: r.targetType, count: r._count._all }));
  }),
});


export { auditRouter };
