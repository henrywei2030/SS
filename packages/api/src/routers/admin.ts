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
      // W1-W7 audit:必须过滤 deletedAt:null,否则已软删的项目/资产仍占引用计数,阻止删除
      const projectCount = await ctx.prisma.project.count({
        where: { styleId: input.id, deletedAt: null },
      });
      const assetCount = await ctx.prisma.asset.count({
        where: { styleId: input.id, deletedAt: null },
      });
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
      // 7 轮 audit A4:isSecret 字段不能让 value 明文进 OperationLog.afterJson
      // 否则 DBA / 备份泄露 / 越权 listOperationLog 能拿密钥明文
      const maskValue = (s: typeof setting | typeof before): typeof s => {
        if (!s) return s;
        return s.isSecret ? { ...s, value: '••••••(secret)' } : s;
      };
      await logOperation(
        ctx,
        'system.setSetting',
        'systemSetting',
        setting.id,
        maskValue(before),
        maskValue(setting),
      );
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
      // W1-W7 audit:provider 必须 isActive=true,防绑到已禁用 provider 让业务侧 silent fail
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
        if (!provider.isActive) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `provider ${input.value} 已被禁用(isActive=false),先在 /admin/providers 启用再绑`,
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

  /**
   * 归档(软删)整集 — W1-W5 audit P2 followup(P2-1)
   *
   * 一并软删:
   *   - episode.deletedAt
   *   - 本集 scenes / shots / shotGroups
   *   - 指向本集 assetId 的 AssetUsageBinding(防 binding 悬空)
   *
   * 不删除:
   *   - generationAttempts(保留审计 + cost ledger 链路)
   *   - mediaItems(可能被其它项目复用)
   */
  archive: adminProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.episode.findUnique({
        where: { id: input.episodeId },
      });
      if (!before) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
      }
      if (before.deletedAt) {
        return { ok: true, alreadyArchived: true };
      }
      const now = new Date();
      await ctx.prisma.$transaction([
        ctx.prisma.episode.update({
          where: { id: before.id },
          data: { deletedAt: now, status: 'ARCHIVED' },
        }),
        ctx.prisma.scene.updateMany({
          where: { episodeId: before.id, deletedAt: null },
          data: { deletedAt: now },
        }),
        ctx.prisma.shot.updateMany({
          where: { episodeId: before.id, deletedAt: null },
          data: { deletedAt: now },
        }),
        ctx.prisma.shotGroup.updateMany({
          where: { episodeId: before.id, deletedAt: null },
          data: { deletedAt: now },
        }),
        ctx.prisma.assetUsageBinding.updateMany({
          where: { episodeId: before.id, deletedAt: null },
          data: { deletedAt: now },
        }),
      ]);
      await logOperation(ctx, 'episode.archive', 'episode', before.id, before, {
        deletedAt: now,
        projectId: before.projectId,
      });
      return { ok: true, alreadyArchived: false };
    }),
});

// ---------------------------------------------------------------------------
// admin.health — 基础设施健康检查(W7)
//
// 并行 ping DB / Redis / MinIO 三个依赖,返回 ok + 延迟 + 错误。
// 用于 admin /health 运维页 + Docker healthcheck / K8s readinessProbe。
// ---------------------------------------------------------------------------

export interface ServiceHealth {
  ok: boolean;
  latencyMs: number;
  error: string | null;
}

const healthRouter = router({
  check: adminProcedure.query(async ({ ctx }) => {
    const checkDb = async (): Promise<ServiceHealth> => {
      const start = Date.now();
      try {
        await ctx.prisma.$queryRaw`SELECT 1`;
        return { ok: true, latencyMs: Date.now() - start, error: null };
      } catch (e) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    };

    const checkRedis = async (): Promise<ServiceHealth> => {
      const start = Date.now();
      try {
        // 动态 import 防 SSR 阶段 ioredis 在 edge runtime 失败(本路径只跑 Node)
        const { getPrimaryRedis } = await import('@ss/queue/redis');
        const redis = getPrimaryRedis();
        const result = await redis.ping();
        return {
          ok: result === 'PONG',
          latencyMs: Date.now() - start,
          error: result === 'PONG' ? null : `unexpected reply: ${result}`,
        };
      } catch (e) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    };

    const checkMinio = async (): Promise<ServiceHealth> => {
      const start = Date.now();
      const endpoint = process.env.S3_ENDPOINT;
      if (!endpoint) {
        return { ok: false, latencyMs: 0, error: 'S3_ENDPOINT not set' };
      }
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch(`${endpoint.replace(/\/$/, '')}/minio/health/live`, {
          signal: ctrl.signal,
        });
        clearTimeout(tid);
        return {
          ok: res.ok,
          latencyMs: Date.now() - start,
          error: res.ok ? null : `HTTP ${res.status}`,
        };
      } catch (e) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    };

    const [db, redis, minio] = await Promise.all([checkDb(), checkRedis(), checkMinio()]);
    return {
      db,
      redis,
      minio,
      checkedAt: new Date().toISOString(),
    };
  }),
});

