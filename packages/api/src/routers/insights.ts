/**
 * Insights Router — W6.1 + W6.3 数据洞察(W6 audit 4 轮修订)
 *
 * 提供项目级 ROI 指标:
 *   - getProjectOverview:KPI + 日 cost 时序 + kind 分布(成本来自 ledger,计数来自 attempt)
 *   - getModelDistribution:provider × model 调用排行 + 成功率
 *   - getTopShotGroupsByGachaRate:抽卡 Top10 group(频繁抽卡 = 难生成 = ROI 关注点)
 *
 * 数据源:
 *   - 成本(¥)→ CostLedgerEntry(seedance 等失败路径会写多条 ledger 给同一 attempt,
 *     所以 ledger 行数 ≠ attempt 数。用于 ¥ 计算精确)
 *   - 计数(次)→ GenerationAttempt(单一 attempt 一行,跟 W5 AIGC 工作台对齐)
 *   - 跳转目标 → ShotGroup + Episode(过滤双层 deletedAt,防 NOT_FOUND)
 *
 * 不引入新表,纯聚合现有数据。Phase 2 上量后改 ClickHouse / materialized view。
 *
 * 已知设计决策:
 *   - 时间分桶用 **UTC** 日期(`getUTCFullYear/Month/Date`),跨设备 server timezone 不影响
 *   - `costByKind` 用 whitelist(image/video/text/audio/compliance/analysis 6 类),
 *     未知 prefix 落 other 并 console.warn,防新 provider action 默默吞 other
 *   - `successCount/failedCount` 从 attempt 来,跟 `aigc.listGroups.videoTakes` 同源,
 *     `rejected:false` 过滤,避免废片虚高
 */
import { z } from 'zod';

import { Prisma } from '@ss/db';

import { router, protectedProcedure } from '../trpc.js';
import { assertProjectAccess } from '../middleware/access.js';
// 三十一收工 S3:SystemSetting 单 key 读 helper
import { loadSystemSetting } from '../utils/system-bindings.js';

// ---------------------------------------------------------------------------
// 通用

/** UTC 时区的"N 天前 0:00"— 跨设备 server timezone 不影响分桶 */
function periodStartDate(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days + 1);
  return d;
}

/** UTC 日 key,'YYYY-MM-DD' 格式 */
function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** ledger.action 分类 — whitelist + 未知 warn */
const KIND_PREFIXES = new Set(['image', 'video', 'text', 'audio', 'compliance', 'analysis']);
type CostKind = 'image' | 'video' | 'text' | 'audio' | 'compliance' | 'analysis' | 'other';

