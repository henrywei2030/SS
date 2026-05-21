/**
 * Me Router — 当前用户的查询与设置
 */
import { z } from 'zod';

import { router, protectedProcedure } from '../trpc.js';

export const meRouter = router({
  /** 当前会话 */
  session: protectedProcedure.query(async ({ ctx }) => {
    return {
      user: ctx.user,
      locale: ctx.locale,
    };
  }),

  /** 切换语言（持久化到 User.locale） */
  setLocale: protectedProcedure
    .input(z.object({ locale: z.enum(['zh-CN', 'en']) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.user.update({
        where: { id: ctx.user.id },
        data: { locale: input.locale },
      });
      return { success: true, locale: input.locale };
    }),

  /** 我有权限的项目列表（简版） */
  projects: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.project.findMany({
      where: {
        OR: [{ ownerId: ctx.user.id }, { members: { some: { userId: ctx.user.id } } }],
        deletedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        type: true,
        aspect: true,
        updatedAt: true,
      },
    });
  }),
});
