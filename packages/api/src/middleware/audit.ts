/**
 * 审计日志辅助
 *
 * 在 mutation 内调用 logOperation() 即可写一条 OperationLog 记录。
 */
import type { Context } from '../context.js';

export async function logOperation(
  ctx: Context,
  action: string,
  targetType: string,
  targetId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  if (!ctx.user) return; // 公开操作不记
  try {
    await ctx.prisma.operationLog.create({
      data: {
        actorId: ctx.user.id,
        projectId: extractProjectId(after) ?? extractProjectId(before),
        action,
        targetType,
        targetId,
        beforeJson: before ? JSON.parse(JSON.stringify(before)) : undefined,
        afterJson: after ? JSON.parse(JSON.stringify(after)) : undefined,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });
  } catch (e) {
    console.error('[audit] failed to write OperationLog:', e);
  }
}

function extractProjectId(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  if (typeof o.projectId === 'string') return o.projectId;
  if (typeof o.id === 'string' && typeof o.ownerId === 'string') return o.id; // Project 本身
  return undefined;
}
