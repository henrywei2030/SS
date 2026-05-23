/**
 * Me Router — 当前用户的查询与设置
 */
import { z } from 'zod';

import { router, protectedProcedure } from '../trpc.js';
import {
  PRESET_KINDS,
  PRESET_KIND_LABELS,
  loadPresetValues,
} from './admin.js';

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

  /**
   * W7 audit R6:公开预设 endpoint(任何登录用户可调,业务侧 W3 storyboard / W5 aigc 用)
   * 跟 admin.preset.list 同源数据,只是 protectedProcedure 让普通用户也能拉
   */
  presets: protectedProcedure.query(async ({ ctx }) => {
    return Promise.all(
      PRESET_KINDS.map(async (kind) => {
        const { values, isDefault } = await loadPresetValues(ctx.prisma, kind);
        return {
          kind,
          label: PRESET_KIND_LABELS[kind],
          values,
          isDefault,
        };
      }),
    );
  }),
});
