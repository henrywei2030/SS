/**
 * sanitizeErrorMsg 安全脱敏单测(锁死规则)。
 *
 * 背景(P1):sanitizeErrorMsg 是全链路错误出口(throw/DB/SSE/log 前)统一脱敏的安全闸,
 *   却 0 测试 —— 一旦正则被误改导致 token/URL/IP 漏出,无人发现。这里把每条规则锁住:
 *   既验"该脱的脱了",也验"正常文案别误伤"(如 "secret: not set")。
 *   置于 adapters(其 provider 错误路径是主要调用方,且已有 vitest)。
 */
import { describe, expect, it } from 'vitest';
import { sanitizeErrorMsg } from '@ss/shared';

describe('sanitizeErrorMsg — 脱敏(该脱的脱)', () => {
  it('URL → [URL]', () => {
    expect(sanitizeErrorMsg('请求失败 https://moyu.info/v1/chat?key=abc 超时')).toContain('[URL]');
    expect(sanitizeErrorMsg('请求失败 https://moyu.info/v1/chat?key=abc')).not.toContain('moyu.info');
  });

  it('JWT → [JWT]', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT';
    const out = sanitizeErrorMsg(`auth failed ${jwt}`);
    expect(out).toContain('[JWT]');
    expect(out).not.toContain('SflKxwRJSMeKKF2QT');
  });

  it('Bearer token → Bearer [TOKEN]', () => {
    expect(sanitizeErrorMsg('401 Bearer sk-abcdefgh12345678ijkl')).toContain('Bearer [TOKEN]');
  });

  it('sk-/api-key 前缀凭证 → [KEY]', () => {
    expect(sanitizeErrorMsg('bad key sk-proj-abcdefgh12345678')).toContain('[KEY]');
    expect(sanitizeErrorMsg('bad key sk-proj-abcdefgh12345678')).not.toContain('abcdefgh12345678');
  });

  it('Google AIza key → [KEY]', () => {
    const k = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456'; // AIza + 35 = 39 chars
    expect(sanitizeErrorMsg(`google ${k}`)).toContain('[KEY]');
  });

  it('键名:值 形式 → [REDACTED]', () => {
    expect(sanitizeErrorMsg('config password=hunter2longpass')).toContain('[REDACTED]');
    expect(sanitizeErrorMsg('config api_key: abcdefgh12345678')).toContain('[REDACTED]');
  });

  it('IP:port → [IP]', () => {
    expect(sanitizeErrorMsg('connect 192.168.1.10:5432 refused')).toContain('[IP]');
    expect(sanitizeErrorMsg('connect 192.168.1.10:5432 refused')).not.toContain('192.168');
  });

  it('长 hex hash → [HASH]', () => {
    expect(sanitizeErrorMsg('etag a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')).toContain('[HASH]');
  });
});

describe('sanitizeErrorMsg — 不误伤正常文案', () => {
  it('普通错误原样保留', () => {
    expect(sanitizeErrorMsg('文件不存在')).toBe('文件不存在');
    expect(sanitizeErrorMsg('Headers Timeout Error')).toBe('Headers Timeout Error');
  });

  it('"secret: not set" 不被吃(值含空格 / 不足 8 连续凭证字符)', () => {
    const out = sanitizeErrorMsg('config secret: not set');
    expect(out).toContain('not set');
    expect(out).not.toContain('[REDACTED]');
  });

  it('截断到 maxLen', () => {
    expect(sanitizeErrorMsg('x'.repeat(500)).length).toBeLessThanOrEqual(200);
    expect(sanitizeErrorMsg('x'.repeat(50), 20).length).toBeLessThanOrEqual(20);
  });

  it('Error 实例取 message', () => {
    expect(sanitizeErrorMsg(new Error('boom'))).toBe('boom');
  });
});
