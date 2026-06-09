/**
 * REST Route 安全守卫 — 非 tRPC 入口(登录等)复用
 *
 * 四六收工 P1:生产登录走 `/api/auth/login` REST route,直接调 auth.login() 绕过
 * 整个 tRPC 层 → tRPC 上的 `auth.login` 限流是死代码,真实登录无限流 + 无 CSRF
 * Origin 校验 → 在线密码爆破(含 admin 账号)。本模块给 REST route 补这两道。
 *
 * - isOriginAllowed:从 trpc route 抽出**单一真相源**(CSRF 控制不应重复实现以防漂移)
 * - 登录限流:in-memory(Phase 1 单实例;Phase 2 多副本迁 Redis,跟 packages/api
 *   的 rate-limit.ts 同款局限)。**失败才计数 + 成功清零**:正常用户反复登录/调试
 *   不受影响,只惩罚连续失败的爆破尝试。
 */

/** 白名单 origin:同源 + NEXT_PUBLIC_APP_URL(prod)+ dev localhost 任意端口 */
export function isOriginAllowed(origin: string | null, host: string | null): boolean {
  if (!origin) {
    // 无 Origin = 同站非跨域(浏览器 SSR / curl)— 放行,无 CSRF 风险
    return true;
  }
  try {
    const originHost = new URL(origin).host;
    // 同源(host 跟 request Host 一致)→ 放行
    if (host && originHost === host) return true;
    // 显式白名单(prod)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl && originHost === new URL(appUrl).host) return true;
    // dev fallback:localhost / 127.0.0.1 任意端口
    if (process.env.NODE_ENV === 'development') {
      return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(originHost);
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 登录限流(按 IP,失败计数)
// ---------------------------------------------------------------------------

const LOGIN_MAX_FAILURES = 5; // 每窗口最多 5 次失败
const LOGIN_WINDOW_MS = 60_000; // 60s 窗口

// 单进程内 in-memory store(Phase 2 → Redis)
// ⚠️ 存 globalThis,不能用模块级 Map:Next standalone 可能把本模块编进多个模块实例
//   (同 progress-bus / video-gen-queue / rate-limit.ts 同款坑)→ 各实例各一份计数 = 爆破限流被稀释。
type GlobalWithLoginRateLimit = typeof globalThis & {
  __ss_loginBuckets?: Map<string, { count: number; resetAt: number }>;
  __ss_loginCleanup?: ReturnType<typeof setInterval>;
};
const g = globalThis as GlobalWithLoginRateLimit;
const loginBuckets = (g.__ss_loginBuckets ??= new Map());

/** 每 5min 清理过期 bucket,防内存涨爆(globalThis 守卫:多模块实例只起一个 interval) */
if (!g.__ss_loginCleanup) {
  g.__ss_loginCleanup = setInterval(
    () => {
      const now = Date.now();
      for (const [key, bucket] of loginBuckets) {
        if (bucket.resetAt < now) loginBuckets.delete(key);
      }
    },
    5 * 60 * 1000,
  );
  // 让 interval 不阻塞进程退出
  if (typeof g.__ss_loginCleanup.unref === 'function') g.__ss_loginCleanup.unref();
}

/**
 * 检查当前 IP 是否已被限流(**不计数**,只读判断)。
 * 返 { ok: true } 通过;{ ok: false, retryAfter } 已超限。
 */
export function checkLoginRateLimit(
  ip: string,
): { ok: true } | { ok: false; retryAfter: number } {
  const bucket = loginBuckets.get(`login:${ip}`);
  const now = Date.now();
  if (!bucket || bucket.resetAt < now) return { ok: true };
  if (bucket.count >= LOGIN_MAX_FAILURES) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true };
}

/** 记一次登录失败(认证失败时调)。窗口内累计,到上限后 checkLoginRateLimit 拒绝。 */
export function recordLoginFailure(ip: string): void {
  const key = `login:${ip}`;
  const now = Date.now();
  const bucket = loginBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    loginBuckets.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  bucket.count += 1;
}

/** 登录成功时清空该 IP 失败计数(正常用户反复登录不累积)。 */
export function clearLoginRateLimit(ip: string): void {
  loginBuckets.delete(`login:${ip}`);
}
