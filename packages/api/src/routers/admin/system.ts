/**
 * admin.system — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
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
import { z } from 'zod';

import { router, adminProcedure } from '../../trpc.js';
import { logOperation } from '../../middleware/audit.js';

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

export { systemRouter };
