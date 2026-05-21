/**
 * 应用级对称加密
 *
 * 用途：加密存储数据库里的 API Key（Seedance / 豆包 / Nano Banana 等敏感信息）
 *
 * 算法：AES-256-GCM (含认证标签，能检测篡改)
 * 密钥来源：APP_MASTER_KEY 环境变量（64 字符十六进制 = 32 字节）
 *
 * 数据格式：base64( iv(12B) || tag(16B) || ciphertext )
 */
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let _key: Buffer | null = null;

function getMasterKey(): Buffer {
  if (_key) return _key;
  const raw = process.env.APP_MASTER_KEY;
  if (!raw) {
    throw new Error(
      'APP_MASTER_KEY not set. Generate with: openssl rand -hex 32',
    );
  }
  if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    _key = Buffer.from(raw, 'hex');
  } else {
    // 兼容非十六进制输入：用 SHA-256 派生 32B
    _key = createHash('sha256').update(raw, 'utf8').digest();
  }
  return _key;
}

/** 加密：返回 base64 编码的密文（含 IV 与认证标签） */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return '';
  const key = getMasterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** 解密：从 base64 密文还原 */
export function decryptSecret(ciphertextB64: string): string {
  if (!ciphertextB64) return '';
  const key = getMasterKey();
  const raw = Buffer.from(ciphertextB64, 'base64');
  if (raw.length < IV_LEN + TAG_LEN) {
    throw new Error('Invalid ciphertext: too short');
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

/** 生成 UI 显示用脱敏字符串（仅保留后 4 字符） */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 4) return '****';
  return `••••${secret.slice(-4)}`;
}

/** 测试是否能正常加解密（用于健康检查） */
export function selfTest(): boolean {
  try {
    const sample = 'hello-' + Date.now();
    const enc = encryptSecret(sample);
    const dec = decryptSecret(enc);
    return dec === sample;
  } catch {
    return false;
  }
}

/** 仅测试时重置已派生密钥 */
export function resetMasterKey(): void {
  _key = null;
}
