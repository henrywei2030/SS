/**
 * tRPC Context — 每个请求的上下文
 *
 * 包含：
 *   - prisma: 数据库客户端
 *   - user:    当前登录用户（若已认证）
 *   - locale:  用户当前语言（zh-CN / en）
 *   - ip / userAgent / requestId: 审计用
 */
import { prisma } from '@ss/db';
import type { PrismaClient } from '@ss/db';
import { getAuthAdapter, type SessionUser } from '@ss/adapters/auth';
import { resolveLocale, type SupportedLocale } from '@ss/i18n';

export interface ContextOptions {
  /** Authorization: Bearer <token> */
  authToken?: string | null;
  /** Accept-Language 或 ?locale=  */
  locale?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string;
}

export interface Context {
  prisma: PrismaClient;
  user: SessionUser | null;
  locale: SupportedLocale;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * 创建 tRPC 上下文 — 在每个请求 fetch handler 中调用
 */
export async function createContext(opts: ContextOptions): Promise<Context> {
  let user: SessionUser | null = null;
  if (opts.authToken) {
    try {
      const auth = getAuthAdapter();
      user = await auth.verifyToken(opts.authToken);
    } catch (e) {
      // 无效 token 不抛错；后续 procedure 自行决定是否要求认证。
      // 三十九收工:记 debug 便于排查 —— DB/网络故障 vs 单纯 token 失效都走这里,
      // 静默吞会让系统异常被误判为"未登录",debug 日志保留可观测性(不刷 error)。
      console.debug(
        '[context] verifyToken failed (treated as anonymous):',
        e instanceof Error ? e.message : e,
      );
    }
  }

  return {
    prisma,
    user,
    locale: resolveLocale(opts.locale ?? user?.locale ?? null),
    ip: opts.ip ?? undefined,
    userAgent: opts.userAgent ?? undefined,
    requestId: opts.requestId,
  };
}
