/**
 * Vitest setup — 提供 dummy DATABASE_URL 让 @ss/db 的 prisma client init 不抛。
 *
 * 三十六收工 R2 Phase D:
 *   budget-check.ts 用 `import { Prisma as PrismaNamespace } from '@ss/db'` value-import
 *   触发 prisma client createPrisma() 立即评估 → 需要 DATABASE_URL 否则 throw。
 *
 *   测试时所有 tx 都是 mock,不实际 connect。dummy URL 让 init 通过即可。
 *
 *   注:vitest config.setupFiles 在 test 模块 import 之前 evaluate,所以 set 顶部环境变量有效。
 */
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
