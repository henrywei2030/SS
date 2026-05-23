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
    return ctx.prisma.styleProfile.findMany({ orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }] });
  }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        name: z.string().min(1).max(100).optional(),
        characterPrompt: z.string().optional(),
        scenePrompt: z.string().optional(),
        propPrompt: z.string().optional(),
        forbiddenWords: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const before = await ctx.prisma.styleProfile.findUnique({ where: { id } });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
      // 内置风格 slug 不能改名(避免破坏代码里的硬引用)
      if (before.isBuiltIn && data.name && data.name !== before.name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '内置风格不能改名' });
      }
      const updated = await ctx.prisma.styleProfile.update({ where: { id }, data });
      await logOperation(ctx, 'style.update', 'style', id, before, updated);
      return updated;
    }),

  /** W7:新建自定义风格 — W7 audit R5:加 slug 内置黑名单防业务硬编码 fallback 失效 */
  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        slug: z
          .string()
          .min(2)
          .max(50)
          .regex(/^[a-z0-9_]+$/, 'slug 只允许小写字母 / 数字 / 下划线'),
        characterPrompt: z.string().max(5000).default(''),
        scenePrompt: z.string().max(5000).default(''),
        propPrompt: z.string().max(5000).default(''),
        forbiddenWords: z.array(z.string().max(50)).max(50).default([]),
        // W7 audit R5:让用户可选 kind(原强制 CUSTOM,导致 ANIM_2D 变体无法显示)
        kind: z.enum(['CUSTOM', 'AI_REAL', 'ANIM_3D', 'ANIM_2D']).default('CUSTOM'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // W7 audit R5:slug 内置黑名单 — 业务侧(asset/breakdown / storyboard/generate)对这 3 个 slug
      // 做 hardcoded 短语注入,自定义 slug 跟内置撞会让 fallback 返 slug 原文,LLM 输出无意义字符串
      const BUILTIN_SLUGS = new Set(['ai_real', 'anim_3d', 'anim_2d']);
      if (BUILTIN_SLUGS.has(input.slug)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `slug "${input.slug}" 是内置风格保留名,请用其他 slug(如 "${input.slug}_custom")`,
        });
      }
      const created = await ctx.prisma.styleProfile
        .create({
          data: {
            ...input,
            isBuiltIn: false,
          },
        })
        .catch((e: unknown) => {
          if (typeof e === 'object' && e && 'code' in e && (e as { code: string }).code === 'P2002') {
            // W7 audit R1:读 meta.target 区分是哪个字段撞 unique
            const target =
              (e as { meta?: { target?: string[] } }).meta?.target?.join(',') ?? 'unknown';
            throw new TRPCError({
              code: 'CONFLICT',
              message: `字段 ${target} 已存在(可能 slug 撞了已有风格)`,
            });
          }
          throw e;
        });
      await logOperation(ctx, 'style.create', 'style', created.id, null, created);
      return created;
    }),

  /** W7:删除自定义风格(内置不能删) */
  delete: adminProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.styleProfile.findUnique({ where: { id: input.id } });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
      if (before.isBuiltIn) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '内置风格不能删除' });
      }
      // 检查引用:有 Project / Asset 用该风格则拒
      const projectCount = await ctx.prisma.project.count({ where: { styleId: input.id } });
      const assetCount = await ctx.prisma.asset.count({ where: { styleId: input.id } });
      if (projectCount > 0 || assetCount > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `还有 ${projectCount} 个项目 / ${assetCount} 个资产引用,先迁移后再删`,
        });
      }
      await ctx.prisma.styleProfile.delete({ where: { id: input.id } });
      await logOperation(ctx, 'style.delete', 'style', before.id, before, null);
      return { id: input.id };
    }),
});

// ---------------------------------------------------------------------------
// admin.prompt
// ---------------------------------------------------------------------------

const promptRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.prisma.promptTemplate.findMany({
      orderBy: [{ category: 'asc' }, { slug: 'asc' }],
      include: { _count: { select: { versions: true } } },
    });
  }),

  /** W7:单模板详情(含 vars 元信息) */
  getById: adminProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const t = await ctx.prisma.promptTemplate.findUnique({
        where: { id: input.id },
        include: { _count: { select: { versions: true } } },
      });
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
      return t;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        // W7 audit R1:content 加上限 50KB,防误写超大 payload
        content: z.string().min(1).max(50_000, 'content 最长 50KB'),
        description: z.string().max(500).optional(),
        modelHint: z.string().max(100).optional(),
        changeLog: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, changeLog, ...data } = input;
      const before = await ctx.prisma.promptTemplate.findUnique({ where: { id } });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });

      // content 没变就不写版本,避免空版本噪声
      const contentChanged = before.content !== input.content;
      const updated = await ctx.prisma.$transaction(async (tx) => {
        if (contentChanged) {
          await tx.promptTemplateVersion.create({
            data: {
              templateId: id,
              versionTag: `v${Date.now()}-${randomUUID().slice(0, 8)}`,
              content: before.content,
              varsJson: before.varsJson ?? {},
              changeLog: changeLog ?? 'auto-saved before edit',
              createdBy: ctx.user.id,
            },
          });
        }
        return tx.promptTemplate.update({ where: { id }, data });
      });
      await logOperation(ctx, 'prompt.update', 'prompt', id, before, updated);
      return updated;
    }),

  /** W7:列出某模板的版本历史(倒序) */
  listVersions: adminProcedure
    .input(z.object({ templateId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.promptTemplateVersion.findMany({
        where: { templateId: input.templateId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          versionTag: true,
          content: true,
          changeLog: true,
          createdAt: true,
          createdBy: true,
        },
      });
    }),

  /** W7:回滚到指定版本(当前 content 先存为新版本,然后用历史版本替换) */
  restoreVersion: adminProcedure
    .input(
      z.object({
        templateId: z.string().cuid(),
        versionId: z.string().cuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [current, version] = await Promise.all([
        ctx.prisma.promptTemplate.findUnique({ where: { id: input.templateId } }),
        ctx.prisma.promptTemplateVersion.findUnique({ where: { id: input.versionId } }),
      ]);
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: '模板不存在' });
      if (!version || version.templateId !== input.templateId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '版本不属于该模板' });
      }
      const restored = await ctx.prisma.$transaction(async (tx) => {
        // 先归档当前 content
        await tx.promptTemplateVersion.create({
          data: {
            templateId: input.templateId,
            versionTag: `v${Date.now()}-${randomUUID().slice(0, 8)}`,
            content: current.content,
            varsJson: current.varsJson ?? {},
            changeLog: `回滚前自动归档 (恢复到 ${version.versionTag})`,
            createdBy: ctx.user.id,
          },
        });
        return tx.promptTemplate.update({
          where: { id: input.templateId },
          data: { content: version.content, varsJson: version.varsJson ?? {} },
        });
      });
      await logOperation(ctx, 'prompt.restoreVersion', 'prompt', input.templateId, current, {
        ...restored,
        restoredFromVersionId: input.versionId,
      });
      return restored;
    }),
});

// ---------------------------------------------------------------------------
// admin.preset — W7:景别 / 机位 / 运镜 / 光线 预设
//
// 存 SystemSetting key `preset.<kind>` value JSON 数组(string[])
// 给分镜工坊编辑分镜时下拉框 + AIGC 抽卡时按预设组合 prompt
// ---------------------------------------------------------------------------

// W7 audit R6:常量 export 出去,me.listPresets / 业务 router 可复用
export const PRESET_KINDS = ['framing', 'angle', 'movement', 'lighting'] as const;
export type PresetKind = (typeof PRESET_KINDS)[number];

export const PRESET_KIND_LABELS: Record<PresetKind, string> = {
  framing: '景别',
  angle: '机位',
  movement: '运镜',
  lighting: '光线',
};

/** 默认 fallback 值(seed 没装时兜底) */
export const PRESET_DEFAULTS: Record<PresetKind, string[]> = {
  framing: ['大全景', '全景', '中景', '近景', '特写', '大特写'],
  angle: ['平视', '俯角', '仰角', '过肩', '正面', '侧面', '背面'],
  movement: ['固定', '推', '拉', '摇', '移', '跟', '升降', '甩'],
  lighting: ['自然光', '硬光', '柔光', '逆光', '侧光', '低调', '高调', '冷调', '暖调'],
};

