/**
 * Notification Router — M0 基建(2026-06-10,蓝图 docs/06 §3 M0)
 *
 * Notification 表读侧 + 已读管理;写入统一走 @ss/core/notify(落库 + 可选 webhook)。
 * 所有读写按 ctx.user.id scope,无跨用户访问面。
 */
import { z } from 'zod';

import { notify } from '@ss/core/notify';

import { router, protectedProcedure, adminProcedure } from '../trpc.js';

export const notificationRouter = router({
  /** 最新通知(铃铛下拉用)— 默认 10 条,unreadOnly 可只拉未读 */
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).default(10),
          unreadOnly: z.boolean().default(false),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.notification.findMany({
        where: {
          userId: ctx.user.id,
          ...(input?.unreadOnly ? { isRead: false } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: input?.limit ?? 10,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          isRead: true,
          createdAt: true,
        },
      });
    }),

  /** 未读数(铃铛红点,30s 轮询) */
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const count = await ctx.prisma.notification.count({
      where: { userId: ctx.user.id, isRead: false },
    });
    return { count };
  }),

  /** 标记已读(只能标自己的,where 双条件防越权) */
  markRead: protectedProcedure
    .input(z.object({ ids: z.array(z.string().cuid()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.prisma.notification.updateMany({
        where: { id: { in: input.ids }, userId: ctx.user.id, isRead: false },
        data: { isRead: true },
      });
      return { updated: res.count };
    }),

  /** 全部已读 */
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const res = await ctx.prisma.notification.updateMany({
      where: { userId: ctx.user.id, isRead: false },
      data: { isRead: true },
    });
    return { updated: res.count };
  }),

  /**
   * 发测试通知(admin)— M0 验收口 + 日后配 webhook 后的联通自检:
   * 给自己落一条 + 走一遍 webhook 外推,返回外推状态(sent/failed/disabled)。
   */
  sendTest: adminProcedure.mutation(async ({ ctx }) => {
    return notify(ctx.prisma, {
      userId: ctx.user.id,
      type: 'system',
      title: '测试通知',
      body: '通知链路联通性测试(落库 + webhook)。看到这条说明铃铛已工作;webhook 状态见返回值。',
      payload: { source: 'notification.sendTest' },
    });
  }),
});
