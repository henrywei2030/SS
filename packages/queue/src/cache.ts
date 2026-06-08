/**
 * r8 性能优化:Redis cache wrapper · 高频读 + 低频写 配置项
 *
 * 适用场景:
 *   - ProviderConfig:每次 LLM/视频生成调用都 loadConfig() 一次,改密钥才失效
 *   - SystemSetting binding.*:每次业务 router 调 LLM 前读,admin 改 binding 时失效
 *   - admin/preset.*:大列表(framing/angle/movement/lighting),admin 改才失效
 *
 * 设计:
 *   - get-or-compute 模式:`cacheGetOrSet(key, ttl, fn)`
 *   - 显式 invalidate:admin mutation 后调 `cacheInvalidate(key)` 或 `cacheInvalidatePrefix(prefix)`
 *   - Redis 挂掉时 fallback 直接调 fn(返结果,不缓存)— 降级而非崩溃
 *   - TTL 短(30-300s)防陈旧 + 单实例 in-process Map 作 L1 + Redis 作 L2 跨实例共享
 *
 * 命名空间:`cache:<module>:<key>` · 用 prefix 批量失效(invalidatePrefix)
 *
 * 注意:序列化用 JSON · Prisma.Decimal 不能直接 JSON.stringify
 * → 仅用于纯 string/number/boolean/plain-object 配置 · ProviderConfig 内 Decimal 字段在 loadConfig 已 toNumber
 */
import { getPrimaryRedis } from './redis.js';

// 桌面/离线档(2026-06-08):`CACHE_DRIVER=l1-only` → 只用 L1 进程内 Map,完全跳过 L2 Redis
//   (无 redis 依赖、不打连接、不刷 warn)。默认 'l1-l2' 保持原行为(Redis 挂仍 graceful 降级)。
const L2_ENABLED = (process.env.CACHE_DRIVER ?? 'l1-l2').toLowerCase() !== 'l1-only';

// L1 in-process cache:同实例多次调用秒级复用,降低 Redis 调用次数
// key → { value, expiresAt }
// r9 audit:加 size 上限防长跑 Node 进程 OOM(原 Map 无界增长)
const localCache = new Map<string, { value: unknown; expiresAt: number }>();
const LOCAL_TTL_MS = 5_000; // 5s 本地 TTL · 防大批量调用穿透 Redis
const LOCAL_MAX_ENTRIES = 1000; // 容量上限 · 满后 FIFO 驱逐最旧 200 项

function readLocal<T>(key: string): T | undefined {
  const hit = localCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    localCache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function writeLocal(key: string, value: unknown): void {
  // r9 audit:size 上限 · Map 保持插入顺序,首批 keys 即最早写入
  // 满了一次性驱逐 200 项摊薄成本(避免每次写都触发驱逐)
  if (localCache.size >= LOCAL_MAX_ENTRIES) {
    let toEvict = 200;
    for (const k of localCache.keys()) {
      if (toEvict-- <= 0) break;
      localCache.delete(k);
    }
  }
  localCache.set(key, { value, expiresAt: Date.now() + LOCAL_TTL_MS });
}

/**
 * Get-or-compute:L1 → L2 → fn() · 任何一层命中立即返
 *
 * @param key   cache key · 建议 `cache:<module>:<id>` 格式
 * @param ttlSec  Redis TTL 秒数 · 推荐 30-300
 * @param fn    miss 时执行的计算函数
 */
export async function cacheGetOrSet<T>(
  key: string,
  ttlSec: number,
  fn: () => Promise<T>,
): Promise<T> {
  // L1
  const localHit = readLocal<T>(key);
  if (localHit !== undefined) return localHit;

  // L2 Redis(l1-only 档跳过)
  if (L2_ENABLED) {
    try {
      const redis = getPrimaryRedis();
      const raw = await redis.get(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as T;
        writeLocal(key, parsed);
        return parsed;
      }
    } catch (e) {
      // Redis 挂 → 不缓存,直接 fn()
      console.warn(`[cache] redis get failed for ${key}:`, e instanceof Error ? e.message : e);
    }
  }

  // miss → 计算 + 双层写入
  const value = await fn();
  writeLocal(key, value);
  if (L2_ENABLED) {
    try {
      const redis = getPrimaryRedis();
      await redis.set(key, JSON.stringify(value), 'EX', ttlSec);
    } catch (e) {
      console.warn(`[cache] redis set failed for ${key}:`, e instanceof Error ? e.message : e);
    }
  }
  return value;
}

/** 显式失效单 key(admin mutation 后调) */
export async function cacheInvalidate(key: string): Promise<void> {
  localCache.delete(key);
  if (!L2_ENABLED) return;
  try {
    const redis = getPrimaryRedis();
    await redis.del(key);
  } catch (e) {
    console.warn(`[cache] redis del failed for ${key}:`, e instanceof Error ? e.message : e);
  }
}

/**
 * 批量失效:prefix 匹配的所有 key
 * 用法:admin 改 binding 时调 `cacheInvalidatePrefix('cache:binding:')` 清空所有 binding cache
 *
 * 注意:Redis SCAN 比 KEYS 安全(non-blocking),大规模 key 也不卡 Redis
 */
export async function cacheInvalidatePrefix(prefix: string): Promise<void> {
  // L1 prefix 扫
  for (const k of Array.from(localCache.keys())) {
    if (k.startsWith(prefix)) localCache.delete(k);
  }
  if (!L2_ENABLED) return;
  // L2 Redis SCAN + DEL(分批,每批 100)
  try {
    const redis = getPrimaryRedis();
    let cursor = '0';
    const matchKeys: string[] = [];
    do {
      const [next, batch] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      matchKeys.push(...batch);
    } while (cursor !== '0');
    if (matchKeys.length > 0) {
      // 一次 del 多 key · ioredis 支持 variadic
      await redis.del(...matchKeys);
    }
  } catch (e) {
    console.warn(`[cache] redis scan/del failed for prefix ${prefix}:`, e instanceof Error ? e.message : e);
  }
}

/** 测试用:清空本地 cache(不动 Redis) */
export function _resetLocalCacheForTest(): void {
  localCache.clear();
}