/** 加载某 kind 的预设(SystemSetting preset.<kind> JSON 数组 优先,fallback DEFAULTS) */
export async function loadPresetValues(
  prismaClient: { systemSetting: { findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null> } },
  kind: PresetKind,
): Promise<{ values: string[]; isDefault: boolean }> {
  const row = await prismaClient.systemSetting.findUnique({
    where: { key: `preset.${kind}` },
  });
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
        return { values: parsed, isDefault: false };
      }
    } catch {
      // 损坏 JSON → fallback
    }
  }
  return { values: PRESET_DEFAULTS[kind], isDefault: true };
}

const presetRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
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

  set: adminProcedure
    .input(
      z.object({
        kind: z.enum(PRESET_KINDS),
        values: z.array(z.string().min(1).max(50)).min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const key = `preset.${input.kind}`;
      const dedup = Array.from(new Set(input.values.map((s) => s.trim()).filter(Boolean)));
      if (dedup.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '至少一个非空值' });
      }
      const before = await ctx.prisma.systemSetting.findUnique({ where: { key } });
      const setting = await ctx.prisma.systemSetting.upsert({
        where: { key },
        create: {
          key,
          value: JSON.stringify(dedup),
          category: 'preset',
          description: `${PRESET_KIND_LABELS[input.kind]} 预设列表`,
          updatedBy: ctx.user.id,
        },
        update: {
          value: JSON.stringify(dedup),
          updatedBy: ctx.user.id,
        },
      });
      await logOperation(ctx, 'preset.set', 'systemSetting', setting.id, before, setting);
      return { kind: input.kind, values: dedup };
    }),

  /** 恢复某 kind 的默认值(删 SystemSetting 行,list 会 fallback 到 PRESET_DEFAULTS) */
  resetToDefault: adminProcedure
    .input(z.object({ kind: z.enum(PRESET_KINDS) }))
    .mutation(async ({ ctx, input }) => {
      const key = `preset.${input.kind}`;
      const before = await ctx.prisma.systemSetting.findUnique({ where: { key } });
      if (!before) return { kind: input.kind, alreadyDefault: true };
      await ctx.prisma.systemSetting.delete({ where: { key } });
      await logOperation(ctx, 'preset.resetToDefault', 'systemSetting', before.id, before, null);
      return { kind: input.kind, alreadyDefault: false };
    }),
});

// ---------------------------------------------------------------------------
// admin.system
// ---------------------------------------------------------------------------

const systemRouter = router({
  listSettings: adminProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.systemSetting.findMany({
        where: input?.category ? { category: input.category } : {},
        orderBy: { key: 'asc' },
      });
      // W7 audit R8 P1:isSecret 行的 value 脱敏(双重防御,即便 admin 也只看 mask)
      // 真正读 secret value 走专门 revealSetting endpoint(暂未实现,Phase 2 + 二次确认)
      return rows.map((r) =>
        r.isSecret ? { ...r, value: '••••••(secret,通过 revealSetting 取明文)' } : r,
      );
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
// admin.episode — 集级管理(W3.1.followup:软锁逃生口)
// ---------------------------------------------------------------------------

const episodeRouter = router({
  /**
   * 强制解锁卡死的 GENERATING 集 — 用于进程崩溃后业务侧无法自然 release 的兜底。
   *
   * 行为:
   *   - 仅在当前状态 = GENERATING 才允许;非 GENERATING 直接抛 BAD_REQUEST
   *   - status 归位 NOT_STARTED + 清 generatingStartedAt
   *   - 写 OperationLog,可审计
   */
  forceUnlock: adminProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.episode.findUnique({
        where: { id: input.episodeId },
        select: {
          id: true,
          status: true,
          generatingStartedAt: true,
          projectId: true,
        },
      });
      if (!before) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
      }
      if (before.status !== 'GENERATING') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '本集未处于生成中状态,无需解锁',
        });
      }

      const updated = await ctx.prisma.episode.update({
        where: { id: before.id },
        data: { status: 'NOT_STARTED', generatingStartedAt: null },
      });

      await logOperation(
        ctx,
        'episode.force_unlock',
        'episode',
        before.id,
        before,
        updated,
      );
      return { ok: true, previousStartedAt: before.generatingStartedAt };
    }),
});

// ---------------------------------------------------------------------------
// 聚合
// ---------------------------------------------------------------------------

export const adminRouter = router({
  provider: providerRouter,
  style: styleRouter,
  prompt: promptRouter,
  preset: presetRouter,
  system: systemRouter,
  binding: bindingRouter,
  episode: episodeRouter,
});
