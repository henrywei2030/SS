/**
 * Rate limit 核心逻辑(W7 audit R8 P0)
 *
 * 简易 in-memory token bucket — Phase 1 单实例够用,Phase 2 多副本部署改 Redis。
 * 实际 tRPC middleware 由 trpc.ts 包装(避免 t 实例不匹配)
 *
 * 使用:
 *   protectedProcedure.use(makeRateLimit({ key: 'login', max: 5, windowMs: 60_000 }))
 */
import { TRPCError } from '@trpc/server';

import type { Context } from '../context.js';

// 单进程内 in-memory store(Phase 2 → Redis)
// ⚠️ 存 globalThis,不能用模块级 Map:Next standalone 可能把本模块编进多个模块实例
//   (同 progress-bus / video-gen-queue 已踩过的坑)→ 各实例各一份 bucket = 限流被稀释 N 倍。
//   globalThis 保证同进程内单一计数源;Phase 2 多副本部署仍需迁 Redis。
type GlobalWithRateLimit = typeof globalThis & {
  __ss_rateLimitBuckets?: Map<string, { count: number; resetAt: number }>;
  __ss_rateLimitCleanup?: ReturnType<typeof setInterval>;
};
const g = globalThis as GlobalWithRateLimit;
const buckets = (g.__ss_rateLimitBuckets ??= new Map());

/** 每 5min 清理过期 bucket,防内存涨爆(globalThis 守卫:多模块实例只起一个 interval) */
if (!g.__ss_rateLimitCleanup) {
  g.__ss_rateLimitCleanup = setInterval(
    () => {
      const now = Date.now();
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt < now) buckets.delete(key);
      }
    },
    5 * 60 * 1000,
  );
  // Node.js: 让 interval 不阻塞进程退出
  if (typeof g.__ss_rateLimitCleanup.unref === 'function') g.__ss_rateLimitCleanup.unref();
}

export interface RateLimitOpts {
  /** 标识 bucket 的 key — 函数模式 per-user / per-ip */
  key: string | ((ctx: Context) => string);
  max: number;
  windowMs: number;
  message?: string;
}

/**
 * 检查 + 计数(返 void 通过;throw TRPCError 拒)— 业务 middleware 直接调
 */
export function checkRateLimit(ctx: Context, opts: RateLimitOpts): void {
  const key = typeof opts.key === 'string' ? opts.key : opts.key(ctx);
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return;
  }

  if (bucket.count >= opts.max) {
    const retryS = Math.ceil((bucket.resetAt - now) / 1000);
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message:
        opts.message ??
        `请求过快,请 ${retryS} 秒后重试(限 ${opts.max} 次 / ${Math.round(opts.windowMs / 1000)} 秒)`,
    });
  }

  bucket.count += 1;
}

/** 测试用:清空 bucket */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}
