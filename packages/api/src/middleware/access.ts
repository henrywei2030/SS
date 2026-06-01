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

import { isEpisodeLockedNow } from '../utils/episode-lock.js';
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

/**
 * 加载 episode 并校验访问权(四二收工 B3:原 aigc.ts 局部函数,抽到此处供多 router 共享)
 *
 * 统一做 4 件事:UNAUTHORIZED 守卫 → findFirst(deletedAt:null)→ NOT_FOUND → assertProjectAccess。
 * 原 script / asset 各自 inline 重复这套 4 行逻辑,现收敛单一真相源。
 *
 * opts:
 *   - skipLockCheck:true 时不抛 GENERATING(只读 query 用;mutation 默认做 lock check)
 *   - lockMessage:定制锁冲突消息(各 router 语境不同 — 剧本编辑 / 清空 / AIGC 工作台)
 *
 * ⚠️ 不适用:where 需带 projectId 归属(asset.bindUsage)或需 admin 权限 / include project
 *    (project.assignUser)的场景 — 那些语义不同,保持各自 inline。
 */
export async function loadEpisodeOrThrow(
  ctx: Context,
  episodeId: string,
  opts: { skipLockCheck?: boolean; lockMessage?: string } = {},
) {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const ep = await ctx.prisma.episode.findFirst({
    where: { id: episodeId, deletedAt: null },
  });
  if (!ep) throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
  await assertProjectAccess(ctx, ep.projectId);
  // W1-W5 audit 三轮 L1:写操作必须先确认 episode 没在 fresh GENERATING
  if (!opts.skipLockCheck && isEpisodeLockedNow(ep)) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: opts.lockMessage ?? '本集正在生成分镜中,请等导演侧完成后再操作 AIGC 工作台',
    });
  }
  return ep;
}
