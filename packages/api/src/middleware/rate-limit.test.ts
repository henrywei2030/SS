/**
 * rate-limit 窗口逻辑单测(12 维深审 D10 补强)
 *
 * 这是全部 tRPC 写操作 + 视频生成的防滥用闸,此前零覆盖。
 * 纯内存逻辑,用 fake timers 测窗口重置;不依赖 Context 内容(key 用字符串模式)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Context } from '../context.js';

import { checkRateLimit, resetRateLimitBuckets } from './rate-limit.js';

const ctx = {} as Context; // key 为字符串时不读 ctx

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRateLimitBuckets();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetRateLimitBuckets();
  });

  it('窗口内未超限 → 放行并计数', () => {
    const opts = { key: 'k1', max: 3, windowMs: 1000 };
    expect(() => checkRateLimit(ctx, opts)).not.toThrow();
    expect(() => checkRateLimit(ctx, opts)).not.toThrow();
    expect(() => checkRateLimit(ctx, opts)).not.toThrow();
  });

  it('达到 max 后第 max+1 次 → TOO_MANY_REQUESTS', () => {
    const opts = { key: 'k2', max: 2, windowMs: 1000 };
    checkRateLimit(ctx, opts);
    checkRateLimit(ctx, opts);
    expect(() => checkRateLimit(ctx, opts)).toThrowError(/TOO_MANY_REQUESTS|请求过快/);
  });

  it('窗口过期后重置计数(resetAt 边界)', () => {
    const opts = { key: 'k3', max: 1, windowMs: 1000 };
    checkRateLimit(ctx, opts);
    expect(() => checkRateLimit(ctx, opts)).toThrow();
    // 推进刚好超过窗口
    vi.advanceTimersByTime(1001);
    expect(() => checkRateLimit(ctx, opts)).not.toThrow();
  });

  it('不同 key 互不影响(bucket 隔离)', () => {
    const a = { key: 'user:a', max: 1, windowMs: 1000 };
    const b = { key: 'user:b', max: 1, windowMs: 1000 };
    checkRateLimit(ctx, a);
    expect(() => checkRateLimit(ctx, b)).not.toThrow();
    expect(() => checkRateLimit(ctx, a)).toThrow();
  });

  it('函数型 key 按 ctx 派生', () => {
    const mkCtx = (id: string) => ({ user: { id } }) as unknown as Context;
    const opts = { key: (c: Context) => `u:${(c as { user: { id: string } }).user.id}`, max: 1, windowMs: 1000 };
    checkRateLimit(mkCtx('u1'), opts);
    expect(() => checkRateLimit(mkCtx('u2'), opts)).not.toThrow();
    expect(() => checkRateLimit(mkCtx('u1'), opts)).toThrow();
  });

  it('自定义 message 透传', () => {
    const opts = { key: 'k4', max: 1, windowMs: 1000, message: '抽卡太快' };
    checkRateLimit(ctx, opts);
    expect(() => checkRateLimit(ctx, opts)).toThrowError(/抽卡太快/);
  });
});