// ---------------------------------------------------------------------------
// admin.audit — OperationLog 浏览(W7)
//
// 全局审计日志:分页 + 筛选 actor / action / targetType / projectId / 时间。
// 提供 distinctActions / distinctTargetTypes 给筛选下拉用。
// ---------------------------------------------------------------------------

const auditRouter = router({
  list: adminProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(10).max(100).default(50),
        actorId: z.string().cuid().optional(),
        action: z.string().max(100).optional(),
        targetType: z.string().max(50).optional(),
        projectId: z.string().cuid().optional(),
        since: z.string().datetime().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.actorId) where.actorId = input.actorId;
      // audit 修 P0-2 → P2:contains 大小写不敏感(用户搜 "Aigc" 应找到 "aigc.generate")
      if (input.action) where.action = { contains: input.action, mode: 'insensitive' };
      if (input.targetType) where.targetType = input.targetType;
      if (input.projectId) where.projectId = input.projectId;
      if (input.since) where.createdAt = { gte: new Date(input.since) };

      const [logs, total] = await Promise.all([
        ctx.prisma.operationLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: input.pageSize,
          skip: (input.page - 1) * input.pageSize,
          include: {
            user: { select: { displayName: true, email: true } },
            project: { select: { name: true } },
          },
        }),
        ctx.prisma.operationLog.count({ where }),
      ]);

      return {
        logs: logs.map((l) => ({
          id: l.id,
          actorId: l.actorId,
          actorName: l.user.displayName ?? l.user.email,
          projectId: l.projectId,
          projectName: l.project?.name ?? null,
          action: l.action,
          targetType: l.targetType,
          targetId: l.targetId,
          beforeJson: l.beforeJson,
          afterJson: l.afterJson,
          ip: l.ip,
          userAgent: l.userAgent,
          createdAt: l.createdAt,
        })),
        total,
        page: input.page,
        pageSize: input.pageSize,
        hasMore: input.page * input.pageSize < total,
      };
    }),

  distinctActions: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.operationLog.groupBy({
      by: ['action'],
      _count: { _all: true },
      orderBy: { _count: { action: 'desc' } },
      take: 50,
    });
    return rows.map((r) => ({ action: r.action, count: r._count._all }));
  }),

  distinctTargetTypes: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.operationLog.groupBy({
      by: ['targetType'],
      _count: { _all: true },
      orderBy: { _count: { targetType: 'desc' } },
    });
    return rows.map((r) => ({ targetType: r.targetType, count: r._count._all }));
  }),
});

// ---------------------------------------------------------------------------
// admin.apiUsage — GenerationAttempt + CostLedger 全局聚合(W7)
//
// 跟 insights 的区别:不过滤 projectId,看的是整个平台用量
//   - overall: 总 attempt 数(按 status)+ 总 cost
//   - byProvider: 每个 provider 的 attempt 分布 + cost,按 cost desc
//   - byAction: 按 action 枚举(VIDEO/IMAGE/TEXT/ANALYSIS/...)分布
//   - dailyTrend: 30 天日 cost + count 曲线
// ---------------------------------------------------------------------------

export interface ProviderStats {
  providerId: string;
  success: number;
  failed: number;
  inflight: number;
  cost: number;
}

