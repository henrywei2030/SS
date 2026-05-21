/**
 * Auth Router — 登录、注册、登出、改密
 */
import { z } from 'zod';

import { getAuthAdapter } from '@ss/adapters/auth';

import { router, publicProcedure, protectedProcedure } from '../trpc.js';

export const authRouter = router({
  login: publicProcedure
    .input(
      z.object({
        identifier: z.string().min(1, '请输入邮箱或用户名'),
        password: z.string().min(1, '请输入密码'),
      }),
    )
    .mutation(async ({ input }) => {
      const auth = getAuthAdapter();
      return auth.login(input);
    }),

  signup: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        username: z.string().min(3).max(40),
        displayName: z.string().min(1).max(60),
        password: z.string().min(8),
        locale: z.enum(['zh-CN', 'en']).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const auth = getAuthAdapter();
      return auth.signup(input);
    }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    const auth = getAuthAdapter();
    await auth.logout('');
    return { success: true, userId: ctx.user.id };
  }),

  changePassword: protectedProcedure
    .input(
      z.object({
        oldPassword: z.string().min(1),
        newPassword: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const auth = getAuthAdapter();
      await auth.changePassword(ctx.user.id, input.oldPassword, input.newPassword);
      return { success: true };
    }),
});
