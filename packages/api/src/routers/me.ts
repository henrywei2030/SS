/**
 * Me Router — 当前用户的查询与设置
 */
import { z } from 'zod';

import { router, protectedProcedure } from '../trpc.js';
import {
  PRESET_KINDS,
  PRESET_KIND_LABELS,
  loadPresetValues,
} from './admin/preset.js';
// 三十二收工 S3 followup:batch SystemSetting 读 helper
import { loadSystemSettings } from '../utils/system-bindings.js';

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

  /**
   * W1-W5 audit P2 followup(P2-5):公开品牌 + 系统配置 endpoint
   *
   * 接通 5 条原本 dead 的 SystemSetting:
   *   - system.locale.default
   *   - system.brand.name_cn / name_en / tagline_cn
   *   - system.gacha.max_attempts(也由 aigc.generateVideo 内联校验)
   *   - system.budget.warn_pct
   *
   * 前端 layout / 项目页拿这个填 logo title + 抽卡上限提示 + 预算颜色档位。
   */
  systemBranding: protectedProcedure.query(async ({ ctx }) => {
    // 三十二收工 S3 followup:helper batch
    const settings = await loadSystemSettings(ctx.prisma, [
      'system.locale.default',
      'system.brand.name_cn',
      'system.brand.name_en',
      'system.brand.tagline_cn',
      'system.gacha.max_attempts',
      'system.budget.warn_pct',
    ]);
    return {
      defaultLocale: settings['system.locale.default'] ?? 'zh-CN',
      brandNameCn: settings['system.brand.name_cn'] ?? '星垣工坊',
      brandNameEn: settings['system.brand.name_en'] ?? 'StarsAlign Studio',
      brandTaglineCn: settings['system.brand.tagline_cn'] ?? '',
      gachaMaxAttempts: Number(settings['system.gacha.max_attempts'] ?? '5'),
      budgetWarnPct: Number(settings['system.budget.warn_pct'] ?? '80'),
    };
  }),
});
