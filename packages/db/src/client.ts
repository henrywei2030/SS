/**
 * Prisma Client 单例
 * 开发热重载时避免连接泄漏
 *
 * 第 13 轮 audit:加 SIGTERM/SIGINT 优雅退出 hook,
 * 防 Node.js 进程退出时 PG 连接没正常关闭导致 connection slot 残留。
 *
 * Prisma 7 升级:用 PrismaPg Driver Adapter,DATABASE_URL 通过 node-postgres 连接
 * (不再走 Rust 引擎)。新版 PrismaClient 必须传 adapter。
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

declare global {
  // eslint-disable-next-line no-var
  var __ssPrisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __ssPrismaSignalsRegistered: boolean | undefined;
}

const createPrisma = (): PrismaClient =>
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL ?? '',
    }),
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

export const prisma: PrismaClient = globalThis.__ssPrisma ?? createPrisma();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__ssPrisma = prisma;
}

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
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  globalThis.__ssPrismaSignalsRegistered = true;
}

export type { PrismaClient } from './generated/prisma/client.js';
