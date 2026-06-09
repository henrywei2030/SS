/**
 * admin.binding — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
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
import { logOperation } from '../../middleware/audit.js';

// ---------------------------------------------------------------------------
// admin.binding — 模型用途绑定
//
// "把哪个 LLM 用在哪个业务环节"的集中管理。
// 例：剧本分析 / 分镜生成 / 提示词生成 → 各自绑定一个 modelId（来自 ProviderConfig）。
// 数据落地在 SystemSetting，key 形如 `binding.<module>.<purpose>.modelId`。
// ---------------------------------------------------------------------------

export interface BindingItem {
  key: string;
  value: string;
  description: string | null;
  kind: 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'COMPLIANCE' | 'EMBEDDING' | 'OTHER';
  options: Array<{
    providerId: string;
    displayName: string;
    isActive: boolean;
  }>;
}

// docx.parser binding 是「解析库选择」(非 provider)→ 只允许已实现的 parser,防被误配成模型 ID
//   (script-extract.ts 实际只实现 mammoth;将来加 docx2md 等,这里与那边 switch 同步)。
const IMPLEMENTED_DOCX_PARSERS = ['mammoth'];
const isDocxParserKey = (key: string): boolean => key.includes('docx.parser');

/** 从 binding key 推断业务期望的 ProviderKind */
function bindingKindOf(key: string): BindingItem['kind'] {
  if (key.includes('docx.parser')) return 'OTHER'; // 非 LLM
  if (key.includes('modelId')) {
    if (key.includes('image')) return 'IMAGE';
    if (key.includes('video')) return 'VIDEO';
    if (key.includes('audio') || key.includes('voice')) return 'AUDIO';
    if (key.includes('compliance')) return 'COMPLIANCE';
    if (key.includes('embedding')) return 'EMBEDDING';
    return 'TEXT'; // 默认 LLM
  }
  return 'OTHER';
}

const bindingRouter = router({
  /** 列出所有 binding.* 设置，并为每条带上候选 provider 列表 */
  list: adminProcedure.query(async ({ ctx }) => {
    const settings = await ctx.prisma.systemSetting.findMany({
      where: { category: 'model_binding' },
      orderBy: { key: 'asc' },
    });
    const providers = await ctx.prisma.providerConfig.findMany({
      orderBy: [{ kind: 'asc' }, { displayName: 'asc' }],
    });

    return settings.map((s): BindingItem => {
      const kind = bindingKindOf(s.key);
      // docx.parser 是「解析库选择」非 provider → 只列已实现 parser(防误配成模型 ID);
      //   其它 OTHER 全列;LLM 类按 kind 过滤。
      const options = isDocxParserKey(s.key)
        ? IMPLEMENTED_DOCX_PARSERS.map((p) => ({ providerId: p, displayName: p, isActive: true }))
        : (kind === 'OTHER' ? providers : providers.filter((p) => p.kind === kind)).map((p) => ({
            providerId: p.providerId,
            displayName: p.displayName,
            isActive: p.isActive,
          }));
      return { key: s.key, value: s.value, description: s.description, kind, options };
    });
  }),

  /** 设置某一绑定 — 与 admin.system.setSetting 等价但带强校验 */
  set: adminProcedure
    .input(
      z.object({
        key: z.string().regex(/^binding\./, '只允许修改 binding.* 类设置'),
        value: z.string().min(1, '值不能为空'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.systemSetting.findUnique({ where: { key: input.key } });
      if (!before) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '绑定 key 不存在' });
      }

      // docx.parser:解析库选择,值必须是已实现 parser(防误配成模型 ID 致剧本上传挂)。
      // 其它非 OTHER(LLM 类):value 必须是真实 + isActive 的 provider(W1-W7 audit)。
      const kind = bindingKindOf(input.key);
      if (isDocxParserKey(input.key)) {
        if (!IMPLEMENTED_DOCX_PARSERS.includes(input.value)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `docx parser "${input.value}" 未接入,当前只支持:${IMPLEMENTED_DOCX_PARSERS.join(' / ')}`,
          });
        }
      } else if (kind !== 'OTHER') {
        const provider = await ctx.prisma.providerConfig.findFirst({
          where: { providerId: input.value, kind: kind },
        });
        if (!provider) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `provider ${input.value}（kind=${kind}）不存在或类型不匹配`,
          });
        }
        if (!provider.isActive) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `provider ${input.value} 已被禁用(isActive=false),先在 /admin/providers 启用再绑`,
          });
        }
      }

      const updated = await ctx.prisma.systemSetting.update({
        where: { key: input.key },
        data: { value: input.value, updatedBy: ctx.user.id },
      });
      // r8 性能优化:binding 改后失效相关 cache · 业务 router 下次读拿新值
      try {
        const { cacheInvalidatePrefix } = await import('@ss/queue/cache');
        await cacheInvalidatePrefix('cache:bindings:');
      } catch (e) {
        console.warn('[binding.set] cache invalidate failed (non-blocking):', e instanceof Error ? e.message : e);
      }
      await logOperation(ctx, 'binding.set', 'systemSetting', updated.id, before, updated);
      return updated;
    }),
});

export { bindingRouter };
