/**
 * job-queue kind 路由单测 — M0 验收项(蓝图 §3 M0)
 *
 * 覆盖:注册表 set/get/reset、in-process 档分流(fire-and-forget + 未注册抛错)、
 * dispatchJob 按 kind 路由(多 handler 互不串、未注册/畸形 envelope 抛错)。
 * bullmq 档的 Queue.add 需要真 Redis,不在单测覆盖(对齐 video-gen-queue 无单测先例,
 * 由 dev/CI 起跑验证)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  dispatchJob,
  enqueueJob,
  getJobHandler,
  registerJobHandler,
  resetJobHandlers,
} from './job-queue.js';

/** 等 fire-and-forget 的 void promise 落定(微任务排空) */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  resetJobHandlers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('handler 注册表', () => {
  it('register 后 get 拿到同一个 handler;重复注册覆盖', () => {
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    registerJobHandler('compose', a);
    expect(getJobHandler('compose')).toBe(a);
    registerJobHandler('compose', b);
    expect(getJobHandler('compose')).toBe(b);
  });

  it('reset 清空注册表', () => {
    registerJobHandler('qc', vi.fn(async () => {}));
    resetJobHandlers();
    expect(getJobHandler('qc')).toBeUndefined();
  });
});

describe('enqueueJob — in-process 档', () => {
  it('按 kind 调到注册的 handler,传 data + ctx,返回 jobId', async () => {
    vi.stubEnv('QUEUE_DRIVER', 'in-process');
    const seen: Array<{ data: unknown; kind: string; jobId: string }> = [];
    registerJobHandler('compose', async (data, ctx) => {
      seen.push({ data, kind: ctx.kind, jobId: ctx.jobId });
    });

    const jobId = await enqueueJob('compose', { renderId: 'r1' }, { jobId: 'compose:render:r1' });
    await flushMicrotasks();

    expect(jobId).toBe('compose:render:r1');
    expect(seen).toEqual([
      { data: { renderId: 'r1' }, kind: 'compose', jobId: 'compose:render:r1' },
    ]);
  });

  it('未传 jobId 时生成 inproc: 前缀 id', async () => {
    vi.stubEnv('QUEUE_DRIVER', 'in-process');
    registerJobHandler('qc', async () => {});
    const jobId = await enqueueJob('qc', {});
    expect(jobId).toMatch(/^inproc:qc:/);
  });

  it('未注册 kind → 抛清晰错误(enqueue 端同步拦截)', async () => {
    vi.stubEnv('QUEUE_DRIVER', 'in-process');
    await expect(enqueueJob('unknown-kind', {})).rejects.toThrow(/未注册 handler/);
  });

  it('handler 内部 crash 不冒泡到 enqueue 调用方(fire-and-forget,仅打日志)', async () => {
    vi.stubEnv('QUEUE_DRIVER', 'in-process');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerJobHandler('compose', async () => {
      throw new Error('boom');
    });

    await expect(enqueueJob('compose', {})).resolves.toMatch(/^inproc:/);
    await flushMicrotasks();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('[job-queue:in-process] compose'),
      expect.any(Error),
    );
  });

  it('多 kind 互不串台', async () => {
    vi.stubEnv('QUEUE_DRIVER', 'in-process');
    const calls: string[] = [];
    registerJobHandler('compose', async () => {
      calls.push('compose');
    });
    registerJobHandler('qc', async () => {
      calls.push('qc');
    });

    await enqueueJob('qc', {});
    await enqueueJob('compose', {});
    await flushMicrotasks();
    expect(calls.sort()).toEqual(['compose', 'qc']);
  });
});

describe('dispatchJob — bullmq worker 侧路由', () => {
  it('envelope 校验 + 按 kind 路由,await handler 完成', async () => {
    const seen: unknown[] = [];
    registerJobHandler('compose', async (data, ctx) => {
      seen.push({ data, ctx });
    });

    await dispatchJob({ kind: 'compose', data: { episodeId: 'e1' } }, { jobId: 'job-9' });
    expect(seen).toEqual([
      { data: { episodeId: 'e1' }, ctx: { jobId: 'job-9', kind: 'compose' } },
    ]);
  });

  it('未注册 kind → throw(BullMQ 标 failed 留审计)', async () => {
    await expect(dispatchJob({ kind: 'nope', data: {} }, { jobId: 'j' })).rejects.toThrow(
      /kind "nope" 未注册/,
    );
  });

  it('畸形 envelope(缺 kind)→ zod throw', async () => {
    await expect(dispatchJob({ data: {} }, { jobId: 'j' })).rejects.toThrow();
  });

  it('handler 抛错向上冒泡(由 BullMQ 接住标 failed)', async () => {
    registerJobHandler('compose', async () => {
      throw new Error('handler failed');
    });
    await expect(
      dispatchJob({ kind: 'compose', data: {} }, { jobId: 'j' }),
    ).rejects.toThrow('handler failed');
  });
});
