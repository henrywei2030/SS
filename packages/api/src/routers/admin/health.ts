/**
 * admin.health — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
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
// admin.health — 基础设施健康检查(W7)
//
// 并行 ping DB / Redis / MinIO 三个依赖,返回 ok + 延迟 + 错误。
// 用于 admin /health 运维页 + Docker healthcheck / K8s readinessProbe。
// ---------------------------------------------------------------------------

export interface ServiceHealth {
  ok: boolean;
  latencyMs: number;
  error: string | null;
}

const healthRouter = router({
  check: adminProcedure.query(async ({ ctx }) => {
    const checkDb = async (): Promise<ServiceHealth> => {
      const start = Date.now();
      try {
        await ctx.prisma.$queryRaw`SELECT 1`;
        return { ok: true, latencyMs: Date.now() - start, error: null };
      } catch (e) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    };

    const checkRedis = async (): Promise<ServiceHealth> => {
      const start = Date.now();
      try {
        // 动态 import 防 SSR 阶段 ioredis 在 edge runtime 失败(本路径只跑 Node)
        const { getPrimaryRedis } = await import('@ss/queue/redis');
        const redis = getPrimaryRedis();
        const result = await redis.ping();
        return {
          ok: result === 'PONG',
          latencyMs: Date.now() - start,
          error: result === 'PONG' ? null : `unexpected reply: ${result}`,
        };
      } catch (e) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    };

    const checkMinio = async (): Promise<ServiceHealth> => {
      const start = Date.now();
      const endpoint = process.env.S3_ENDPOINT;
      if (!endpoint) {
        return { ok: false, latencyMs: 0, error: 'S3_ENDPOINT not set' };
      }
      // 二十九收工 S5:SSRF 防御 — 即便 admin 触发,S3_ENDPOINT 误配指向 metadata IP 也会被拒
      // dev 默认放行 localhost(NODE_ENV !== 'production' 时)
      const urlErr = validateApiUrl(endpoint);
      if (urlErr) {
        return { ok: false, latencyMs: 0, error: `S3_ENDPOINT 不安全:${urlErr}` };
      }
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch(`${endpoint.replace(/\/$/, '')}/minio/health/live`, {
          signal: ctrl.signal,
        });
        clearTimeout(tid);
        return {
          ok: res.ok,
          latencyMs: Date.now() - start,
          error: res.ok ? null : `HTTP ${res.status}`,
        };
      } catch (e) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    };

    const [db, redis, minio] = await Promise.all([checkDb(), checkRedis(), checkMinio()]);
    return {
      db,
      redis,
      minio,
      checkedAt: new Date().toISOString(),
    };
  }),
});


export { healthRouter };
