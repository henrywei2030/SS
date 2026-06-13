/**
 * tRPC 核心初始化 + 中间件
 */
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';

import { SsError } from '@ss/shared';

import type { Context } from './context.js';
import { checkRateLimit, type RateLimitOpts } from './middleware/rate-limit.js';

// ---------------------------------------------------------------------------
// AgentTool 元数据 — ADR-26 落地 + ADR-27(本轮)
//
// 给每个核心 mutation 加 `.meta({ agentTool: {...} })`,Phase 2 Mastra agent 启动时:
//   - 扫所有 procedure.meta.agentTool 自动注册成 Mastra tool registry
//   - description / sideEffects / examples / costEstimate 让 agent 理解工具
//   - requireConfirm:true 给 reject/delete 类,human-in-loop 必须二次确认
//
// Phase 1 只是占位 + 写 description,真的扫描/注册等 Phase 2 Mastra 启动
// ---------------------------------------------------------------------------

export interface AgentToolMeta {
  /** 简短描述,Mastra agent 看这个决定何时用这个工具 */
  description: string;
  /** 副作用清单 — 让 agent 知道会改什么(db.create / db.update / extern.api / cost) */
  sideEffects: string[];
  /** 估算单次成本(CNY),agent 做预算决策用 */
  costEstimateCny?: number;
  /** true 时 agent 必须 human-in-loop 二次确认(reject/delete/publish 类) */
  requireConfirm?: boolean;
  /** 示例输入,Mastra fewshot 训练用(可选) */
  examples?: Array<Record<string, unknown>>;
}

// 必须 export 否则 TS declaration emit 时 router 类型推断会报 TS4023
export interface TRPCMeta {
  agentTool?: AgentToolMeta;
}

// ---------------------------------------------------------------------------
// tRPC 实例
// ---------------------------------------------------------------------------

const t = initTRPC.context<Context>().meta<TRPCMeta>().create({
  transformer: superjson, // 支持 Date / Decimal / BigInt 透明传输
  errorFormatter({ shape, error, ctx }) {
    // 第 20 轮 audit P1 (W8 smoke 发现):生产 mode 必须剥 stack
    // tRPC v11 默认在 dev mode 会把 stack 透传到 client,生产环境会泄漏代码路径 + 内部结构
    const isProd = process.env.NODE_ENV === 'production';
    const baseData = { ...shape.data };
    if (isProd) {
      delete (baseData as Record<string, unknown>).stack;
    }
    // 第 23 轮 audit P1:zodIssues 脱敏 — 只保留 path+code,丢弃 message(message 可能含正则 pattern 暴露 password 规则等)
    // dev 模式保留完整(开发 debug 用),prod 只返路径
    let safeZodIssues: unknown;
    if (error.cause instanceof ZodError) {
      const flat = error.cause.flatten();
      if (isProd) {
        // prod:仅返 field paths,不暴露 message(防 regex / 密码规则泄漏)
        safeZodIssues = {
          formErrors: flat.formErrors.length > 0 ? ['校验失败'] : [],
          fieldErrors: Object.fromEntries(
            Object.entries(flat.fieldErrors).map(([k, v]) => [k, Array.isArray(v) && v.length > 0 ? ['校验失败'] : []]),
          ),
        };
      } else {
        safeZodIssues = flat;
      }
    }
    return {
      ...shape,
      data: {
        ...baseData,
        // 第 19 轮 audit P1:错误响应携带 requestId 给前端,用户拿 requestId 报 bug 时可全链路追溯
        requestId: ctx?.requestId,
        ssCode:
          error.cause instanceof SsError ? error.cause.code : undefined,
        zodIssues: safeZodIssues,
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

/**
 * W7 audit R8 P0:Rate limit 中间件工厂(用同一个 t 实例确保类型匹配)
 *
 * 用法:
 *   protectedProcedure.use(rateLimit({ key: (ctx) => `login:${ctx.ip}`, max: 5, windowMs: 60_000 }))
 *
 * 因为 t 必须从 trpc.ts 这个文件里取(初始化的 t 实例),工厂导出,逻辑 delegate 到 rate-limit.ts
 */
export const rateLimit = (opts: RateLimitOpts) =>
  t.middleware(({ ctx, next }) => {
    checkRateLimit(ctx, opts);
    return next();
  });

// ---------------------------------------------------------------------------
// 导出 router / procedure
// ---------------------------------------------------------------------------

export const router = t.router;

/** 公开 — 任何人都可访问（登录页用） */
export const publicProcedure = t.procedure.use(wrapErrors);

/** 已登录用户 */
export const protectedProcedure = t.procedure.use(wrapErrors).use(requireAuth);

/** 管理员（后台 /admin/* 用） */
export const adminProcedure = t.procedure.use(wrapErrors).use(requireAdmin);

export type { Context };
