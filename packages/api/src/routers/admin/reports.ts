/**
 * admin.reports — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
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
import { z } from 'zod';

import { router, adminProcedure } from '../../trpc.js';

// ---------------------------------------------------------------------------
// admin.reports — 工作报告(W6 波 3)
//
// 成员维度聚合(GenerationAttempt + CostLedgerEntry + OperationLog + EpisodeAssignment):
//   - 抽卡:success / failed / inflight 数
//   - 成本:cost(成功的累加)
//   - 活跃度:操作次数(OperationLog count)
//   - 责任:分配的集数 / 拥有项目 / 加入项目
//   - 上次活动:lastLoginAt 或最近 OperationLog
// 默认按 cost 降序(贡献最多的人在最上)
// ---------------------------------------------------------------------------

export interface UserWorkStats {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  status: string;
  isAdmin: boolean;
  ownedProjects: number;
  memberships: number;
  assignments: number;
  attemptSuccess: number;
  attemptFailed: number;
  attemptInflight: number;
  cost: number;
  operations: number;
  lastLoginAt: Date | null;
}

const reportsRouter = router({
  memberStats: adminProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - input.days * 86400 * 1000);

      const [
        attemptsByUser,
        costByUser,
        opsByUser,
        assignmentsByUser,
      ] = await Promise.all([
        ctx.prisma.generationAttempt.groupBy({
          by: ['createdBy', 'status'],
          // Prisma `not: null` 不被类型接受;用 NOT 包裹,或直接在循环内过滤(我选后者,见下方 if)
          where: { createdAt: { gte: since } },
          _count: { id: true },
        }),
        ctx.prisma.costLedgerEntry.groupBy({
          by: ['userId'],
          where: { createdAt: { gte: since }, success: true },
          _sum: { costCny: true },
        }),
        ctx.prisma.operationLog.groupBy({
          by: ['actorId'],
          where: { createdAt: { gte: since } },
          _count: { id: true },
        }),
        ctx.prisma.episodeAssignment.groupBy({
          by: ['userId'],
          _count: { id: true },
        }),
      ]);

      // 收集涉及的所有 userId(attemptsByUser 内 createdBy 可能 null,显式过滤)
      const userIds = new Set<string>();
      for (const a of attemptsByUser) {
        if (a.createdBy) userIds.add(a.createdBy);
      }
      for (const c of costByUser) userIds.add(c.userId);
      for (const o of opsByUser) userIds.add(o.actorId);
      for (const a of assignmentsByUser) userIds.add(a.userId);

      const users =
        userIds.size > 0
          ? await ctx.prisma.user.findMany({
              where: { id: { in: Array.from(userIds) }, deletedAt: null },
              select: {
                id: true,
                displayName: true,
                email: true,
                avatarUrl: true,
                status: true,
                isAdmin: true,
                lastLoginAt: true,
                _count: {
                  select: { ownedProjects: true, memberships: true },
                },
              },
            })
          : [];

      const userMap = new Map<string, UserWorkStats>();
      for (const u of users) {
        userMap.set(u.id, {
          userId: u.id,
          displayName: u.displayName,
          email: u.email,
          avatarUrl: u.avatarUrl,
          status: u.status,
          isAdmin: u.isAdmin,
          ownedProjects: u._count.ownedProjects,
          memberships: u._count.memberships,
          assignments: 0,
          attemptSuccess: 0,
          attemptFailed: 0,
          attemptInflight: 0,
          cost: 0,
          operations: 0,
          lastLoginAt: u.lastLoginAt,
        });
      }

      for (const a of attemptsByUser) {
        if (!a.createdBy) continue;
        const entry = userMap.get(a.createdBy);
        if (!entry) continue;
        const cnt = a._count.id;
        if (a.status === 'SUCCESS') entry.attemptSuccess = cnt;
        else if (a.status === 'FAILED') entry.attemptFailed = cnt;
        else if (a.status === 'QUEUED' || a.status === 'RUNNING')
          entry.attemptInflight += cnt;
      }
      for (const c of costByUser) {
        const entry = userMap.get(c.userId);
        if (entry) entry.cost = Number(c._sum.costCny ?? 0);
      }
      for (const o of opsByUser) {
        const entry = userMap.get(o.actorId);
        if (entry) entry.operations = o._count.id;
      }
      for (const a of assignmentsByUser) {
        const entry = userMap.get(a.userId);
        if (entry) entry.assignments = a._count.id;
      }

      const userStats = Array.from(userMap.values()).sort((a, b) => b.cost - a.cost);

      // 全局汇总
      const totalCost = userStats.reduce((s, u) => s + u.cost, 0);
      const totalOps = userStats.reduce((s, u) => s + u.operations, 0);
      const totalSuccess = userStats.reduce((s, u) => s + u.attemptSuccess, 0);
      const totalFailed = userStats.reduce((s, u) => s + u.attemptFailed, 0);

      return {
        days: input.days,
        totals: {
          totalCost: Number(totalCost.toFixed(4)),
          totalOps,
          totalSuccess,
          totalFailed,
          activeUsers: userStats.length,
        },
        userStats,
      };
    }),
});

export { reportsRouter };
