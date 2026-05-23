/**
 * Prisma Client 单例
 * 开发热重载时避免连接泄漏
 *
 * 第 13 轮 audit:加 SIGTERM/SIGINT 优雅退出 hook,
 * 防 Node.js 进程退出时 PG 连接没正常关闭导致 connection slot 残留。
 */
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __ssPrisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __ssPrismaSignalsRegistered: boolean | undefined;
}

export const prisma: PrismaClient =
  globalThis.__ssPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__ssPrisma = prisma;
}

// 优雅退出 hook(仅注册一次,防 HMR 重复挂)
if (!globalThis.__ssPrismaSignalsRegistered) {
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[prisma] received ${signal},disconnecting...`);
    try {
      await prisma.$disconnect();
    } catch (err) {
      console.error('[prisma] disconnect failed:', err);
    }
    process.exit(0);
  };
  // Next.js dev / production 都会在停止时发 SIGTERM/SIGINT
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  globalThis.__ssPrismaSignalsRegistered = true;
}

export type { PrismaClient } from '@prisma/client';
