/**
 * tRPC 核心初始化 + 中间件
 */
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';

import { SsError } from '@ss/shared';

import type { Context } from './context.js';

// ---------------------------------------------------------------------------
// tRPC 实例
// ---------------------------------------------------------------------------

const t = initTRPC.context<Context>().create({
  transformer: superjson, // 支持 Date / Decimal / BigInt 透明传输
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        ssCode:
          error.cause instanceof SsError ? error.cause.code : undefined,
        zodIssues:
          error.cause instanceof ZodError ? error.cause.flatten() : undefined,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 中间件
// ---------------------------------------------------------------------------

/** 必须登录 */
const requireAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: '未登录' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** 必须是 isAdmin（后台管理）*/
const requireAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: '未登录' });
  }
  if (!ctx.user.isAdmin) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '需要管理员权限' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** 自动把 SsError 翻译成 TRPCError */
const wrapErrors = t.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (e) {
    if (e instanceof SsError) {
      throw new TRPCError({
        code:
          e.httpStatus === 403
            ? 'FORBIDDEN'
            : e.httpStatus === 404
              ? 'NOT_FOUND'
              : e.httpStatus === 400
                ? 'BAD_REQUEST'
                : e.httpStatus === 402
                  ? 'FORBIDDEN'
                  : 'INTERNAL_SERVER_ERROR',
        message: e.message,
        cause: e,
      });
    }
    throw e;
  }
});

// ---------------------------------------------------------------------------
// 导出 router / procedure
// ---------------------------------------------------------------------------

export const router = t.router;
export const mergeRouters = t.mergeRouters;

/** 公开 — 任何人都可访问（登录页用） */
export const publicProcedure = t.procedure.use(wrapErrors);

/** 已登录用户 */
export const protectedProcedure = t.procedure.use(wrapErrors).use(requireAuth);

/** 管理员（后台 /admin/* 用） */
export const adminProcedure = t.procedure.use(wrapErrors).use(requireAdmin);

export type { Context };
