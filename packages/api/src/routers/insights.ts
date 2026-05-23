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
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router, protectedProcedure } from '../trpc.js';
import { assertProjectAccess } from '../middleware/access.js';

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

      // 1. 成本数据 — 从 ledger 拉(W6 audit:含 success 和 failed,分开统计)
      const ledgers = await ctx.prisma.costLedgerEntry.findMany({
        where: { projectId: input.projectId, createdAt: { gte: since } },
        select: {
          costCny: true,
          action: true,
          success: true,
          createdAt: true,
        },
      });

      let totalCostCny = 0;
      let successCostCny = 0;
      const costByKind: Record<CostKind, number> = {
        image: 0,
        video: 0,
        text: 0,
        audio: 0,
        compliance: 0,
        analysis: 0,
        other: 0,
      };
      const dailyCost = new Map<string, number>();
      const activeDays = new Set<string>();

      for (const l of ledgers) {
        const c = Number(l.costCny);
        totalCostCny += c;
        if (l.success) successCostCny += c;
        costByKind[classifyLedgerAction(l.action)] += c;
        const k = utcDayKey(l.createdAt);
        dailyCost.set(k, (dailyCost.get(k) ?? 0) + c);
        activeDays.add(k);
      }

      // 2. 计数 — 从 GenerationAttempt 拉(单一来源,跟 aigc.listGroups 对齐)
      //    过滤 rejected:false(废片不算成功) + 关联 shotGroup/episode 软删
      const attempts = await ctx.prisma.generationAttempt.findMany({
        where: {
          projectId: input.projectId,
          createdAt: { gte: since },
          rejected: false,
          // attempt 自身没 deletedAt,但 shotGroup/episode 软删时不算
          OR: [
            { shotGroupId: null },
            { shotGroup: { deletedAt: null, episode: { deletedAt: null } } },
          ],
        },
        select: { status: true, createdAt: true },
      });

      let successCount = 0;
      let failedCount = 0;
      let runningCount = 0;
      for (const a of attempts) {
        if (a.status === 'SUCCESS') successCount++;
        else if (a.status === 'FAILED') failedCount++;
        else if (a.status === 'RUNNING' || a.status === 'QUEUED') runningCount++;
      }
      const totalAttempts = successCount + failedCount + runningCount;

      // 3. 填充每天 0 数据点(UI 画连续时序)
      const costByDay: Array<{ date: string; cost: number }> = [];
      for (let i = 0; i < input.days; i++) {
        const d = new Date(since);
        d.setUTCDate(d.getUTCDate() + i);
        const k = utcDayKey(d);
        costByDay.push({ date: k, cost: Number((dailyCost.get(k) ?? 0).toFixed(4)) });
      }

      return {
        period: { since: since.toISOString(), days: input.days },
        totalCostCny: Number(totalCostCny.toFixed(4)),
        successCostCny: Number(successCostCny.toFixed(4)),
        totalAttempts,
        successCount,
        failedCount,
        runningCount,
        successRate: totalAttempts > 0 ? successCount / totalAttempts : 0,
        activeDays: activeDays.size,
        costByKind: Object.fromEntries(
          (Object.keys(costByKind) as CostKind[]).map((k) => [
            k,
            Number(costByKind[k].toFixed(4)),
          ]),
        ) as Record<CostKind, number>,
        costByDay,
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

      const map = new Map<
        string,
        {
          providerId: string;
          modelId: string;
          totalCost: number;
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
          totalCost: 0,
          total: 0,
          success: 0,
          failed: 0,
        };
        cur.totalCost += Number(g._sum.costCny ?? 0);
        cur.total += g._count._all;
        if (g.success) cur.success += g._count._all;
        else cur.failed += g._count._all;
        map.set(key, cur);
      }
      return Array.from(map.values())
        .map((r) => ({
          ...r,
          totalCost: Number(r.totalCost.toFixed(4)),
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

      const map = new Map<
        string,
        {
          groupId: string;
          total: number;
          success: number;
          failed: number;
          running: number;
          totalCost: number;
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
          totalCost: 0,
        };
        cur.total += g._count._all;
        cur.totalCost += Number(g._sum.costCny ?? 0);
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
              r.success > 0 ? Number((r.totalCost / r.success).toFixed(4)) : null,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
    }),
});
