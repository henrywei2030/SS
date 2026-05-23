/**
 * 项目访问校验 helper(W7+ audit R10 抽取)
 *
 * 原本 5 个 router(asset / aigc / insights / script / storyboard)各自复制一份
 * 同名同实现,改一处必漏改其他。集中到这里。
 *
 * 用法:
 *   import { assertProjectAccess } from '../middleware/access.js';
 *   await assertProjectAccess(ctx, projectId);
 */
import { TRPCError } from '@trpc/server';

import type { Context } from '../context.js';

/**
 * 校验当前用户对该项目有访问权(owner 或 member),否则抛 FORBIDDEN
 */
export async function assertProjectAccess(
  ctx: Context,
  projectId: string,
  userIdParam?: string,
): Promise<void> {
  const userId = userIdParam ?? ctx.user?.id;
  if (!userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  const p = await ctx.prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    select: { id: true },
  });
  if (!p) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '无项目访问权限' });
  }
}
