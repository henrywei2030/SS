/**
 * Auth Router — 登录、注册、登出、改密
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getAuthAdapter } from '@ss/adapters/auth';

import { router, publicProcedure, protectedProcedure, rateLimit } from '../trpc.js';

export const authRouter = router({
  // W7 audit R8 P0:auth.login 加 rate limit(防撞密码),per-IP 5 次 / 60s
  login: publicProcedure
    .use(
      rateLimit({
        key: (ctx) => `login:${ctx.ip ?? 'no-ip'}`,
        max: 5,
        windowMs: 60_000,
        message: '登录过快(每分钟最多 5 次),请稍候再试',
      }),
    )
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
        // 密码强度:8 字符以上 + 至少含字母 + 数字(防"12345678" / "password" 等弱密码)
        password: z
          .string()
          .min(8, '密码至少 8 字符')
          .regex(/[A-Za-z]/, '密码必须含字母')
          .regex(/[0-9]/, '密码必须含数字'),
        locale: z.enum(['zh-CN', 'en']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 公开注册由 SystemSetting `auth.allowSignup` 控制(默认关)
      // 防任何人能注册账号 → 横向漏洞;本地部署可在 admin UI 显式开启
      const setting = await ctx.prisma.systemSetting.findUnique({
        where: { key: 'auth.allowSignup' },
      });
      const allowSignup = setting?.value === 'true';
      if (!allowSignup) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '公开注册已关闭 — 请联系管理员添加账号,或先在 SystemSetting 开启 auth.allowSignup',
        });
      }
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
