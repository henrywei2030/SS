import { describe, it, expect, beforeEach } from 'vitest';
import { encryptSecret, decryptSecret, maskSecret, selfTest, resetMasterKey } from './crypto.js';

describe('adapters/crypto', () => {
  beforeEach(() => {
    process.env.APP_MASTER_KEY = '0123456789abcdef'.repeat(4); // 64 hex chars
    resetMasterKey();
  });

  it('加密 + 解密 = 原文（往返一致）', () => {
    const plain = 'sk-volcengine-ark-1234567890';
    const enc = encryptSecret(plain);
    expect(enc).not.toBe(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('同样原文每次密文不同（IV 随机）', () => {
    const a = encryptSecret('hello');
    const b = encryptSecret('hello');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('密文被篡改时解密抛错（GCM 认证）', () => {
    const enc = encryptSecret('secret-payload');
    const tampered = enc.slice(0, -4) + 'aaaa';
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('空字符串安全处理', () => {
    expect(encryptSecret('')).toBe('');
    expect(decryptSecret('')).toBe('');
  });

  it('支持非 hex 密钥（自动 SHA-256 派生）', () => {
    process.env.APP_MASTER_KEY = 'my-not-hex-passphrase';
    resetMasterKey();
    const enc = encryptSecret('test-key');
    expect(decryptSecret(enc)).toBe('test-key');
  });

  it('未设 APP_MASTER_KEY 时抛错', () => {
    delete process.env.APP_MASTER_KEY;
    resetMasterKey();
    expect(() => encryptSecret('x')).toThrow(/APP_MASTER_KEY/);
  });

  it('selfTest 健康检查通过', () => {
    expect(selfTest()).toBe(true);
  });

  it('maskSecret 末尾 4 位可见', () => {
    expect(maskSecret('sk-1234abcdEFGH')).toBe('••••EFGH');
    expect(maskSecret('abc')).toBe('****');
    expect(maskSecret('')).toBe('');
  });
});
