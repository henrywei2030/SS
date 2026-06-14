/**
 * OpenAI-compat 瞬时网络错误重试判定单测(2026-06-14)。
 *
 * 背景:moyu 等中转站经本机代理偶发「建连期」ECONNRESET(实测真调用 ~1/6,
 *   报 "network socket disconnected before secure TLS connection")。给文本调用加了
 *   有限次退避重试。本测锁死最关键不变量:
 *     - 瞬时网络错误(ECONNRESET / TLS 握手前断连 / 超时)+ HTTP 429/5xx → 重试
 *     - 确定性 4xx(401 无效令牌 / 400 / 404)→ 绝不重试(立即抛,不浪费往返 / 不掩盖配置错)
 */
import { describe, expect, it } from 'vitest';

import { isTransientNetworkError } from './openai-compat.js';

describe('isTransientNetworkError — 瞬时错误才重试', () => {
  it('ECONNRESET(本案真实失败码)→ 重试', () => {
    expect(isTransientNetworkError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true);
  });

  it('TLS 握手前 socket 断开(本案真实文案)→ 重试', () => {
    const e = new Error('Client network socket disconnected before secure TLS connection was established');
    expect(isTransientNetworkError(e)).toBe(true);
  });

  it('undici fetch failed + cause ECONNRESET → 重试', () => {
    const e = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    });
    expect(isTransientNetworkError(e)).toBe(true);
  });

  it.each(['ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'])(
    '瞬时网络码 %s → 重试',
    (code) => {
      expect(isTransientNetworkError(Object.assign(new Error(code), { code }))).toBe(true);
    },
  );

  it.each([429, 500, 502, 503, 504])('HTTP %i(限流/网关/上游临时)→ 重试', (httpStatus) => {
    expect(isTransientNetworkError(Object.assign(new Error('upstream'), { httpStatus }))).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('确定性 4xx %i(如 401 无效令牌)→ 不重试', (httpStatus) => {
    // 关键:401「无效的令牌」必须立即抛,否则会把"key 配错"这类确定性问题
    //   掩盖成 3 次无谓重试后才报错,且重试帮不上忙。
    expect(isTransientNetworkError(Object.assign(new Error('无效的令牌'), { httpStatus }))).toBe(false);
  });

  it('普通业务错误(无网络码 / 无 httpStatus)→ 不重试', () => {
    expect(isTransientNetworkError(new Error('LLM 未产出可解析的分集大纲'))).toBe(false);
  });

  it('null / 非对象 → 不重试(不崩)', () => {
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError('boom')).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
  });
});