const apiUsageRouter = router({
  summary: adminProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - input.days * 24 * 3600 * 1000);

      const [overall, totalCost, byProvider, providerCost, byAction, dailyTrend] =
        await Promise.all([
          ctx.prisma.generationAttempt.groupBy({
            by: ['status'],
            where: { createdAt: { gte: since } },
            _count: { _all: true },
          }),
          ctx.prisma.costLedgerEntry.aggregate({
            where: { createdAt: { gte: since }, success: true },
            _sum: { costCny: true },
          }),
          ctx.prisma.generationAttempt.groupBy({
            by: ['providerId', 'status'],
            where: { createdAt: { gte: since } },
            _count: { _all: true },
          }),
          ctx.prisma.costLedgerEntry.groupBy({
            by: ['providerId'],
            where: { createdAt: { gte: since }, success: true },
            _sum: { costCny: true },
          }),
          ctx.prisma.generationAttempt.groupBy({
            by: ['action'],
            where: { createdAt: { gte: since } },
            _count: { _all: true },
          }),
          ctx.prisma.$queryRaw<Array<{ day: string; total: bigint; cost: number }>>`
            SELECT
              to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
              COUNT(*) as total,
              COALESCE(SUM(cost_cny), 0)::float as cost
            FROM cost_ledger_entries
            WHERE created_at >= ${since} AND success = true
            GROUP BY day
            ORDER BY day ASC
          `,
        ]);

      // 聚合 byProvider:把 status 维度合并到 provider 维度
      const providerMap = new Map<string, ProviderStats>();
      for (const r of byProvider) {
        const entry: ProviderStats = providerMap.get(r.providerId) ?? {
          providerId: r.providerId,
          success: 0,
          failed: 0,
          inflight: 0,
          cost: 0,
        };
        if (r.status === 'SUCCESS') entry.success = r._count._all;
        else if (r.status === 'FAILED') entry.failed = r._count._all;
        else if (r.status === 'QUEUED' || r.status === 'RUNNING')
          entry.inflight += r._count._all;
        providerMap.set(r.providerId, entry);
      }
      for (const r of providerCost) {
        const entry = providerMap.get(r.providerId);
        if (entry) {
          entry.cost = Number(r._sum.costCny ?? 0);
        } else {
          providerMap.set(r.providerId, {
            providerId: r.providerId,
            success: 0,
            failed: 0,
            inflight: 0,
            cost: Number(r._sum.costCny ?? 0),
          });
        }
      }

      const sumByStatus = (status: string): number =>
        overall.find((r) => r.status === status)?._count._all ?? 0;

      return {
        days: input.days,
        overall: {
          total: overall.reduce((s, r) => s + r._count._all, 0),
          success: sumByStatus('SUCCESS'),
          failed: sumByStatus('FAILED'),
          inflight: sumByStatus('QUEUED') + sumByStatus('RUNNING'),
          totalCostCny: Number(totalCost._sum.costCny ?? 0),
        },
        byProvider: Array.from(providerMap.values()).sort((a, b) => b.cost - a.cost),
        byAction: byAction
          .map((r) => ({ action: r.action, count: r._count._all }))
          .sort((a, b) => b.count - a.count),
        dailyTrend: dailyTrend.map((r) => ({
          day: r.day,
          total: Number(r.total),
          cost: r.cost,
        })),
      };
    }),
});

// ---------------------------------------------------------------------------
// admin.user — 全局用户管理(W6 Collab Hub 波 1)
//
// 列表 + 搜索 + 状态筛选 + 启用/禁用 + 设/取消管理员
//
// 安全:
//   - 不能取消自己的 admin / 不能 SUSPEND 自己(防误锁后台)
//   - 不暴露 passwordHash(select 显式排除)
//   - 不做硬删(只软删/SUSPEND,审计可追溯)
// ---------------------------------------------------------------------------

