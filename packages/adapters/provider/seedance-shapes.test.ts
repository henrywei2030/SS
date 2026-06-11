/**
 * 七二 M5:moyu 通用任务信封形状锁(wan/happyhorse 真打实测样本)。
 * parseQueryResponse 是私有方法 — 经实例侧门调用,锁「成功必须抽得出 videoUrl」这一行为,
 * 防未来重构把 wan 系再次退回「success 无 url → 误报超时」。
 */
import { describe, expect, it } from 'vitest';

import { SeedanceProvider } from './seedance.js';

function makeProvider(): SeedanceProvider {
  return new SeedanceProvider({
    apiUrl: 'https://relay.example/v1',
    apiKey: 'test-key',
    defaultModel: 'wan2.6-t2v',
    maxDuration: 15,
    unitPriceCny: 1.1,
    endpointStyle: 'relay',
  });
}

type ParseFn = (raw: unknown) => { kind: string; videoUrl?: string; errorMsg?: string };
const parse = (raw: unknown) =>
  (makeProvider() as unknown as { parseQueryResponse: ParseFn }).parseQueryResponse(raw);

describe('parseQueryResponse · moyu 通用任务信封(七二真打样本)', () => {
  it('wan2.6 SUCCESS:结果在 data.data[0].url(fail_reason 同 URL 的怪癖不干扰)', () => {
    const raw = {
      code: 'success',
      data: {
        task_id: 't-1',
        status: 'SUCCESS',
        fail_reason: 'https://oss.example/t-1.mp4?Expires=1',
        progress: '100%',
        data: { data: [{ url: 'https://oss.example/t-1.mp4?Expires=1' }] },
      },
    };
    const r = parse(raw);
    expect(r.kind).toBe('success');
    expect(r.videoUrl).toBe('https://oss.example/t-1.mp4?Expires=1');
  });

  it('happyhorse IN_PROGRESS(嵌套 output.task_status=RUNNING)→ pending', () => {
    const raw = {
      code: 'success',
      data: {
        task_id: 't-2',
        status: 'IN_PROGRESS',
        progress: '30%',
        data: { output: { task_id: 't-2', task_status: 'RUNNING' } },
      },
    };
    expect(parse(raw).kind).toBe('pending');
  });

  it('通用信封 SUCCESS 但已知路径全空 → 深扫兜底抽 .mp4 直链', () => {
    const raw = {
      data: {
        status: 'SUCCESS',
        data: { output: { results: [{ video: 'https://oss.example/deep.mp4' }] } },
      },
    };
    const r = parse(raw);
    expect(r.kind).toBe('success');
    expect(r.videoUrl).toBe('https://oss.example/deep.mp4');
  });

  it('FAILED(通用信封大写)→ failed 并带 fail_reason', () => {
    const raw = {
      data: { status: 'FAILED', fail_reason: '内容审核未通过', data: {} },
    };
    const r = parse(raw);
    expect(r.kind).toBe('failed');
    expect(r.errorMsg).toContain('审核');
  });

  it('seedance 2.0 原形状(content.video_url)不回归', () => {
    const raw = {
      data: {
        status: 'SUCCESS',
        data: { content: { video_url: 'https://ark.example/sd2.mp4' }, duration: 5 },
      },
    };
    const r = parse(raw);
    expect(r.kind).toBe('success');
    expect(r.videoUrl).toBe('https://ark.example/sd2.mp4');
  });
});
