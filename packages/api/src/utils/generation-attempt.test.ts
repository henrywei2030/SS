/**
 * runTextGenerationAttempt 状态机单测(P3 去重前的测试网)。
 * mock prisma.generationAttempt,验证 create RUNNING / SUCCESS 回写 / FAILED 回写 + 错误包裹规则。
 */
import { describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';

import { runTextGenerationAttempt } from './generation-attempt.js';
import type { Context } from '../context.js';

function makeCtx() {
  const create = vi.fn(async (args: unknown) => ({ id: 'att-1' }));
  const update = vi.fn(async (_args: unknown) => ({}));
  const ctx = {
    user: { id: 'u1' },
    prisma: { generationAttempt: { create, update } },
  } as unknown as Context;
  return { ctx, create, update };
}

const OPTS = { projectId: 'p1', modelId: 'm1', inputJson: { kind: 'x' }, failPrefix: '生成失败' };

describe('runTextGenerationAttempt', () => {
  it('成功:建 RUNNING → runFn 拿到 attemptId → SUCCESS 回写真实 tokens/cost → 返回业务值', async () => {
    const { ctx, create, update } = makeCtx();
    const runFn = vi.fn(async (id: string) => ({
      inputTokens: 10,
      outputTokens: 20,
      costCny: 0.5,
      value: { draftId: 'd1' },
    }));

    const out = await runTextGenerationAttempt(ctx, OPTS, runFn);

    expect(out).toEqual({ draftId: 'd1' });
    expect(runFn).toHaveBeenCalledWith('att-1');
    // create:RUNNING + 关键字段
    const createData = (create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(createData.status).toBe('RUNNING');
    expect(createData.action).toBe('TEXT');
    expect(createData.projectId).toBe('p1');
    expect(createData.modelId).toBe('m1');
    expect(createData.providerId).toBe('m1');
    // update:SUCCESS + 真实计量
    const updateData = (update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(updateData.status).toBe('SUCCESS');
    expect(updateData.inputUnits).toBe(10);
    expect(updateData.outputUnits).toBe(20);
    expect(updateData.costCny).toBe('0.5000');
    expect(updateData.finishedAt).toBeInstanceOf(Date);
  });

  it('runFn 抛普通 Error → FAILED 回写脱敏 errorMsg + 抛 TRPCError(带 failPrefix)', async () => {
    const { ctx, update } = makeCtx();
    const runFn = vi.fn(async () => {
      throw new Error('boom detail');
    });

    await expect(runTextGenerationAttempt(ctx, OPTS, runFn)).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: '生成失败:boom detail',
    });
    const updateData = (update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(updateData.status).toBe('FAILED');
    expect(updateData.errorMsg).toContain('boom detail');
    expect(updateData.finishedAt).toBeInstanceOf(Date);
  });

  it('runFn 抛 TRPCError(如解析失败自定义消息)→ 原样重抛,不二次包 failPrefix', async () => {
    const { ctx, update } = makeCtx();
    const custom = new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'LLM 未产出可解析大纲,请重试' });
    const runFn = vi.fn(async () => {
      throw custom;
    });

    await expect(runTextGenerationAttempt(ctx, OPTS, runFn)).rejects.toBe(custom);
    expect((update.mock.calls[0]![0] as { data: { status: string } }).data.status).toBe('FAILED');
  });

  it('无 user → UNAUTHORIZED,不建 attempt', async () => {
    const { ctx, create } = makeCtx();
    (ctx as unknown as { user: null }).user = null;
    await expect(
      runTextGenerationAttempt(ctx, OPTS, vi.fn()),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(create).not.toHaveBeenCalled();
  });
});
