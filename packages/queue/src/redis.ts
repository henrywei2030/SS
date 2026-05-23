/**
 * Redis 客户端工厂 — BullMQ Queue/Worker + pub/sub 共用
 *
 * ADR-25 M1 + M6 + P1-6(fynt audit):
 *   - createRedisClient(label) / createRedisSubscriber(label),label 用于日志追溯
 *   - BullMQ 要求 maxRetriesPerRequest:null 给 blocking commands(BLPOP 等)
 *   - enableReadyCheck:false 避免连接刚建立就因为 ready check 错误退出
 *   - 连接型错误(ECONNREFUSED/ENOTFOUND/...)30s 节流防 Redis 挂掉时刷屏日志
 *     非连接型错误全量打,便于排查业务问题
 */
import { Redis, type RedisOptions } from 'ioredis';

const DEFAULT_URL = 'redis://localhost:6379';

const REDIS_CONNECT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EPIPE',
]);

function bullmqCompatibleOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

function isConnectionError(err: NodeJS.ErrnoException): boolean {
  return !!err.code && REDIS_CONNECT_ERROR_CODES.has(err.code);
}

const lastLoggedAt = new Map<string, number>();
const LOG_THROTTLE_MS = 30_000;

function logThrottled(key: string, msg: string): void {
  const now = Date.now();
  const last = lastLoggedAt.get(key) ?? 0;
  if (now - last >= LOG_THROTTLE_MS) {
    lastLoggedAt.set(key, now);
    console.warn(msg);
  }
}

/** 主连接 — Queue 实例 + publish 操作用 */
export function createRedisClient(label: string): Redis {
  const url = process.env.REDIS_URL ?? DEFAULT_URL;
  const client = new Redis(url, bullmqCompatibleOptions());
  client.on('error', (err: NodeJS.ErrnoException) => {
    if (isConnectionError(err)) {
      // P1-6:Redis 挂掉时 ioredis 每秒重连一次,裸 console.error 会瞬间刷屏写爆 stderr
      logThrottled(`redis:${label}:${err.code}`, `[redis:${label}] connection error (${err.code}): ${err.message}`);
    } else {
      console.error(`[redis:${label}] error:`, err.message);
    }
  });
  return client;
}

/**
 * Subscriber 连接 — SUBSCRIBE 操作必须独立连接,不能共用 publisher
 * 同进程内一般只需要一个 subscriber(可订阅多 channel)。
 */
export function createRedisSubscriber(label: string): Redis {
  return createRedisClient(`${label}:subscriber`);
}

let primaryClient: Redis | undefined;

/** 单例主连接 — getVideoGenQueue() 内部用 */
export function getPrimaryRedis(): Redis {
  if (!primaryClient) {
    primaryClient = createRedisClient('primary');
  }
  return primaryClient;
}