const userRouter = router({
  list: adminProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(10).max(100).default(50),
        search: z.string().max(100).optional(),
        status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING']).optional(),
        isAdmin: z.boolean().optional(),
        includeDeleted: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (!input.includeDeleted) where.deletedAt = null;
      if (input.status) where.status = input.status;
      if (input.isAdmin !== undefined) where.isAdmin = input.isAdmin;
      if (input.search && input.search.trim()) {
        const s = input.search.trim();
        where.OR = [
          { email: { contains: s, mode: 'insensitive' } },
          { username: { contains: s, mode: 'insensitive' } },
          { displayName: { contains: s, mode: 'insensitive' } },
        ];
      }

      const [users, total] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          orderBy: [{ isAdmin: 'desc' }, { createdAt: 'desc' }],
          take: input.pageSize,
          skip: (input.page - 1) * input.pageSize,
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            locale: true,
            timezone: true,
            status: true,
            isAdmin: true,
            lastLoginAt: true,
            createdAt: true,
            deletedAt: true,
            _count: {
              select: {
                ownedProjects: true,
                memberships: true,
              },
            },
          },
        }),
        ctx.prisma.user.count({ where }),
      ]);

      return {
        users,
        total,
        page: input.page,
        pageSize: input.pageSize,
        hasMore: input.page * input.pageSize < total,
      };
    }),

  setStatus: adminProcedure
    .input(
      z.object({
        userId: z.string().cuid(),
        status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 安全:不能 SUSPEND 自己(防误锁后台)
      if (input.userId === ctx.user.id && input.status === 'SUSPENDED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '不能 SUSPEND 自己 — 请让其他管理员操作',
        });
      }
      const before = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, status: true, email: true, displayName: true, isAdmin: true },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND', message: '用户不存在' });
      const updated = await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { status: input.status },
        select: { id: true, status: true, displayName: true },
      });
      await logOperation(
        ctx,
        'admin.user.setStatus',
        'user',
        updated.id,
        before,
        { ...before, status: updated.status },
      );
      return updated;
    }),

  setAdmin: adminProcedure
    .input(z.object({ userId: z.string().cuid(), isAdmin: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      // 安全:不能取消自己的 admin(防自锁)
      if (input.userId === ctx.user.id && input.isAdmin === false) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '不能取消自己的管理员权限 — 请让其他管理员操作',
        });
      }
      // 安全:取消 admin 时保证系统至少留一个活跃 admin(防全部取消导致后台无人管)
      if (input.isAdmin === false) {
        const remainingAdmins = await ctx.prisma.user.count({
          where: { isAdmin: true, deletedAt: null, status: 'ACTIVE', id: { not: input.userId } },
        });
        if (remainingAdmins === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '系统至少要保留一个活跃管理员,不能取消最后一个 admin',
          });
        }
      }
      const before = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, isAdmin: true, email: true, displayName: true },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND', message: '用户不存在' });
      const updated = await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { isAdmin: input.isAdmin },
        select: { id: true, isAdmin: true, displayName: true },
      });
      await logOperation(
        ctx,
        'admin.user.setAdmin',
        'user',
        updated.id,
        before,
        { ...before, isAdmin: updated.isAdmin },
      );
      return updated;
    }),

  // 统计:多少活跃用户 / 多少管理员 / 多少 SUSPENDED(给 header 显示)
  stats: adminProcedure.query(async ({ ctx }) => {
    const [active, suspended, pending, admins, total] = await Promise.all([
      ctx.prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      ctx.prisma.user.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
      ctx.prisma.user.count({ where: { deletedAt: null, status: 'PENDING' } }),
      ctx.prisma.user.count({ where: { deletedAt: null, isAdmin: true } }),
      ctx.prisma.user.count({ where: { deletedAt: null } }),
    ]);
    return { active, suspended, pending, admins, total };
  }),
});

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

// ---------------------------------------------------------------------------
// admin.dbExplorer — 数据库浏览器(W7 收尾,替代 Prisma Studio MVP)
//
// Phase 1 设计:
//   - 白名单表(防 SQL injection,Phase 2 加自定义 SQL 模式)
//   - 只读(view-only,Phase 2 加 inline edit)
//   - 动态 Prisma model 反射,无需为每个表写一个 router
//   - JSON dump 模式显示(用户自己复制走),不渲染漂亮表(Phase 2 加列定义)
// ---------------------------------------------------------------------------

const TABLE_WHITELIST = [
  'project',
  'episode',
  'scene',
  'shot',
  'shotGroup',
  'script',
  'scriptAnalysis',
  'asset',
  'assetUsageBinding',
  'mediaItem',
  'user',
  'projectMember',
  'episodeAssignment',
  'invitation',
  'generationAttempt',
  'costLedgerEntry',
  'operationLog',
  'promptEdit',
  'systemSetting',
  'providerConfig',
  'styleProfile',
] as const;
type WhitelistTable = (typeof TABLE_WHITELIST)[number];

const dbExplorerRouter = router({
  /** 列出所有可浏览的表 + 行数 */
  listTables: adminProcedure.query(async ({ ctx }) => {
    const results = await Promise.all(
      TABLE_WHITELIST.map(async (table) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const count: number = await (ctx.prisma as any)[table].count();
          return { table, count, error: null };
        } catch (e) {
          return {
            table,
            count: 0,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );
    return results;
  }),

  /** 查询某表的分页数据(动态反射 Prisma model,白名单防注入) */
  queryTable: adminProcedure
    .input(
      z.object({
        table: z.enum(TABLE_WHITELIST),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(10).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (ctx.prisma as any)[input.table];
      if (!model || typeof model.findMany !== 'function') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `表 ${input.table} 在 Prisma 中不存在(白名单陈旧)`,
        });
      }
      try {
        const [rows, total] = await Promise.all([
          model.findMany({
            take: input.pageSize,
            skip: (input.page - 1) * input.pageSize,
          }),
          model.count(),
        ]);
        return {
          table: input.table,
          rows,
          total,
          page: input.page,
          pageSize: input.pageSize,
          hasMore: input.page * input.pageSize < total,
        };
      } catch (e) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `查询 ${input.table} 失败:${e instanceof Error ? e.message : String(e)}`,
        });
      }
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
  health: healthRouter,
  audit: auditRouter,
  apiUsage: apiUsageRouter,
  user: userRouter,
  reports: reportsRouter,
  dbExplorer: dbExplorerRouter,
});
