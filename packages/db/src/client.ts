/**
 * Prisma Client 单例
 * 开发热重载时避免连接泄漏
 */
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __ssPrisma: PrismaClient | undefined;
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

export type { PrismaClient } from '@prisma/client';
