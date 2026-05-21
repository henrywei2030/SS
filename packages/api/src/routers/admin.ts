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
import { z } from 'zod';

import {
  listProviderConfigs,
  setProviderApiKey,
  clearProviderApiKey,
  setProviderActive,
} from '@ss/adapters/provider';

import { router, adminProcedure } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';

// ---------------------------------------------------------------------------
// admin.provider
// ---------------------------------------------------------------------------

const providerRouter = router({
  list: adminProcedure.query(async () => {
    return listProviderConfigs();
  }),

  get: adminProcedure
    .input(z.object({ providerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const all = await listProviderConfigs();
      const one = all.find((p) => p.providerId === input.providerId);
      if (!one) throw new TRPCError({ code: 'NOT_FOUND' });
      void ctx;
      return one;
    }),

  setApiKey: adminProcedure
    .input(
      z.object({
        providerId: z.string(),
        apiKey: z.string().min(8, 'API Key 至少 8 字符'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await setProviderApiKey(input.providerId, input.apiKey, ctx.user.id);
      await logOperation(ctx, 'provider.setApiKey', 'provider', input.providerId, null, {
        keyMasked: '••••' + input.apiKey.slice(-4),
      });
      return { success: true };
    }),

  clearApiKey: adminProcedure
    .input(z.object({ providerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await clearProviderApiKey(input.providerId, ctx.user.id);
      await logOperation(ctx, 'provider.clearApiKey', 'provider', input.providerId, null, null);
      return { success: true };
    }),

  setActive: adminProcedure
    .input(z.object({ providerId: z.string(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await setProviderActive(input.providerId, input.isActive, ctx.user.id);
      await logOperation(ctx, 'provider.setActive', 'provider', input.providerId, null, {
        isActive: input.isActive,
      });
      return { success: true };
    }),

  updatePricing: adminProcedure
    .input(
      z.object({
        providerId: z.string(),
        unitPriceCny: z.number().nonnegative(),
        unitName: z.string(),
        maxConcurrent: z.number().int().positive().optional(),
        rateLimitRpm: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.providerConfig.findUnique({
        where: { providerId: input.providerId },
      });
      const updated = await ctx.prisma.providerConfig.update({
        where: { providerId: input.providerId },
        data: {
          unitPriceCny: input.unitPriceCny,
          unitName: input.unitName,
          ...(input.maxConcurrent !== undefined && { maxConcurrent: input.maxConcurrent }),
          ...(input.rateLimitRpm !== undefined && { rateLimitRpm: input.rateLimitRpm }),
        },
      });
      await logOperation(ctx, 'provider.updatePricing', 'provider', input.providerId, before, updated);
      return updated;
    }),

  /** 测试连接 — W2.7 实现真实测试调用，先占位 */
  testConnection: adminProcedure
    .input(z.object({ providerId: z.string() }))
    .mutation(async ({ input }) => {
      // TODO: 拉取 provider 实例 + 跑最小调用
      return {
        success: true,
        providerId: input.providerId,
        latencyMs: 0,
        message: 'W2.7 测试连接未实现',
      };
    }),
});

// ---------------------------------------------------------------------------
// admin.style
// ---------------------------------------------------------------------------

const styleRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.prisma.styleProfile.findMany({ orderBy: { name: 'asc' } });
  }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        characterPrompt: z.string().optional(),
        scenePrompt: z.string().optional(),
        propPrompt: z.string().optional(),
        forbiddenWords: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const before = await ctx.prisma.styleProfile.findUnique({ where: { id } });
      const updated = await ctx.prisma.styleProfile.update({ where: { id }, data });
      await logOperation(ctx, 'style.update', 'style', id, before, updated);
      return updated;
    }),
});

// ---------------------------------------------------------------------------
// admin.prompt
// ---------------------------------------------------------------------------

const promptRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.prisma.promptTemplate.findMany({
      orderBy: [{ category: 'asc' }, { slug: 'asc' }],
    });
  }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        content: z.string().min(1),
        description: z.string().optional(),
        modelHint: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const before = await ctx.prisma.promptTemplate.findUnique({ where: { id } });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });

      // 同时存历史版本
      await ctx.prisma.promptTemplateVersion.create({
        data: {
          templateId: id,
          versionTag: `v${Date.now()}`,
          content: before.content,
          varsJson: before.varsJson ?? {},
          changeLog: 'auto-saved before edit',
          createdBy: ctx.user.id,
        },
      });

      const updated = await ctx.prisma.promptTemplate.update({ where: { id }, data });
      await logOperation(ctx, 'prompt.update', 'prompt', id, before, updated);
      return updated;
    }),
});

// ---------------------------------------------------------------------------
// admin.system
// ---------------------------------------------------------------------------

const systemRouter = router({
  listSettings: adminProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.prisma.systemSetting.findMany({
        where: input?.category ? { category: input.category } : {},
        orderBy: { key: 'asc' },
      });
    }),

  setSetting: adminProcedure
    .input(
      z.object({
        key: z.string(),
        value: z.string(),
        category: z.string().default('general'),
        description: z.string().optional(),
        isSecret: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.systemSetting.findUnique({ where: { key: input.key } });
      const setting = await ctx.prisma.systemSetting.upsert({
        where: { key: input.key },
        create: {
          ...input,
          updatedBy: ctx.user.id,
        },
        update: {
          value: input.value,
          description: input.description,
          category: input.category,
          updatedBy: ctx.user.id,
          ...(input.isSecret !== undefined && { isSecret: input.isSecret }),
        },
      });
      await logOperation(ctx, 'system.setSetting', 'systemSetting', setting.id, before, setting);
      return setting;
    }),
});

// ---------------------------------------------------------------------------
// 聚合
// ---------------------------------------------------------------------------

export const adminRouter = router({
  provider: providerRouter,
  style: styleRouter,
  prompt: promptRouter,
  system: systemRouter,
});
