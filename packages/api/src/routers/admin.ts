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
// admin.binding — 模型用途绑定
//
// "把哪个 LLM 用在哪个业务环节"的集中管理。
// 例：剧本分析 / 分镜生成 / 提示词生成 → 各自绑定一个 modelId（来自 ProviderConfig）。
// 数据落地在 SystemSetting，key 形如 `binding.<module>.<purpose>.modelId`。
// ---------------------------------------------------------------------------

export interface BindingItem {
  key: string;
  value: string;
  description: string | null;
  kind: 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'COMPLIANCE' | 'EMBEDDING' | 'OTHER';
  options: Array<{
    providerId: string;
    displayName: string;
    isActive: boolean;
  }>;
}

/** 从 binding key 推断业务期望的 ProviderKind */
function bindingKindOf(key: string): BindingItem['kind'] {
  if (key.includes('docx.parser')) return 'OTHER'; // 非 LLM
  if (key.includes('modelId')) {
    if (key.includes('image')) return 'IMAGE';
    if (key.includes('video')) return 'VIDEO';
    if (key.includes('audio') || key.includes('voice')) return 'AUDIO';
    if (key.includes('compliance')) return 'COMPLIANCE';
    if (key.includes('embedding')) return 'EMBEDDING';
    return 'TEXT'; // 默认 LLM
  }
  return 'OTHER';
}

const bindingRouter = router({
  /** 列出所有 binding.* 设置，并为每条带上候选 provider 列表 */
  list: adminProcedure.query(async ({ ctx }) => {
    const settings = await ctx.prisma.systemSetting.findMany({
      where: { category: 'model_binding' },
      orderBy: { key: 'asc' },
    });
    const providers = await ctx.prisma.providerConfig.findMany({
      orderBy: [{ kind: 'asc' }, { displayName: 'asc' }],
    });

    return settings.map((s): BindingItem => {
      const kind = bindingKindOf(s.key);
      // OTHER 类（如 docx.parser）不限定 kind，全列；其它按 kind 过滤
      const options =
        kind === 'OTHER'
          ? providers
          : providers.filter((p) => p.kind === kind);
      return {
        key: s.key,
        value: s.value,
        description: s.description,
        kind,
        options: options.map((p) => ({
          providerId: p.providerId,
          displayName: p.displayName,
          isActive: p.isActive,
        })),
      };
    });
  }),

  /** 设置某一绑定 — 与 admin.system.setSetting 等价但带强校验 */
  set: adminProcedure
    .input(
      z.object({
        key: z.string().regex(/^binding\./, '只允许修改 binding.* 类设置'),
        value: z.string().min(1, '值不能为空'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.systemSetting.findUnique({ where: { key: input.key } });
      if (!before) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '绑定 key 不存在' });
      }

      // 校验 value 必须是某个真实 provider（OTHER 类不校验，如 docx.parser=mammoth）
      const kind = bindingKindOf(input.key);
      if (kind !== 'OTHER') {
        const provider = await ctx.prisma.providerConfig.findFirst({
          where: { providerId: input.value, kind: kind },
        });
        if (!provider) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `provider ${input.value}（kind=${kind}）不存在或类型不匹配`,
          });
        }
      }

      const updated = await ctx.prisma.systemSetting.update({
        where: { key: input.key },
        data: { value: input.value, updatedBy: ctx.user.id },
      });
      await logOperation(ctx, 'binding.set', 'systemSetting', updated.id, before, updated);
      return updated;
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
  binding: bindingRouter,
});
