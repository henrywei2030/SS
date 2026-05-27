/**
 * admin.user — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
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
// admin.user — 全局用户管理(W6 Collab Hub 波 1)
//
// 列表 + 搜索 + 状态筛选 + 启用/禁用 + 设/取消管理员
//
// 安全:
//   - 不能取消自己的 admin / 不能 SUSPEND 自己(防误锁后台)
//   - 不暴露 passwordHash(select 显式排除)
//   - 不做硬删(只软删/SUSPEND,审计可追溯)
// ---------------------------------------------------------------------------

const userRouter = router({
  list: adminProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(10).max(100).default(50),
        search: z.string().max(100).optional(),
        status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING']).optional(),
        isAdmin: z.boolean().optional(),
        includeDeleted: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (!input.includeDeleted) where.deletedAt = null;
      if (input.status) where.status = input.status;
      if (input.isAdmin !== undefined) where.isAdmin = input.isAdmin;
      if (input.search && input.search.trim()) {
        const s = input.search.trim();
        where.OR = [
          { email: { contains: s, mode: 'insensitive' } },
          { username: { contains: s, mode: 'insensitive' } },
          { displayName: { contains: s, mode: 'insensitive' } },
        ];
      }

      const [users, total] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          orderBy: [{ isAdmin: 'desc' }, { createdAt: 'desc' }],
          take: input.pageSize,
          skip: (input.page - 1) * input.pageSize,
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            locale: true,
            timezone: true,
            status: true,
            isAdmin: true,
            lastLoginAt: true,
            createdAt: true,
            deletedAt: true,
            _count: {
              select: {
                ownedProjects: true,
                memberships: true,
              },
            },
          },
        }),
        ctx.prisma.user.count({ where }),
      ]);

      return {
        users,
        total,
        page: input.page,
        pageSize: input.pageSize,
        hasMore: input.page * input.pageSize < total,
      };
    }),

  setStatus: adminProcedure
    .input(
      z.object({
        userId: z.string().cuid(),
        status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 安全:不能 SUSPEND 自己(防误锁后台)
      if (input.userId === ctx.user.id && input.status === 'SUSPENDED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '不能 SUSPEND 自己 — 请让其他管理员操作',
        });
      }
      const before = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, status: true, email: true, displayName: true, isAdmin: true },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND', message: '用户不存在' });
      const updated = await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { status: input.status },
        select: { id: true, status: true, displayName: true },
      });
      await logOperation(
        ctx,
        'admin.user.setStatus',
        'user',
        updated.id,
        before,
        { ...before, status: updated.status },
      );
      return updated;
    }),

  setAdmin: adminProcedure
    .input(z.object({ userId: z.string().cuid(), isAdmin: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      // 安全:不能取消自己的 admin(防自锁)
      if (input.userId === ctx.user.id && input.isAdmin === false) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '不能取消自己的管理员权限 — 请让其他管理员操作',
        });
      }
      // 安全:取消 admin 时保证系统至少留一个活跃 admin(防全部取消导致后台无人管)
      if (input.isAdmin === false) {
        const remainingAdmins = await ctx.prisma.user.count({
          where: { isAdmin: true, deletedAt: null, status: 'ACTIVE', id: { not: input.userId } },
        });
        if (remainingAdmins === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '系统至少要保留一个活跃管理员,不能取消最后一个 admin',
          });
        }
      }
      const before = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, isAdmin: true, email: true, displayName: true },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND', message: '用户不存在' });
      const updated = await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { isAdmin: input.isAdmin },
        select: { id: true, isAdmin: true, displayName: true },
      });
      await logOperation(
        ctx,
        'admin.user.setAdmin',
        'user',
        updated.id,
        before,
        { ...before, isAdmin: updated.isAdmin },
      );
      return updated;
    }),

  // 统计:多少活跃用户 / 多少管理员 / 多少 SUSPENDED(给 header 显示)
  stats: adminProcedure.query(async ({ ctx }) => {
    const [active, suspended, pending, admins, total] = await Promise.all([
      ctx.prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      ctx.prisma.user.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
      ctx.prisma.user.count({ where: { deletedAt: null, status: 'PENDING' } }),
      ctx.prisma.user.count({ where: { deletedAt: null, isAdmin: true } }),
      ctx.prisma.user.count({ where: { deletedAt: null } }),
    ]);
    return { active, suspended, pending, admins, total };
  }),
});


export { userRouter };
