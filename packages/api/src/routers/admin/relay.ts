/**
 * admin.relay — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
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
// admin.relay — 中转站凭证统一管理(2026-05-25 Phase 1.5.1)
//
// 痛点:8 个 relay-* provider 每个单独设 API Key 浪费操作;中转站实际 1 token 共享。
// 设计:一次 setCredential 批量 sync 所有 relay-* provider 的 apiUrl + apiKey,loadConfig 不变。
//      UI 只在顶部显示一个凭证表单,中转站模型列表只显示 toggle(启停)+ 中转站归档参数。
// ---------------------------------------------------------------------------

const relayRouter = router({
  /** 列出所有中转站凭证(多中转站管理) */
  list: adminProcedure.query(async () => {
    return listRelayProviders();
  }),

  /** 创建中转站凭证(名称 kebab-case 唯一,displayName 用户可见) */
  create: adminProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(2)
          .max(50)
          .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'name 必须 kebab-case'),
        displayName: z.string().min(1).max(100),
        apiUrl: z.string().url().max(255).optional(),
        catalogKey: z.string().max(50).optional(),
        notes: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.apiUrl) {
        const urlErr = validateApiUrl(input.apiUrl);
        if (urlErr)
          throw new TRPCError({ code: 'BAD_REQUEST', message: `apiUrl 被拒:${urlErr}` });
      }
      try {
        const created = await createRelayProvider({
          name: input.name,
          displayName: input.displayName,
          apiUrl: input.apiUrl,
          catalogKey: input.catalogKey,
          notes: input.notes,
          updatedBy: ctx.user.id,
        });
        await logOperation(ctx, 'relay.provider.create', 'relayProvider', created.id, null, {
          name: created.name,
          displayName: created.displayName,
          catalogKey: created.catalogKey,
        });
        return created;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('Unique constraint')) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `中转站 name "${input.name}" 已存在,换一个或先 delete 旧的`,
          });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg });
      }
    }),

  /** 更新中转站基本字段 */
  update: adminProcedure
    .input(
      z.object({
        // Audit 修(r22.1):RelayProvider id 可能是 migration 生成的 'rly_<uuid>' 格式
        id: z.string().min(1),
        displayName: z.string().min(1).max(100).optional(),
        apiUrl: z.string().url().max(255).optional(),
        notes: z.string().max(500).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      if (data.apiUrl) {
        const urlErr = validateApiUrl(data.apiUrl);
        if (urlErr)
          throw new TRPCError({ code: 'BAD_REQUEST', message: `apiUrl 被拒:${urlErr}` });
      }
      await updateRelayProvider(id, data, ctx.user.id);
      await logOperation(ctx, 'relay.provider.update', 'relayProvider', id, null, data);
      return { success: true };
    }),

  /** 设置某中转站的 API Key */
  setApiKey: adminProcedure
    .input(
      z.object({
        id: z.string().min(1), // r22.1:同上,不限定 cuid 格式
        apiKey: z.string().min(8, 'API Key 至少 8 字符'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await setRelayProviderApiKey(input.id, input.apiKey, ctx.user.id);
      await logOperation(ctx, 'relay.provider.setApiKey', 'relayProvider', input.id, null, {
        keyMasked: '••••' + input.apiKey.slice(-4),
      });
      return { success: true };
    }),

  /** 清除某中转站的 API Key */
  clearApiKey: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await clearRelayProviderApiKey(input.id, ctx.user.id);
      await logOperation(
        ctx,
        'relay.provider.clearApiKey',
        'relayProvider',
        input.id,
        null,
        null,
      );
      return { success: true };
    }),

  /** 删除中转站(拒删:关联 active ProviderConfig 时) */
  delete: adminProcedure
    .input(z.object({ id: z.string().min(1), confirmDelete: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await deleteRelayProvider(input.id);
        await logOperation(
          ctx,
          'relay.provider.delete',
          'relayProvider',
          input.id,
          null,
          null,
        );
        return { success: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: msg });
      }
    }),
});

// ---------------------------------------------------------------------------
// admin.catalog — 静态中转站模型 catalog(2026-05-25 Phase 1.5.1)
//
// 数据源:packages/shared/data/relay-catalogs.json
// 用法:UI 显示某中转站下的精选 / 候选模型 → 用户选 → admin.provider.createFromCatalog 落 DB
// ---------------------------------------------------------------------------

const catalogRouter = router({
  /** 列出所有已知中转站的 catalog 摘要(含每类 model 列表 + isDefault 标记) */
  list: adminProcedure.query(async () => {
    return listCatalogSummaries();
  }),

  /** 取某中转站某类别的模型列表 */
  listModels: adminProcedure
    .input(
      z.object({
        catalogKey: z.string(),
        kind: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'COMPLIANCE']),
      }),
    )
    .query(async ({ input }) => {
      return getRelayModels(input.catalogKey, input.kind);
    }),
});


export { relayRouter };
export { catalogRouter };
