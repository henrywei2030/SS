/**
 * admin.api-usage — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
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
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  listProviderConfigs,
  setProviderApiKey,
  clearProviderApiKey,
  setProviderActive,
  getTextProvider,
  getImageProvider,
  getVideoProvider,
  // Phase 1.5.1 multi-credential RelayProvider 管理(2026-05-25 升级)
  listRelayProviders,
  createRelayProvider,
  updateRelayProvider,
  setRelayProviderApiKey,
  clearRelayProviderApiKey,
  deleteRelayProvider,
} from '@ss/adapters/provider';
import { prisma } from '@ss/db';
import {
  sanitizeErrorMsg,
  listCatalogSummaries,
  findRelayModel,
  getRelayModels,
} from '@ss/shared';

import { router, adminProcedure, rateLimit } from '../../trpc.js';
import { logOperation } from '../../middleware/audit.js';
// 第 23 轮 audit P1:apiUrl SSRF 防御
import { validateApiUrl } from '../../utils/url-safety.js';

// ---------------------------------------------------------------------------
// admin.apiUsage — GenerationAttempt + CostLedger 全局聚合(W7)
//
// 跟 insights 的区别:不过滤 projectId,看的是整个平台用量
//   - overall: 总 attempt 数(按 status)+ 总 cost
//   - byProvider: 每个 provider 的 attempt 分布 + cost,按 cost desc
//   - byAction: 按 action 枚举(VIDEO/IMAGE/TEXT/ANALYSIS/...)分布
//   - dailyTrend: 30 天日 cost + count 曲线
// ---------------------------------------------------------------------------

export interface ProviderStats {
  providerId: string;
  success: number;
  failed: number;
  inflight: number;
  cost: number;
}

const apiUsageRouter = router({
  summary: adminProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - input.days * 24 * 3600 * 1000);

      const [overall, totalCost, byProvider, providerCost, byAction, dailyTrend] =
        await Promise.all([
          ctx.prisma.generationAttempt.groupBy({
            by: ['status'],
            where: { createdAt: { gte: since } },
            _count: { _all: true },
          }),
          ctx.prisma.costLedgerEntry.aggregate({
            where: { createdAt: { gte: since }, success: true },
            _sum: { costCny: true },
          }),
          ctx.prisma.generationAttempt.groupBy({
            by: ['providerId', 'status'],
            where: { createdAt: { gte: since } },
            _count: { _all: true },
          }),
          ctx.prisma.costLedgerEntry.groupBy({
            by: ['providerId'],
            where: { createdAt: { gte: since }, success: true },
            _sum: { costCny: true },
          }),
          ctx.prisma.generationAttempt.groupBy({
            by: ['action'],
            where: { createdAt: { gte: since } },
            _count: { _all: true },
          }),
          ctx.prisma.$queryRaw<Array<{ day: string; total: bigint; cost: number }>>`
            SELECT
              to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
              COUNT(*) as total,
              COALESCE(SUM(cost_cny), 0)::float as cost
            FROM cost_ledger_entries
            WHERE created_at >= ${since} AND success = true
            GROUP BY day
            ORDER BY day ASC
          `,
        ]);

      // 聚合 byProvider:把 status 维度合并到 provider 维度
      const providerMap = new Map<string, ProviderStats>();
      for (const r of byProvider) {
        const entry: ProviderStats = providerMap.get(r.providerId) ?? {
          providerId: r.providerId,
          success: 0,
          failed: 0,
          inflight: 0,
          cost: 0,
        };
        if (r.status === 'SUCCESS') entry.success = r._count._all;
        else if (r.status === 'FAILED') entry.failed = r._count._all;
        else if (r.status === 'QUEUED' || r.status === 'RUNNING')
          entry.inflight += r._count._all;
        providerMap.set(r.providerId, entry);
      }
      for (const r of providerCost) {
        const entry = providerMap.get(r.providerId);
        if (entry) {
          entry.cost = Number(r._sum.costCny ?? 0);
        } else {
          providerMap.set(r.providerId, {
            providerId: r.providerId,
            success: 0,
            failed: 0,
            inflight: 0,
            cost: Number(r._sum.costCny ?? 0),
          });
        }
      }

      const sumByStatus = (status: string): number =>
        overall.find((r) => r.status === status)?._count._all ?? 0;

      return {
        days: input.days,
        overall: {
          total: overall.reduce((s, r) => s + r._count._all, 0),
          success: sumByStatus('SUCCESS'),
          failed: sumByStatus('FAILED'),
          inflight: sumByStatus('QUEUED') + sumByStatus('RUNNING'),
          totalCostCny: Number(totalCost._sum.costCny ?? 0),
        },
        byProvider: Array.from(providerMap.values()).sort((a, b) => b.cost - a.cost),
        byAction: byAction
          .map((r) => ({ action: r.action, count: r._count._all }))
          .sort((a, b) => b.count - a.count),
        dailyTrend: dailyTrend.map((r) => ({
          day: r.day,
          total: Number(r.total),
          cost: r.cost,
        })),
      };
    }),

  // Phase 1.5 P0-4(主次重审 v2.1):CSV 导出 — 运维对账 / 用户拿明细 用
  //
  // 字段(13 列):时间 / 用户 / 项目 / Provider / 模型 / Action / 类型 / 输入(units) / 输出(units) / 单价 / 花费(CNY) / 成功 / 退款原因
  // 注:不暴露 attemptId(内部 id 不必要给运维),也不含 cache/group(Phase 2)
  exportCsv: adminProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(30),
        providerId: z.string().max(100).optional(),
        userId: z.string().cuid().optional(),
        projectId: z.string().cuid().optional(),
        // 默认含 PREPAY + REFUND(完整审计);设 false 则只出 NORMAL(简化对账)
        includePrepayRefund: z.boolean().default(true),
        // 上限 10000 行防 OOM / 超时(运维需更多就分时段导)
        maxRows: z.number().min(100).max(10000).default(5000),
      }),
    )
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - input.days * 24 * 3600 * 1000);
      const where: Record<string, unknown> = { createdAt: { gte: since } };
      if (input.providerId) where.providerId = input.providerId;
      if (input.userId) where.userId = input.userId;
      if (input.projectId) where.projectId = input.projectId;
      if (!input.includePrepayRefund) where.entryType = 'NORMAL';

      const rows = await ctx.prisma.costLedgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: input.maxRows,
        select: {
          createdAt: true,
          userId: true,
          projectId: true,
          providerId: true,
          modelId: true,
          action: true,
          entryType: true,
          inputUnits: true,
          outputUnits: true,
          unitPriceCny: true,
          costCny: true,
          success: true,
          refundReason: true,
        },
      });

      // CSV escape(RFC 4180 子集 — 字段含 , 或 " 或 \n 时包双引号 + 内部 " escape 成 "")
      const esc = (v: string | null | undefined): string => {
        const s = v ?? '';
        if (s === '') return '';
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const header = [
        '时间',
        '用户ID',
        '项目ID',
        'Provider',
        '模型',
        'Action',
        '类型',
        '输入',
        '输出',
        '单价(CNY)',
        '花费(CNY)',
        '成功',
        '退款原因',
      ].join(',');
      const lines = rows.map((r) =>
        [
          esc(r.createdAt.toISOString()),
          esc(r.userId),
          esc(r.projectId),
          esc(r.providerId),
          esc(r.modelId),
          esc(r.action),
          esc(r.entryType),
          String(r.inputUnits),
          String(r.outputUnits),
          esc(String(r.unitPriceCny)),
          esc(String(r.costCny)),
          r.success ? 'true' : 'false',
          esc(r.refundReason),
        ].join(','),
      );
      // BOM(U+FEFF)让 Excel / 国产 office 正确识别 UTF-8 中文 — 显式转义防编辑器吞字符
      const csv = '﻿' + [header, ...lines].join('\r\n');

      // 写 OperationLog(导出含敏感成本数据,审计可追溯)
      await logOperation(ctx, 'admin.apiUsage.exportCsv', 'costLedger', `days=${input.days}`, null, {
        days: input.days,
        rowCount: rows.length,
        filters: {
          providerId: input.providerId ?? null,
          userId: input.userId ?? null,
          projectId: input.projectId ?? null,
          includePrepayRefund: input.includePrepayRefund,
        },
      });

      return {
        csv,
        rowCount: rows.length,
        filename: `cost-ledger-${input.days}d-${new Date().toISOString().slice(0, 10)}.csv`,
        truncated: rows.length >= input.maxRows,
      };
    }),

  /**
   * 2026-05-27 用户反馈:视频生成明细复盘
   * 返最近 N 条 VIDEO GenerationAttempt 全量明细(prompt 来自 inputJson.positivePrompt,已脱敏)
   * 用于 /admin/api-usage 明细 table:时间 / 项目 / 集 / 分镜组 / Provider / Status / 耗时 / 成本 / errorMsg / requestId / 操作员
   */
  videoAttempts: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(50),
        statusFilter: z.enum(['ALL', 'SUCCESS', 'FAILED', 'RUNNING']).default('ALL'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = { action: 'VIDEO' };
      if (input.statusFilter !== 'ALL') {
        where.status = input.statusFilter;
      }
      const rows = await ctx.prisma.generationAttempt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        include: {
          shotGroup: {
            select: {
              number: true,
              episode: {
                select: {
                  number: true,
                  project: { select: { id: true, name: true } },
                },
              },
            },
          },
          user: { select: { id: true, displayName: true, email: true } },
        },
      });
      return rows.map((a) => {
        const aj = (a.inputJson ?? {}) as Record<string, unknown>;
        return {
          id: a.id,
          createdAt: a.createdAt,
          startedAt: a.startedAt,
          finishedAt: a.finishedAt,
          durationMs: a.durationMs,
          status: a.status,
          providerId: a.providerId,
          modelId: a.modelId,
          providerJobId: a.providerJobId,
          costCny: a.costCny.toString(),
          errorMsg: a.errorMsg,
          rejected: a.rejected,
          // 项目 / 集 / 分镜组
          projectId: a.shotGroup?.episode?.project?.id ?? null,
          projectName: a.shotGroup?.episode?.project?.name ?? null,
          episodeNumber: a.shotGroup?.episode?.number ?? null,
          groupNumber: a.shotGroup?.number ?? null,
          // 输入(已脱敏:preview + hash)
          promptPreview:
            typeof aj.positivePrompt === 'object' && aj.positivePrompt !== null
              ? ((aj.positivePrompt as Record<string, unknown>).preview as
                  | string
                  | undefined)
              : typeof aj.positivePrompt === 'string'
                ? (aj.positivePrompt as string).slice(0, 100)
                : null,
          aspectRatio:
            typeof aj.aspectRatio === 'string' ? aj.aspectRatio : null,
          durationS:
            typeof aj.durationS === 'number' ? aj.durationS : null,
          // 操作员
          createdBy: a.user
            ? { id: a.user.id, displayName: a.user.displayName, email: a.user.email }
            : null,
        };
      });
    }),

  /**
   * 二十九收工:videoAttempts CSV 导出 — 复用 exportCsv 模式
   *
   * 跟 exportCsv(导 CostLedger)互补:这个导视频生成明细,含 prompt preview / aspectRatio / durationS,
   * 用户拿来复盘"哪些 group 失败 / 哪个 model 抽卡率最高 / 单条多长时间"。
   *
   * 字段 14 列;maxRows 5000 上限防 OOM;BOM 兼容 Excel 中文。
   */
  videoAttemptsExportCsv: adminProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(30),
        statusFilter: z.enum(['ALL', 'SUCCESS', 'FAILED', 'RUNNING']).default('ALL'),
        maxRows: z.number().min(100).max(10000).default(5000),
      }),
    )
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - input.days * 24 * 3600 * 1000);
      const where: Record<string, unknown> = {
        action: 'VIDEO',
        createdAt: { gte: since },
      };
      if (input.statusFilter !== 'ALL') {
        where.status = input.statusFilter;
      }

      const rows = await ctx.prisma.generationAttempt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: input.maxRows,
        include: {
          shotGroup: {
            select: {
              number: true,
              episode: {
                select: {
                  number: true,
                  project: { select: { name: true } },
                },
              },
            },
          },
          user: { select: { displayName: true, email: true } },
        },
      });

      const esc = (v: string | null | undefined): string => {
        const s = v ?? '';
        if (s === '') return '';
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const header = [
        '时间',
        '项目',
        '集',
        '分镜组',
        'Provider',
        '模型',
        '状态',
        '耗时(ms)',
        '成本(CNY)',
        '画面比例',
        '时长(s)',
        '错误信息',
        'providerJobId',
        '操作员',
      ].join(',');
      const lines = rows.map((a) => {
        const aj = (a.inputJson ?? {}) as Record<string, unknown>;
        const aspectRatio = typeof aj.aspectRatio === 'string' ? aj.aspectRatio : '';
        const durationS = typeof aj.durationS === 'number' ? String(aj.durationS) : '';
        const operator = a.user
          ? `${a.user.displayName} <${a.user.email}>`
          : '';
        return [
          esc(a.createdAt.toISOString()),
          esc(a.shotGroup?.episode?.project?.name ?? null),
          a.shotGroup?.episode?.number != null ? String(a.shotGroup.episode.number) : '',
          a.shotGroup?.number != null ? String(a.shotGroup.number) : '',
          esc(a.providerId),
          esc(a.modelId),
          esc(a.status),
          a.durationMs != null ? String(a.durationMs) : '',
          esc(a.costCny.toString()),
          esc(aspectRatio),
          durationS,
          esc(a.errorMsg?.slice(0, 200) ?? null),
          esc(a.providerJobId),
          esc(operator),
        ].join(',');
      });
      const csv = '﻿' + [header, ...lines].join('\r\n');

      await logOperation(
        ctx,
        'admin.videoAttempts.exportCsv',
        'generationAttempt',
        `days=${input.days}`,
        null,
        {
          days: input.days,
          rowCount: rows.length,
          statusFilter: input.statusFilter,
        },
      );

      return {
        csv,
        rowCount: rows.length,
        filename: `video-attempts-${input.days}d-${new Date().toISOString().slice(0, 10)}.csv`,
        truncated: rows.length >= input.maxRows,
      };
    }),
});


export { apiUsageRouter };
