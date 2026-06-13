import { describe, it, expect } from 'vitest';

import { isRelayFetchableUrl } from './resolve-url.js';

// 2026-06-13 翻案回归锁:此前把 data: base64 跟 localhost 一起滤掉是误杀 —— moyu 直接内联解码 base64
//   (seedance 经 moyu 真打多次成功、带 base64 参考图真出片 ¥6-10 实证),误滤导致 happyhorse 拿 0 图 i2v/r2v 必败。
describe('isRelayFetchableUrl — moyu 能否拿来当参考图用', () => {
  it('data: 内联 base64 → true(moyu 直接解码,不走拉取)', () => {
    expect(isRelayFetchableUrl('data:image/png;base64,iVBORw0KGgoAAAANS=')).toBe(true);
    expect(isRelayFetchableUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true);
  });

  it('公网 http(s) 非回环 → true', () => {
    expect(isRelayFetchableUrl('https://cdn.example.com/a.png')).toBe(true);
    expect(isRelayFetchableUrl('http://203.0.113.7/a.png')).toBe(true);
  });

  it('本机 localhost / 回环地址 → false(moyu 在公网拉不到本机)', () => {
    expect(isRelayFetchableUrl('http://localhost:9000/a.png')).toBe(false);
    expect(isRelayFetchableUrl('http://127.0.0.1:9000/a.png')).toBe(false);
    expect(isRelayFetchableUrl('http://0.0.0.0/a.png')).toBe(false);
    expect(isRelayFetchableUrl('http://[::1]:9000/a.png')).toBe(false);
  });

  it('blob: / 相对路径 / 空值 → false', () => {
    expect(isRelayFetchableUrl('blob:http://localhost/abc')).toBe(false);
    expect(isRelayFetchableUrl('/relative/a.png')).toBe(false);
    expect(isRelayFetchableUrl(null)).toBe(false);
    expect(isRelayFetchableUrl(undefined)).toBe(false);
    expect(isRelayFetchableUrl('')).toBe(false);
  });
});
