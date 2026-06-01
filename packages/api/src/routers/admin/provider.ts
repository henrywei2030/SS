/**
 * admin.provider — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
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
// admin.provider
// ---------------------------------------------------------------------------

const providerRouter = router({
  list: adminProcedure.query(async () => {
    return listProviderConfigs();
  }),

  get: adminProcedure
    .input(z.object({ providerId: z.string().max(100) }))
    .query(async ({ ctx, input }) => {
      const all = await listProviderConfigs();
      const one = all.find((p) => p.providerId === input.providerId);
      if (!one) throw new TRPCError({ code: 'NOT_FOUND' });
      void ctx;
      return one;
    }),

  /**
   * 创建新 Provider(第 22 轮 audit — 4 类 Provider 入口设计落地)
   *
   * 允许 admin 在后台任意添加新 Provider,不必改 seed.ts
   *
   * 4 类入口示例:
   *   - 中转: providerId='custom-openrouter-claude', apiUrl='https://openrouter.ai/api/v1',
   *           defaultParams: { protocol: 'openai-compat', defaultModel: 'anthropic/claude-3.7-sonnet', source: 'relay' }
   *   - Poe:  providerId='poe-claude-3-7', apiUrl='https://api.poe.com/v1',
   *           defaultParams: { protocol: 'openai-compat', defaultModel: 'claude-3-7-sonnet', source: 'subscription' }
   *   - 直连: providerId='claude-opus-4-7-direct', apiUrl='https://api.anthropic.com/v1',
   *           defaultParams: { protocol: 'anthropic-native', defaultModel: 'claude-opus-4-7', source: 'direct' }
   *   - 本地: providerId='local-qwen-32b', apiUrl='http://localhost:11434/v1',
   *           defaultParams: { protocol: 'openai-compat', defaultModel: 'qwen2.5:32b', source: 'local' }
   *
   * 默认 isActive=false,setApiKey + setActive(true) 后才可用
   */
  create: adminProcedure
    .input(
      z.object({
        providerId: z
          .string()
          .min(3)
          .max(80)
          .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'providerId 必须 kebab-case(小写字母+数字+-)'),
        displayName: z.string().min(1).max(120),
        kind: z.enum(['VIDEO', 'IMAGE', 'TEXT', 'AUDIO', 'COMPLIANCE', 'EMBEDDING']),
        apiUrl: z.string().url().max(255),
        apiKeyRef: z.string().max(80).optional(),
        unitPriceCny: z.number().nonnegative(),
        unitName: z.enum(['second', 'image', 'ktoken', 'request', 'frame']),
        maxConcurrent: z.number().int().positive().default(5),
        rateLimitRpm: z.number().int().positive().default(60),
        defaultParams: z
          .object({
            protocol: z.enum(['openai-compat', 'anthropic-native', 'volcengine-native']).optional(),
            defaultModel: z.string().optional(),
            source: z.enum(['relay', 'subscription', 'direct', 'local']).optional(),
            endpointStyle: z.enum(['ark', 'relay']).optional(),
            inputUnitPriceCny: z.number().nonnegative().optional(),
            outputUnitPriceCny: z.number().nonnegative().optional(),
            maxDuration: z.number().positive().optional(),
            defaultSize: z.string().optional(),
            displayName: z.string().optional(),
          })
          .passthrough()
          .default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 第 23 轮 audit P0:apiUrl SSRF 防御 — 拒内网/metadata
      const urlErr = validateApiUrl(input.apiUrl);
      if (urlErr) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `apiUrl 被拒:${urlErr}` });
      }
      // 第 23 轮 audit P1:providerId case 标准化(防 "RELAY-X" vs "relay-x" 并发 create race)
      const normalizedProviderId = input.providerId.toLowerCase().trim();
      // providerId 防重(schema @unique 也防,提前拦更友好错误)
      const existing = await ctx.prisma.providerConfig.findUnique({
        where: { providerId: normalizedProviderId },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `providerId "${normalizedProviderId}" 已存在 — 改用 setApiKey/updatePricing 修改,或换 providerId`,
        });
      }
      const created = await ctx.prisma.providerConfig.create({
        data: {
          providerId: normalizedProviderId,
          displayName: input.displayName,
          kind: input.kind,
          apiUrl: input.apiUrl,
          apiKeyRef: input.apiKeyRef,
          unitPriceCny: input.unitPriceCny,
          unitName: input.unitName,
          maxConcurrent: input.maxConcurrent,
          rateLimitRpm: input.rateLimitRpm,
          // zod object.passthrough() 类型跟 Prisma InputJsonValue 推断不兼容,cast 处理
          // 安全:input 已 zod parse,passthrough 字段也是 JSON-safe 标量
          defaultParams: input.defaultParams as object,
          isActive: false, // 默认关 — setApiKey + setActive 后才启用
        },
      });
      await logOperation(
        ctx,
        'provider.config.create',
        'provider',
        input.providerId,
        null,
        {
          kind: input.kind,
          apiUrl: input.apiUrl,
          source: input.defaultParams.source ?? 'unspecified',
          protocol: input.defaultParams.protocol ?? 'unspecified',
        },
      );
      return created;
    }),

  /**
   * 删除 Provider — 仅允许 admin 自创的(非 seed 内置)
   *
   * 安全防御:
   *   - apiKeyConfigured=true 时拒删(防误删带 token 的)
   *   - 关联的 GenerationAttempt / CostLedgerEntry 不级联(数据保留供 audit)
   *   - 真实场景:推荐 setActive=false 软关闭代替 delete
   */
  delete: adminProcedure
    .input(z.object({ providerId: z.string().max(100), confirmDelete: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const cfg = await ctx.prisma.providerConfig.findUnique({
        where: { providerId: input.providerId },
      });
      if (!cfg) throw new TRPCError({ code: 'NOT_FOUND' });
      if (cfg.apiKeyEnc) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Provider 含 API Key,请先 clearApiKey 再 delete(防误删带 token 的)',
        });
      }
      // 关联数据保留(GenerationAttempt / CostLedgerEntry 的 providerId 是字符串,不外键级联)
      await ctx.prisma.providerConfig.delete({ where: { providerId: input.providerId } });
      await logOperation(
        ctx,
        'provider.config.delete',
        'provider',
        input.providerId,
        cfg,
        null,
      );
      return { success: true };
    }),

  setApiKey: adminProcedure
    .input(
      z.object({
        providerId: z.string().max(100),
        apiKey: z.string().min(8, 'API Key 至少 8 字符'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Audit 修(B-P1-3):relay 模式 provider 的 apiKey 来自 RelayProvider,
      // 在这里写 ProviderConfig.apiKeyEnc 会被 loadConfig 忽略 → 数据静默丢失
      const cfg = await ctx.prisma.providerConfig.findUnique({
        where: { providerId: input.providerId },
        select: { relayProviderId: true, relayProvider: { select: { displayName: true } } },
      });
      if (cfg?.relayProviderId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `此 Provider 属于中转站 "${cfg.relayProvider?.displayName ?? '中转站'}",请在中转站凭证卡片设置 Key(不能单独设)`,
        });
      }
      await setProviderApiKey(input.providerId, input.apiKey, ctx.user.id);
      await logOperation(ctx, 'provider.setApiKey', 'provider', input.providerId, null, {
        keyMasked: '••••' + input.apiKey.slice(-4),
      });
      return { success: true };
    }),

  clearApiKey: adminProcedure
    .input(z.object({ providerId: z.string().max(100) }))
    .mutation(async ({ ctx, input }) => {
      await clearProviderApiKey(input.providerId, ctx.user.id);
      await logOperation(ctx, 'provider.clearApiKey', 'provider', input.providerId, null, null);
      return { success: true };
    }),

  setActive: adminProcedure
    .input(z.object({ providerId: z.string().max(100), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await setProviderActive(input.providerId, input.isActive, ctx.user.id);
      await logOperation(ctx, 'provider.setActive', 'provider', input.providerId, null, {
        isActive: input.isActive,
      });
      return { success: true };
    }),

  /**
   * Phase 1.5.1(2026-05-25):从中转站 catalog 选模型 → 创建 ProviderConfig 行
   *
   * 输入 catalogKey('moyu' / 'poe' / 'openrouter')+ providerIdSuffix('claude-sonnet-4-5')
   * 内部 lookup catalog 拿模型元数据 → 创建 ProviderConfig 关联到 RelayProvider
   * 默认 isActive=false,用户在 UI 显式 toggle 启用
   */
  createFromCatalog: adminProcedure
    .input(
      z.object({
        // Audit 修(2026-05-25 r22.1):RelayProvider id 由 migration data migration 用
        // PostgreSQL gen_random_uuid() 生成(格式 'rly_<32hex>'),不是 cuid 格式。
        // 改 .min(1) 放宽校验 — 安全性靠 prisma 唯一性约束兜底(找不到行就抛 NOT_FOUND)
        relayProviderId: z.string().min(1), // 关联到哪个 RelayProvider 行
        catalogKey: z.string(), // 'moyu' / 'poe' / 'openrouter'
        providerIdSuffix: z.string(), // 'claude-sonnet-4-5'
        // 可选:用户改 providerId 前缀(默认 = catalogKey + '-' + providerIdSuffix)
        providerIdPrefix: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const found = findRelayModel(input.catalogKey, input.providerIdSuffix);
      if (!found) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `catalog ${input.catalogKey}/${input.providerIdSuffix} 不存在`,
        });
      }
      const relayCfg = await ctx.prisma.relayProvider.findUnique({
        where: { id: input.relayProviderId },
      });
      if (!relayCfg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '中转站凭证不存在' });
      }

      const prefix = input.providerIdPrefix ?? relayCfg.name;
      const providerId = `${prefix}-${input.providerIdSuffix}`.toLowerCase();

      // Audit 修(C-P0-2):防御性 kebab-case 校验 — catalog suffix 已规范,但拼接后再 check 防错填
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(providerId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `生成的 providerId "${providerId}" 含非法字符 — 需 kebab-case(只小写字母/数字/-)`,
        });
      }

      const existing = await ctx.prisma.providerConfig.findUnique({
        where: { providerId },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `providerId "${providerId}" 已存在 — 已添加过这个模型`,
        });
      }

      const m = found.model;
      const kind = found.kind;

      // 构造 defaultParams
      const defaultParams: Record<string, unknown> = {
        defaultModel: m.modelId,
        source: 'relay',
      };
      if (m.protocol) defaultParams.protocol = m.protocol;
      if (m.endpointStyle) defaultParams.endpointStyle = m.endpointStyle;
      if (m.defaultSize) defaultParams.defaultSize = m.defaultSize;
      if (m.maxDuration !== undefined) defaultParams.maxDuration = m.maxDuration;
      if (m.minDuration !== undefined) defaultParams.minDuration = m.minDuration;
      if (m.defaultDuration !== undefined)
        defaultParams.defaultDuration = m.defaultDuration;
      // 2026-05-27 audit r13:Video 能力字段透传 — capabilities query 读这些字段决定 UI 选项
      if (m.supportedResolutions !== undefined)
        defaultParams.supportedResolutions = m.supportedResolutions;
      if (m.defaultResolution !== undefined)
        defaultParams.defaultResolution = m.defaultResolution;
      if (m.supportsAudio !== undefined) defaultParams.supportsAudio = m.supportsAudio;
      if (m.supportsWebSearch !== undefined)
        defaultParams.supportsWebSearch = m.supportsWebSearch;
      if (m.supportsRefVideo !== undefined)
        defaultParams.supportsRefVideo = m.supportsRefVideo;
      if (m.supportsRefAudio !== undefined)
        defaultParams.supportsRefAudio = m.supportsRefAudio;

      const created = await ctx.prisma.providerConfig.create({
        data: {
          providerId,
          displayName: `${m.displayName}(via ${relayCfg.displayName})`,
          kind,
          // apiUrl / apiKey 都从 RelayProvider 继承(不存自己的)
          apiUrl: null,
          apiKeyEnc: null,
          apiKeyMasked: null,
          unitPriceCny: (m.unitPriceCny ?? 0).toString(),
          unitName: (m.unitName ?? 'ktoken') as string,
          maxConcurrent: 5,
          rateLimitRpm: 60,
          // Prisma InputJsonValue 跟 Record<string, unknown> 类型推断不兼容,cast 安全(已 zod parse)
          defaultParams: defaultParams as object,
          modelRate: m.modelRate != null ? m.modelRate.toString() : null,
          outputRate: m.outputRate != null ? m.outputRate.toString() : null,
          isActive: false, // 默认停用,等用户 toggle 启用
          relayProviderId: input.relayProviderId,
        },
      });
      await logOperation(
        ctx,
        'provider.createFromCatalog',
        'provider',
        providerId,
        null,
        {
          catalogKey: input.catalogKey,
          providerIdSuffix: input.providerIdSuffix,
          relayProviderId: input.relayProviderId,
          kind,
        },
      );
      return created;
    }),

  updatePricing: adminProcedure
    .input(
      z.object({
        providerId: z.string().max(100),
        unitPriceCny: z.number().nonnegative(),
        unitName: z.string(),
        maxConcurrent: z.number().int().positive().optional(),
        rateLimitRpm: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.providerConfig.findUnique({
        where: { providerId: input.providerId },
      });
      const updated = await ctx.prisma.providerConfig.update({
        where: { providerId: input.providerId },
        data: {
          unitPriceCny: input.unitPriceCny,
          unitName: input.unitName,
          ...(input.maxConcurrent !== undefined && { maxConcurrent: input.maxConcurrent }),
          ...(input.rateLimitRpm !== undefined && { rateLimitRpm: input.rateLimitRpm }),
        },
      });
      await logOperation(ctx, 'provider.updatePricing', 'provider', input.providerId, before, updated);
      return updated;
    }),

  /**
   * 测试连接(第 21 轮 audit 真实现)
   *
   * 行为:
   *   - text Provider:用 "reply with: pong" 最小 chat 调用,verify token + endpoint 有效
   *   - image Provider:仅 verify config 存在,真生成图会扣钱,**留 dryRun 选项**让 admin 真测时显式触发
   *   - video Provider:仅 verify config 存在(异步任务即使 dry 也会扣钱)
   *
   * 保护:
   *   - adminProcedure 守门(仅 admin 调)
   *   - per-admin rate limit 5 次/min(防误点刷爆 token)
   *   - errMsg 经 sanitizeErrorMsg 脱敏(防错误信息泄漏 Provider URL/token)
   *   - 全程入 OperationLog(action: 'provider.testConnection'),记 ok/失败/latencyMs
   */
  testConnection: adminProcedure
    .use(
      rateLimit({
        key: (ctx) => `provider.testConnection:${ctx.user?.id ?? 'anon'}`,
        max: 5,
        windowMs: 60_000,
        message: '测试连接过快(每分钟最多 5 次)— 防误点刷爆 token',
      }),
    )
    .input(
      z.object({
        providerId: z.string().max(100),
        /** 图像/视频默认 dryRun=true(只 verify 配置,不真生成防扣钱);text 总是真调(消耗 < 50 token) */
        dryRun: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const startedAt = Date.now();
      // Audit 修(B-P0-2):include relayProvider — 否则中转站停用 / 无 key 时前置检查不覆盖
      const cfg = await prisma.providerConfig.findUnique({
        where: { providerId: input.providerId },
        include: { relayProvider: true },
      });
      if (!cfg) {
        return {
          success: false,
          providerId: input.providerId,
          latencyMs: 0,
          message: '配置不存在',
        };
      }
      if (!cfg.isActive) {
        return {
          success: false,
          providerId: input.providerId,
          latencyMs: 0,
          message: 'Provider 未启用(isActive=false)— 先在 list 启用再测',
        };
      }
      // Audit 修(B-P0-2):中转站模型必须检查 RelayProvider 状态
      if (cfg.relayProviderId && cfg.relayProvider) {
        if (!cfg.relayProvider.isActive) {
          return {
            success: false,
            providerId: input.providerId,
            latencyMs: 0,
            message: `关联中转站 "${cfg.relayProvider.displayName}" 未启用 — 先在顶部中转站卡片启用`,
          };
        }
        if (!cfg.relayProvider.apiKeyEnc) {
          return {
            success: false,
            providerId: input.providerId,
            latencyMs: 0,
            message: `关联中转站 "${cfg.relayProvider.displayName}" 未配 API Key — 先设置`,
          };
        }
      }

      const baseLog = {
        providerId: input.providerId,
        kind: cfg.kind,
        dryRun: input.dryRun,
      };

      try {
        let resultMessage: string;
        if (cfg.kind === 'TEXT') {
          // 真调一次 chat,消耗 < 50 token,verify token + endpoint
          const provider = await getTextProvider(input.providerId);
          const r = await provider.generate(
            {
              prompt: 'Reply with just the word: pong',
              maxTokens: 5,
              temperature: 0,
            },
            { userId: ctx.user.id, skipLedger: true },
          );
          resultMessage = `OK · response="${r.text.slice(0, 50)}" · tokens=${r.inputTokens}+${r.outputTokens}`;
        } else if (cfg.kind === 'IMAGE' || cfg.kind === 'VIDEO') {
          if (input.dryRun) {
            // dryRun:仅 verify Provider 实例化成功 + apiKey 解密成功,不真生成
            if (cfg.kind === 'IMAGE') await getImageProvider(input.providerId);
            else await getVideoProvider(input.providerId);
            resultMessage = `配置 OK(dryRun · 未真生成,需 dryRun=false 测真接口会扣钱)`;
          } else {
            return {
              success: false,
              providerId: input.providerId,
              latencyMs: Date.now() - startedAt,
              message:
                'IMAGE/VIDEO 真测会扣钱,请通过 UI 业务流程触发(/art 或 /aigc),不在 admin testConnection 内自动触发',
            };
          }
        } else {
          resultMessage = `kind=${cfg.kind} 暂不支持自动测试(Phase 1.5 补)`;
        }

        const latencyMs = Date.now() - startedAt;
        await logOperation(ctx, 'provider.config.testConnection', 'provider', input.providerId, null, {
          ...baseLog,
          success: true,
          latencyMs,
        });
        return {
          success: true,
          providerId: input.providerId,
          latencyMs,
          message: resultMessage,
        };
      } catch (e) {
        const latencyMs = Date.now() - startedAt;
        const errMsg = sanitizeErrorMsg(e);
        await logOperation(ctx, 'provider.config.testConnection', 'provider', input.providerId, null, {
          ...baseLog,
          success: false,
          latencyMs,
          error: errMsg,
        });
        return {
          success: false,
          providerId: input.providerId,
          latencyMs,
          message: errMsg,
        };
      }
    }),
});


export { providerRouter };
