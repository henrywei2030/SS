/**
 * admin.prompt — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
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
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { router, adminProcedure } from '../../trpc.js';
import { logOperation } from '../../middleware/audit.js';

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

export { promptRouter };
