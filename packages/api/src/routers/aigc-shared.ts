/**
 * AIGC Router 共享件 —— 跨 procedure 复用的 helper。
 *
 * 机械重构(ADR-31):从 aigc.ts(~1847 行 god 路由)抽出,供拆分后的各 sub-module
 *   (aigc-overview / aigc-prompt / aigc-bindings / aigc-video / aigc-groups)复用,
 *   破"sibling 引 helper ↔ aigc.ts 引 sibling procedure"的循环依赖。纯搬运,无行为变化。
 */
import { TRPCError } from '@trpc/server';

import type { Context } from '../context.js';
import { assertProjectAccess } from '../middleware/access.js';
import { isEpisodeLockedNow } from '../utils/episode-lock.js';

/**
 * loadGroupOrThrow 选项:
 *   - allowArchived:true 时允许返回 deletedAt!=null 的 group(只读路径用,如 listVideoTakes 历史回溯)
 *   - skipLockCheck:true 时不抛 GENERATING(only for 只读 query;mutation 必须 false)
 */
export async function loadGroupOrThrow(
  ctx: Context,
  groupId: string,
  opts: { allowArchived?: boolean; skipLockCheck?: boolean } = {},
) {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const grp = await ctx.prisma.shotGroup.findFirst({
    where: {
      id: groupId,
      ...(opts.allowArchived ? {} : { deletedAt: null }),
      episode: { deletedAt: null },
    },
    include: { episode: true },
  });
  if (!grp) throw new TRPCError({ code: 'NOT_FOUND', message: '生成段不存在' });
  await assertProjectAccess(ctx, grp.episode.projectId);
  // W1-W5 audit 三轮 L1:导演 generateForEpisode 跑时(Episode.status=GENERATING fresh),
  // AIGC 这边写入会基于"被覆盖前快照",拒绝。
  if (!opts.skipLockCheck && isEpisodeLockedNow(grp.episode)) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: '本集正在生成分镜中,请等导演侧完成后再操作 AIGC 工作台',
    });
  }
  return grp;
}