function classifyLedgerAction(action: string): CostKind {
  const prefix = action.split('.')[0]?.toLowerCase() ?? '';
  if (KIND_PREFIXES.has(prefix)) return prefix as CostKind;
  console.warn(`[insights] unknown ledger action prefix: "${action}" → 'other'`);
  return 'other';
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const insightsRouter = router({
  /**
   * 项目级总览(KPI + 时序 + kind 分布)
   * 成本来自 ledger,计数来自 attempt,语义清晰
   */
  getProjectOverview: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        days: z.number().int().min(1).max(365).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const since = periodStartDate(input.days);

      // W1-W5 audit P2 followup(P2-5):接通 system.budget.warn_pct(原 dead config)
      // 从 SystemSetting 拉预警阈值,跟项目 budgetCny 相乘后返给前端做颜色档位
      const [budgetWarnSetting, project] = await Promise.all([
        loadSystemSetting(ctx.prisma, 'system.budget.warn_pct'),
        ctx.prisma.project.findUnique({
          where: { id: input.projectId },
          select: { budgetCny: true },
        }),
      ]);
      const budgetWarnPct = Number(budgetWarnSetting ?? '80');
      const projectBudgetCny = project?.budgetCny ? Number(project.budgetCny) : null;

      // 1. 成本数据 — r8 性能优化:从 Node 7000+ 行 Decimal 累加 → PostgreSQL SUM 聚合
      // ----------------------------------------------------------------------------
      // 原:findMany 拉所有 ledger 行 → Node Decimal.plus 累加 4 维(total/success/byKind/byDay)
      // 改:5 个并发 SQL 聚合,PostgreSQL numeric 端算,返聚合结果(<200 行)
      //
      // 精度:Prisma aggregate / groupBy 的 _sum 返回 Prisma.Decimal,跟原 Decimal.plus 等价
      // 按天 / 按 kind 因 action 多样需 groupBy + Node 端 classify 到 kind
      const whereLedger = {
        projectId: input.projectId,
        createdAt: { gte: since },
      };

      // 按天聚合用 raw SQL DATE_TRUNC(Prisma groupBy 不原生支持)
      // 注:Postgres 列名带大小写要用 "createdAt"(quoted) · 表名 cost_ledger_entries(@@map)
      const [
        totalAgg,
        successAgg,
        byActionGrouped,
        byDayRows,
      ] = await Promise.all([
        ctx.prisma.costLedgerEntry.aggregate({
          where: whereLedger,
          _sum: { costCny: true },
        }),
        ctx.prisma.costLedgerEntry.aggregate({
          where: { ...whereLedger, success: true },
          _sum: { costCny: true },
        }),
        ctx.prisma.costLedgerEntry.groupBy({
          by: ['action'],
          where: whereLedger,
          _sum: { costCny: true },
        }),
        ctx.prisma.$queryRaw<Array<{ day: string; sum: Prisma.Decimal }>>`
          SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                 SUM("costCny") AS sum
          FROM "cost_ledger_entries"
          WHERE "projectId" = ${input.projectId} AND "createdAt" >= ${since}
          GROUP BY day
          ORDER BY day
        `,
      ]);

      const totalDec = totalAgg._sum.costCny ?? new Prisma.Decimal(0);
      const successDec = successAgg._sum.costCny ?? new Prisma.Decimal(0);
      const totalCostCny = totalDec.toNumber();
      const successCostCny = successDec.toNumber();

      // 按 action 聚合 → classify 到 kind(7 桶)
      const costByKindDec: Record<CostKind, Prisma.Decimal> = {
        image: new Prisma.Decimal(0),
        video: new Prisma.Decimal(0),
        text: new Prisma.Decimal(0),
        audio: new Prisma.Decimal(0),
        compliance: new Prisma.Decimal(0),
        analysis: new Prisma.Decimal(0),
        other: new Prisma.Decimal(0),
      };
      for (const g of byActionGrouped) {
        const kind = classifyLedgerAction(g.action);
        costByKindDec[kind] = costByKindDec[kind].plus(g._sum.costCny ?? 0);
      }

      // 按天 SQL 已返 day(YYYY-MM-DD)+ sum,直接转 Map
      const dailyCostDec = new Map<string, Prisma.Decimal>();
      const activeDays = new Set<string>();
      for (const row of byDayRows) {
        dailyCostDec.set(row.day, new Prisma.Decimal(row.sum));
        activeDays.add(row.day);
      }

      // 2. 计数 — r8 性能优化:Node count loop → PostgreSQL groupBy(status)
      // 一次聚合返 3 行,Node 端 reduce 成 {success/failed/running}
      const attemptStatusGrouped = await ctx.prisma.generationAttempt.groupBy({
        by: ['status'],
        where: {
          projectId: input.projectId,
          createdAt: { gte: since },
          rejected: false,
          OR: [
            { shotGroupId: null },
            { shotGroup: { deletedAt: null, episode: { deletedAt: null } } },
          ],
        },
        _count: { _all: true },
      });
      let successCount = 0;
      let failedCount = 0;
      let runningCount = 0;
      for (const g of attemptStatusGrouped) {
        if (g.status === 'SUCCESS') successCount += g._count._all;
        else if (g.status === 'FAILED') failedCount += g._count._all;
        else if (g.status === 'RUNNING' || g.status === 'QUEUED') runningCount += g._count._all;
      }
      const totalAttempts = successCount + failedCount + runningCount;

      // 3. 填充每天 0 数据点(UI 画连续时序)
      const costByDay: Array<{ date: string; cost: number }> = [];
      for (let i = 0; i < input.days; i++) {
        const d = new Date(since);
        d.setUTCDate(d.getUTCDate() + i);
        const k = utcDayKey(d);
        const dec = dailyCostDec.get(k) ?? new Prisma.Decimal(0);
        costByDay.push({ date: k, cost: Number(dec.toFixed(4)) });
      }

      // 预算状态判定:超 100% 红,超 warn% 黄,否则绿
      const budgetStatus: 'over' | 'warn' | 'ok' | 'no_budget' =
        projectBudgetCny === null
          ? 'no_budget'
          : totalCostCny >= projectBudgetCny
            ? 'over'
            : totalCostCny >= (projectBudgetCny * budgetWarnPct) / 100
              ? 'warn'
              : 'ok';

      return {
        period: { since: since.toISOString(), days: input.days },
        totalCostCny: Number(totalCostCny.toFixed(4)),
        successCostCny: Number(successCostCny.toFixed(4)),
        totalAttempts,
        successCount,
        failedCount,
        runningCount,
        // 第 2 轮 audit P1-1:W5.5 异步化后 RUNNING attempt 可能停留秒-分钟级,
        // 用 success/total 会把 inflight 一并算进分母,让 successRate 在高峰期被人为拉低。
        // 改 success/(success+failed) — RUNNING 单独看 runningCount 字段。
        successRate:
          successCount + failedCount > 0
            ? successCount / (successCount + failedCount)
            : 0,
        activeDays: activeDays.size,
        costByKind: Object.fromEntries(
          (Object.keys(costByKindDec) as CostKind[]).map((k) => [
            k,
            Number(costByKindDec[k].toFixed(4)),
          ]),
        ) as Record<CostKind, number>,
        costByDay,
        // P2-5:预算 + 预警阈值 status
        projectBudgetCny,
        budgetWarnPct,
        budgetStatus,
      };
    }),

  /**
   * Provider × Model 调用分布 — 按 cost 降序
   * 同 provider 不同 model 分行(让 doubao-pro 和 doubao-lite 区分开)
   */
  getModelDistribution: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        days: z.number().int().min(1).max(365).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const since = periodStartDate(input.days);

      const grouped = await ctx.prisma.costLedgerEntry.groupBy({
        by: ['providerId', 'modelId', 'success'],
        where: {
          projectId: input.projectId,
          createdAt: { gte: since },
        },
        _sum: { costCny: true },
        _count: { _all: true },
      });

      // W1-W5 audit P1 followup(R9):Decimal 累加 totalCost,与 overview 同口径
      const map = new Map<
        string,
        {
          providerId: string;
          modelId: string;
          totalCost: Prisma.Decimal;
          total: number;
          success: number;
          failed: number;
        }
      >();
      for (const g of grouped) {
        const key = `${g.providerId}::${g.modelId}`;
        const cur = map.get(key) ?? {
          providerId: g.providerId,
          modelId: g.modelId,
          totalCost: new Prisma.Decimal(0),
          total: 0,
          success: 0,
          failed: 0,
        };
        cur.totalCost = cur.totalCost.plus(new Prisma.Decimal(g._sum.costCny ?? 0));
        cur.total += g._count._all;
        if (g.success) cur.success += g._count._all;
        else cur.failed += g._count._all;
        map.set(key, cur);
      }
      return Array.from(map.values())
        .map((r) => ({
          providerId: r.providerId,
          modelId: r.modelId,
          totalCost: Number(r.totalCost.toFixed(4)),
          total: r.total,
          success: r.success,
          failed: r.failed,
          successRate: r.total > 0 ? r.success / r.total : 0,
        }))
        .sort((a, b) => b.totalCost - a.totalCost);
    }),

  /**
   * 抽卡 Top10 group — 按 attempts(成功+失败)降序,频繁抽卡 = 难生成 = 重点关注
   *
   * W6 audit P0 修:
   *   - days 默认 30,跟 overview / modelDistribution 时间窗口一致(原 optional → 全期)
   *   - 过滤 `rejected:false`,跟 aigc.listGroups 对齐(原虚高 + 跟工作台对不上)
   *   - 过滤 `shotGroup.episode.deletedAt:null`,跳转链接保证可达(原归档 episode 进入 NOT_FOUND)
   *   - 返 attemptSuccessRate(消除跟 cost/ledger.gachaRatio 的命名歧义)
   */
  getTopShotGroupsByGachaRate: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        limit: z.number().int().min(1).max(50).default(10),
        days: z.number().int().min(1).max(365).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const since = periodStartDate(input.days);

      const grouped = await ctx.prisma.generationAttempt.groupBy({
        by: ['shotGroupId', 'status'],
        where: {
          projectId: input.projectId,
          action: 'VIDEO',
          shotGroupId: { not: null },
          // 双层 deletedAt 过滤:group + episode 都活着才进 Top10(跳转可达)
          shotGroup: {
            deletedAt: null,
            episode: { deletedAt: null },
          },
          rejected: false, // 跟 aigc.listGroups 对齐
          createdAt: { gte: since },
        },
        _count: { _all: true },
        _sum: { costCny: true },
      });

      // W1-W5 audit P1 followup(R9):Decimal 累加 totalCost
      const map = new Map<
        string,
        {
          groupId: string;
          total: number;
          success: number;
          failed: number;
          running: number;
          totalCost: Prisma.Decimal;
        }
      >();
      for (const g of grouped) {
        if (!g.shotGroupId) continue;
        const cur = map.get(g.shotGroupId) ?? {
          groupId: g.shotGroupId,
          total: 0,
          success: 0,
          failed: 0,
          running: 0,
          totalCost: new Prisma.Decimal(0),
        };
        cur.total += g._count._all;
        cur.totalCost = cur.totalCost.plus(new Prisma.Decimal(g._sum.costCny ?? 0));
        if (g.status === 'SUCCESS') cur.success += g._count._all;
        else if (g.status === 'FAILED') cur.failed += g._count._all;
        else if (g.status === 'RUNNING' || g.status === 'QUEUED') cur.running += g._count._all;
        map.set(g.shotGroupId, cur);
      }

      const ranked = Array.from(map.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, input.limit);

      if (ranked.length === 0) return [];

      // 拉对应 group 元信息(也过滤 episode deletedAt,双重保险)
      const groups = await ctx.prisma.shotGroup.findMany({
        where: {
          id: { in: ranked.map((r) => r.groupId) },
          deletedAt: null,
          episode: { deletedAt: null },
        },
        include: {
          episode: { select: { id: true, number: true, title: true, deletedAt: true } },
        },
      });
      const groupMeta = new Map(groups.map((g) => [g.id, g]));

      return ranked
        .map((r) => {
          const meta = groupMeta.get(r.groupId);
          if (!meta) return null; // group 在 groupBy 之后被软删了,过滤
          return {
            groupId: r.groupId,
            label: meta.number,
            episodeId: meta.episodeId,
            episodeNumber: meta.episode.number,
            episodeTitle: meta.episode.title,
            attempts: r.total,
            success: r.success,
            failed: r.failed,
            running: r.running,
            // W6 audit P1:命名加 attempt 前缀,消除跟 cost/ledger.gachaRatio(时长口径)的歧义
            attemptSuccessRate: r.total > 0 ? r.success / r.total : 0,
            totalCostCny: Number(r.totalCost.toFixed(4)),
            costPerSuccessCny:
              r.success > 0
                ? Number(r.totalCost.div(r.success).toFixed(4))
                : null,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
    }),
});
