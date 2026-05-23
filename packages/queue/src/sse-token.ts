/**
 * SSE 访问 Token — HMAC-SHA256,5min TTL
 *
 * ADR-25 M5(fynt 模式):
 *   - tRPC mutation `aigc.getStreamToken(attemptId)` 内部校用户访问权 → 签 token
 *   - 前端 EventSource(`/api/sse/aigc/{id}?token=...`) 把 token 放 query(SSE 不能塞自定义 header)
 *   - SSE route handler 仅校 token + timingSafeEqual,长连接服务零业务逻辑
 *
 * Token 格式:base64url(payload) + '.' + base64url(hmac)
 * Payload:{ attemptId, userId, iat, exp }
 */
import crypto from 'node:crypto';

const TTL_SECONDS = 300; // 5 分钟

function getSecret(): string {
  // 优先用专用 secret,fallback 到 JWT_SECRET(auth 用的同一把,32+ chars)
  const secret = process.env.SSE_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      '[sse-token] SSE_TOKEN_SECRET or JWT_SECRET must be set in environment',
    );
  }
  if (secret.length < 32) {
    throw new Error('[sse-token] secret must be at least 32 chars');
  }
  return secret;
}

export interface StreamTokenPayload {
  attemptId: string;
  userId: string;
}

export interface SignedStreamToken {
  token: string;
  expiresInSeconds: number;
}

/**
 * 签名 SSE 访问 token
 *
 * 用法(tRPC):
 *   const { token, expiresInSeconds } = signStreamToken({ attemptId, userId: ctx.user.id });
 *   return { token, expiresInSeconds };
 */
export function signStreamToken(payload: StreamTokenPayload): SignedStreamToken {
  const now = Math.floor(Date.now() / 1000);
  const data = { ...payload, iat: now, exp: now + TTL_SECONDS };
  const payloadB64 = Buffer.from(JSON.stringify(data)).toString('base64url');
  const hmac = crypto
    .createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('base64url');
  return {
    token: `${payloadB64}.${hmac}`,
    expiresInSeconds: TTL_SECONDS,
  };
}

/**
 * 验证 SSE token,返回 payload 或 null(过期 / 篡改 / 格式错)
 *
 * timingSafeEqual 防时序攻击 — 攻击者无法通过响应时长猜出 HMAC 字节。
 *
 * 用法(SSE route):
 *   const payload = verifyStreamToken(token);
 *   if (!payload) return new Response('invalid token', { status: 401 });
 *   if (payload.attemptId !== params.attemptId) return new Response('mismatch', { status: 403 });
 */
export function verifyStreamToken(token: string): StreamTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, hmac] = parts as [string, string];

  const expectedHmac = crypto
    .createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('base64url');

  const hmacBuf = Buffer.from(hmac, 'base64url');
  const expectedBuf = Buffer.from(expectedHmac, 'base64url');
  if (hmacBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(hmacBuf, expectedBuf)) return null;

  try {
    const data = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (typeof data.attemptId !== 'string' || typeof data.userId !== 'string') {
      return null;
    }
    return { attemptId: data.attemptId, userId: data.userId };
  } catch {
    return null;
  }
}
