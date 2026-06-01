/**
 * admin.db-explorer — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
 *
 * 注:共享 admin.ts 的 import header,部分 import 在本文件可能未使用(默认 tsconfig 不强检 unused-locals)
 */
/**
 * Admin Router — 后台管理（仅 isAdmin 可访问）
 *
 * 子路由：
 *   - admin.provider  AI Provider 配置（W2 重点：API Key 在此设置）
 *   - admin.style     风格管理
 *   - admin.prompt    提示词模板
 *   - admin.system    系统设置
 *   - admin.user      全局用户管理
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router, adminProcedure } from '../../trpc.js';

// ---------------------------------------------------------------------------
// admin.dbExplorer — 数据库浏览器(W7 收尾,替代 Prisma Studio MVP)
//
// Phase 1 设计:
//   - 白名单表(防 SQL injection,Phase 2 加自定义 SQL 模式)
//   - 只读(view-only,Phase 2 加 inline edit)
//   - 动态 Prisma model 反射,无需为每个表写一个 router
//   - JSON dump 模式显示(用户自己复制走),不渲染漂亮表(Phase 2 加列定义)
// ---------------------------------------------------------------------------

const TABLE_WHITELIST = [
  'project',
  'episode',
  'scene',
  'shot',
  'shotGroup',
  'script',
  'scriptAnalysis',
  'asset',
  'assetUsageBinding',
  'mediaItem',
  'user',
  'projectMember',
  'episodeAssignment',
  'invitation',
  'generationAttempt',
  'costLedgerEntry',
  'operationLog',
  'promptEdit',
  'systemSetting',
  'providerConfig',
  'styleProfile',
] as const;
type WhitelistTable = (typeof TABLE_WHITELIST)[number];

// 二十九收工 S4:把 `as any` 动态反射收敛到此处 + 用 minimal interface 替代,
// 白名单已校验 → 反射安全;类型上用 unknown→Record 比 any 严格(IDE 还能补全 count/findMany)
type WhitelistedPrismaModel = {
  count(): Promise<number>;
  findMany(args?: {
    take?: number;
    skip?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<unknown[]>;
};

function getWhitelistedModel(
  prisma: typeof import('@ss/db')['prisma'],
  table: WhitelistTable,
): WhitelistedPrismaModel {
  const model = (prisma as unknown as Record<string, unknown>)[table] as
    | WhitelistedPrismaModel
    | undefined;
  if (!model || typeof model.findMany !== 'function') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `表 ${table} 在 Prisma 中不存在(白名单陈旧,db-explorer 配置同步问题)`,
    });
  }
  return model;
}

const dbExplorerRouter = router({
  /** 列出所有可浏览的表 + 行数 */
  listTables: adminProcedure.query(async ({ ctx }) => {
    // 二十九收工 S7:Promise.all → allSettled 防级联失败(单表 count 错不该拖垮整批)
    const results = await Promise.allSettled(
      TABLE_WHITELIST.map(async (table) => {
        const count = await getWhitelistedModel(ctx.prisma, table).count();
        return { table, count, error: null as string | null };
      }),
    );
    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      const table = TABLE_WHITELIST[i]!;
      return {
        table,
        count: 0,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    });
  }),

  /** 查询某表的分页数据(动态反射 Prisma model,白名单防注入) */
  queryTable: adminProcedure
    .input(
      z.object({
        table: z.enum(TABLE_WHITELIST),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(10).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const model = getWhitelistedModel(ctx.prisma, input.table);
      try {
        const [rows, total] = await Promise.all([
          model.findMany({
            take: input.pageSize,
            skip: (input.page - 1) * input.pageSize,
            // 四二收工 P2:无 orderBy 时 Prisma 按 DB 物理顺序返,翻页可能重复/漏行;
            // 白名单表全有 id PK(cuid/uuid 单调,跟 createdAt 顺序大体一致),id desc 让最新数据先看到
            orderBy: { id: 'desc' },
          }),
          model.count(),
        ]);
        return {
          table: input.table,
          rows,
          total,
          page: input.page,
          pageSize: input.pageSize,
          hasMore: input.page * input.pageSize < total,
        };
      } catch (e) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `查询 ${input.table} 失败:${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }),
});

// ---------------------------------------------------------------------------
// 聚合
// ---------------------------------------------------------------------------

export { dbExplorerRouter };
