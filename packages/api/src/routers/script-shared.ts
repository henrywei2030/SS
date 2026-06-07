/**
 * Script Router 共享件 —— 跨 procedure 复用的 helper。
 *
 * 机械重构(ADR-31):从 script.ts(~1145 行 god 路由)抽出,供拆分后的各 sub-module
 *   (script-upload / script-version / script-analyze)复用,破"sibling 引 helper ↔
 *   script.ts 引 sibling procedure"的循环依赖。纯搬运,无行为变化。
 */
import { TRPCError } from '@trpc/server';

import type { Context } from '../context.js';
// W7+ audit R10:assertProjectAccess 抽到 middleware/access.ts
import { assertProjectAccess } from '../middleware/access.js';

// ---------------------------------------------------------------------------
// 通用：项目访问
// ---------------------------------------------------------------------------

export async function loadScriptWithAccess(ctx: Context, scriptId: string) {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const script = await ctx.prisma.script.findFirst({
    where: { id: scriptId, deletedAt: null },
  });
  if (!script) throw new TRPCError({ code: 'NOT_FOUND', message: '剧本不存在' });
  await assertProjectAccess(ctx, script.projectId);
  return script;
}
