/**
 * 通知服务测试 — M0 验收(notify 落库 + webhook)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@ss/db';

import { buildWebhookRequest, isBlockedWebhookHost, notify } from './index.js';

interface CreatedRow {
  userId: string;
  type: string;
  title: string;
  body?: string;
  payload?: unknown;
}

function makeMockPrisma(webhookUrl: string | null): PrismaClient & { _rows: CreatedRow[] } {
  const rows: CreatedRow[] = [];
  const mock = {
    notification: {
      create: async ({ data }: { data: CreatedRow }) => {
        rows.push(data);
        return { id: `n-${rows.length}` };
      },
    },
    systemSetting: {
      findUnique: async () => (webhookUrl === null ? null : { value: webhookUrl }),
    },
    _rows: rows,
  };
  return mock as unknown as PrismaClient & { _rows: CreatedRow[] };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildWebhookRequest(纯函数)', () => {
  it('飞书 URL → msg_type:text 形状,body 拼在 title 后', () => {
    const req = buildWebhookRequest('https://open.feishu.cn/open-apis/bot/v2/hook/xxx', {
      type: 'system',
      title: '标题',
      body: '正文',
    });
    expect(JSON.parse(req.init.body)).toEqual({
      msg_type: 'text',
      content: { text: '标题\n正文' },
    });
  });

  it('Bark URL → {title, body, group}', () => {
    const req = buildWebhookRequest('https://api.day.app/abcdef123', {
      type: 'job_done',
      title: '完成',
      body: 'B',
    });
    expect(JSON.parse(req.init.body)).toEqual({ title: '完成', body: 'B', group: 'StarsAlign' });
  });

  it('其它 URL → 通用 JSON(含 type/payload)', () => {
    const req = buildWebhookRequest('https://example.com/hook', {
      type: 'budget_warn',
      title: 'T',
      payload: { pct: 85 },
    });
    expect(JSON.parse(req.init.body)).toEqual({
      type: 'budget_warn',
      title: 'T',
      body: '',
      payload: { pct: 85 },
    });
    expect(req.init.headers['content-type']).toBe('application/json');
  });

  it('非法 URL 不抛 → 通用形状(失败留给 fetch 阶段)', () => {
    expect(() => buildWebhookRequest('not-a-url', { type: 's', title: 't' })).not.toThrow();
  });
});

describe('isBlockedWebhookHost(SSRF 防护)', () => {
  it('拦内网/保留地址', () => {
    for (const u of [
      'http://localhost/h',
      'http://127.0.0.1/h',
      'http://10.1.2.3/h',
      'http://192.168.1.1/h',
      'http://172.16.0.1/h',
      'http://169.254.169.254/latest/meta-data', // 云元数据
      'http://[::1]/h',
      'ftp://example.com/h', // 非 http(s)
      'not-a-url',
    ]) {
      expect(isBlockedWebhookHost(u)).toBe(true);
    }
  });

  it('放行公网 — 含 fc/fd 开头域名(回归:不被 IPv6 前缀误伤)', () => {
    for (const u of [
      'https://open.feishu.cn/open-apis/bot/v2/hook/x',
      'https://api.day.app/key',
      'https://fc-api.example.com/webhook', // fc 开头域名
      'https://fdservice.io/hook', // fd 开头域名
      'http://172.15.0.1/h', // 172.15 不在私有段
      'http://8.8.8.8/h',
    ]) {
      expect(isBlockedWebhookHost(u)).toBe(false);
    }
  });
});

describe('notify(落库 + webhook)', () => {
  it('webhook 未配置 → 只落库,状态 disabled,不发 fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const prisma = makeMockPrisma('');

    const res = await notify(prisma, { userId: 'u1', type: 'system', title: '你好' });
    expect(res.webhook).toBe('disabled');
    expect(res.id).toBe('n-1');
    expect(prisma._rows).toHaveLength(1);
    expect(prisma._rows[0]).toMatchObject({ userId: 'u1', type: 'system', title: '你好' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('配了 webhook → 落库 + POST,2xx 状态 sent', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const prisma = makeMockPrisma('https://open.feishu.cn/open-apis/bot/v2/hook/xxx');

    const res = await notify(prisma, { userId: 'u1', type: 'job_done', title: '成片完成' });
    expect(res.webhook).toBe('sent');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0]! as unknown as [
      string,
      { body: string },
    ];
    expect(calledUrl).toContain('open.feishu.cn');
    expect(JSON.parse(calledInit.body).msg_type).toBe('text');
  });

  it('webhook 网络失败 → 落库不受影响,状态 failed,不抛', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const prisma = makeMockPrisma('https://example.com/hook');

    const res = await notify(prisma, { userId: 'u1', type: 'system', title: 'T' });
    expect(res.webhook).toBe('failed');
    expect(prisma._rows).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('webhook 非 2xx → 状态 failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const prisma = makeMockPrisma('https://example.com/hook');

    const res = await notify(prisma, { userId: 'u1', type: 'system', title: 'T' });
    expect(res.webhook).toBe('failed');
  });
});
