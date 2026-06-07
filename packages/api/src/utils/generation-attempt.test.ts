/**
 * runTextGenerationAttempt 状态机单测(P3 去重前的测试网)。
 * mock prisma.generationAttempt,验证 create RUNNING / SUCCESS 回写 / FAILED 回写 + 错误包裹规则。
 */
import { describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';

import { runTextGenerationAttempt } from './generation-attempt.js';
import type { Context } from '../context.js';

function makeCtx() {
  const create = vi.fn(async (_args: unknown) => ({ id: 'att-1' }));
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
    const runFn = vi.fn(async (_id: string) => ({
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
    expect(updateData.errorMsg).toBeNull();
    expect(updateData.inputUnits).toBe(10);
    expect(updateData.outputUnits).toBe(20);
    expect(updateData.costCny).toBe('0.5000');
    expect(updateData.finishedAt).toBeInstanceOf(Date);
    // durationMs:真实耗时(number / ≥0)
    expect(typeof updateData.durationMs).toBe('number');
    expect(updateData.durationMs as number).toBeGreaterThanOrEqual(0);
    // create 也记 startedAt(durationMs 的基准)
    expect(createData.startedAt).toBeInstanceOf(Date);
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
    // 失败路径也写真实耗时(asset api-usage「耗时」列对账靠它)
    expect(typeof updateData.durationMs).toBe('number');
    expect(updateData.durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it('软失败:runFn 返回 warning → FAILED(errorMsg=warning)+ 仍写 tokens/cost/durationMs + 正常返回 value(不 throw)', async () => {
    const { ctx, update } = makeCtx();
    const runFn = vi.fn(async () => ({
      inputTokens: 7,
      outputTokens: 3,
      costCny: 0.12,
      value: { field: 'mbti', value: '' },
      warning: 'AI 输出解析失败',
    }));

    // 不 throw,正常返回业务值
    const out = await runTextGenerationAttempt(ctx, OPTS, runFn);
    expect(out).toEqual({ field: 'mbti', value: '' });

    const updateData = (update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(updateData.status).toBe('FAILED');
    expect(updateData.errorMsg).toBe('AI 输出解析失败');
    // 生成确实跑了、花了钱 → tokens/cost 照写
    expect(updateData.inputUnits).toBe(7);
    expect(updateData.outputUnits).toBe(3);
    expect(updateData.costCny).toBe('0.1200');
    expect(typeof updateData.durationMs).toBe('number');
    expect(updateData.durationMs as number).toBeGreaterThanOrEqual(0);
    expect(updateData.finishedAt).toBeInstanceOf(Date);
  });

  it('opts.assetId / episodeId → 写进 create 关联列(asset 路径)', async () => {
    const { ctx, create } = makeCtx();
    const runFn = vi.fn(async () => ({ inputTokens: 1, outputTokens: 1, costCny: 0, value: 'x' }));
    await runTextGenerationAttempt(
      ctx,
      { ...OPTS, assetId: 'a1', episodeId: 'e1' },
      runFn,
    );
    const createData = (create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(createData.assetId).toBe('a1');
    expect(createData.episodeId).toBe('e1');
  });

  it('opts.wrapError:runFn 抛普通 Error → 用自定义包裹(保留 cause / 文案),不走默认 failPrefix', async () => {
    const { ctx, update } = makeCtx();
    const raw = new Error('provider boom');
    const runFn = vi.fn(async () => {
      throw raw;
    });
    const wrapError = vi.fn(
      (e: unknown, sanitized: string) =>
        new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: sanitized || '资产拆解失败', cause: e }),
    );

    await expect(
      runTextGenerationAttempt(ctx, { ...OPTS, wrapError }, runFn),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'provider boom', cause: raw });
    // FAILED 仍由 helper 写(errorMsg = 脱敏 + durationMs)
    const updateData = (update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(updateData.status).toBe('FAILED');
    expect(updateData.errorMsg).toContain('provider boom');
    expect(wrapError).toHaveBeenCalledTimes(1);
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
