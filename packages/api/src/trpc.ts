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

/**
 * HTTP 状态码 → tRPC code 完整映射
 *
 * tRPC 不支持 402/451/502 等 HTTP code,统一退到最相近的语义码;
 * errorFormatter 会把 ssCode 透传到前端,前端可读真实 SsError code(如 'BUDGET_EXCEEDED')
 */
const HTTP_TO_TRPC: Record<number, ConstructorParameters<typeof TRPCError>[0]['code']> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'FORBIDDEN', // PAYMENT_REQUIRED(预算超限)→ ssCode=BUDGET_EXCEEDED
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_CONTENT',
  429: 'TOO_MANY_REQUESTS',
  451: 'FORBIDDEN', // ComplianceError → ssCode=COMPLIANCE_REJECTED
  502: 'INTERNAL_SERVER_ERROR', // ProviderError → ssCode=PROVIDER_FAILED
  503: 'INTERNAL_SERVER_ERROR',
  504: 'TIMEOUT',
};

function httpStatusToTrpcCode(
  status: number,
): ConstructorParameters<typeof TRPCError>[0]['code'] {
  return HTTP_TO_TRPC[status] ?? 'INTERNAL_SERVER_ERROR';
}

/** 自动把 SsError 翻译成 TRPCError(ssCode 通过 errorFormatter 透传) */
const wrapErrors = t.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (e) {
    if (e instanceof SsError) {
      throw new TRPCError({
        code: httpStatusToTrpcCode(e.httpStatus),
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
