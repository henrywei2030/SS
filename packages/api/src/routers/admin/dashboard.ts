/**
 * admin.dashboard — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
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
// admin.dashboard(第 23 轮 audit:接通 /admin 首页 KPI 卡真 data,替换 ¥0.00 hardcode)
// ---------------------------------------------------------------------------

const dashboardRouter = router({
  /** 平台级 4 KPI(跨全 project 聚合,所有 entryType 全算) */
  platformOverview: adminProcedure.query(async ({ ctx }) => {
    const where = { success: true };
    const [total, image, video, seedance, projectCount, userCount] = await Promise.all([
      ctx.prisma.costLedgerEntry.aggregate({ where, _sum: { costCny: true } }),
      ctx.prisma.costLedgerEntry.aggregate({
        where: { ...where, action: { startsWith: 'image' } },
        _sum: { costCny: true },
      }),
      ctx.prisma.costLedgerEntry.aggregate({
        where: { ...where, action: { startsWith: 'video' } },
        _sum: { costCny: true },
      }),
      ctx.prisma.costLedgerEntry.aggregate({
        where: { ...where, providerId: { contains: 'seedance', mode: 'insensitive' } },
        _sum: { costCny: true },
      }),
      ctx.prisma.project.count({ where: { deletedAt: null } }),
      ctx.prisma.user.count({ where: { deletedAt: null } }),
    ]);
    return {
      totalCny: Number(total._sum.costCny ?? 0),
      imageCny: Number(image._sum.costCny ?? 0),
      videoCny: Number(video._sum.costCny ?? 0),
      seedanceCny: Number(seedance._sum.costCny ?? 0),
      projectCount,
      userCount,
    };
  }),
});

export { dashboardRouter };
