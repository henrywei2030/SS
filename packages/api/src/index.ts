/**
 * @ss/api — tRPC v11 后端 API 出口
 *
 * 用法：
 *   // Next.js Route Handler (apps/web/app/api/trpc/[trpc]/route.ts)
 *   import { appRouter, createContext } from '@ss/api';
 *
 *   // 客户端类型推断（apps/web/lib/trpc/client.ts）
 *   import type { AppRouter } from '@ss/api';
 */
export { appRouter, type AppRouter } from './root.js';
export { createContext, type Context } from './context.js';
export { router, publicProcedure, protectedProcedure, adminProcedure } from './trpc.js';
