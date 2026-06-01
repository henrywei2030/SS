/**
 * admin.style — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
 *
 * 注:共享 admin.ts 的 import header,部分 import 在本文件可能未使用(默认 tsconfig 不强检 unused-locals)
 */
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

import { router, adminProcedure } from '../../trpc.js';
import { logOperation } from '../../middleware/audit.js';

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

export { styleRouter };
