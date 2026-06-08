/**
 * SystemSetting 批量读 helper
 *
 * 背景:`prisma.systemSetting.findUnique` 散在 10+ 处(admin / aigc / script / storyboard / insights),
 * 多 key 同时读时各跑一次 query。这里做最小封装统一入口 + 一次性 IN 查询。
 *
 * 不加 cache(setSetting 写完后立刻要新值,cache 反复 invalidate 复杂度更高)。
 * 单 query IN 查 N 个 key,N=10 时省 9 次往返。
 */
import { TRPCError } from '@trpc/server';

import type { PrismaClient } from '@ss/db';

export type SystemSettingMap = Record<string, string | undefined>;

/**
 * 批量读 N 个 SystemSetting key,返回 { key → value | undefined }。
 *
 * @example
 *   const settings = await loadSystemSettings(ctx.prisma, [
 *     'binding.video.providerId',
 *     'binding.image.providerId',
 *     'shot.video.maxDurationS',
 *   ]);
 *   const videoProviderId = settings['binding.video.providerId'];
 */
export async function loadSystemSettings(
  prisma: PrismaClient,
  keys: readonly string[],
): Promise<SystemSettingMap> {
  if (keys.length === 0) return {};
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [...keys] } },
    select: { key: true, value: true },
  });
  const map: SystemSettingMap = {};
  for (const k of keys) map[k] = undefined;
  for (const r of rows) map[r.key] = r.value;
  return map;
}

/**
 * 读单个 SystemSetting,返回 value | undefined。
 *
 * 仅当真的只读 1 个 key 时用这个;读多个用 `loadSystemSettings` 一次性查。
 */
export async function loadSystemSetting(
  prisma: PrismaClient,
  key: string,
): Promise<string | undefined> {
  const row = await prisma.systemSetting.findUnique({
    where: { key },
    select: { value: true },
  });
  return row?.value ?? undefined;
}

// ---------------------------------------------------------------------------
// 模型绑定健壮解析(2026-06-08)
//
// 背景:binding.* 把 providerId 当自由字符串存 SystemSetting,跟 ProviderConfig
//   无引用完整性。删/停用一个 provider 后,指向它的 binding 静默悬空 → 各业务点
//   读到悬空 binding 喂给 getTextProvider 直接抛"不存在/已停用"(TEXT 链路无 Mock 兜底)。
//
// 这里给统一解析口:绑定值不可用时自动 fallback 到同 kind 第一个 active provider,
//   保证"后台每次换模型都能直接调用",彻底不再硬崩(只在该 kind 一个 active 都没有时报清晰错)。
// ---------------------------------------------------------------------------

// ProviderConfig.kind 枚举(与 Prisma ProviderKind 字面量一致,避免跨包 import)
export type BindingProviderKind =
  | 'TEXT'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'COMPLIANCE'
  | 'EMBEDDING';

/**
 * 把"业务绑定的 modelId / providerId"解析成一个保证可用(存在 + active + kind 匹配)的 providerId。
 *
 * 优先级:override(显式指定) > binding 值 —— 各自要求 active + kind 匹配;
 *   都不可用 → fallback 同 kind 第一个 active provider(+ warn 日志);
 *   该 kind 无任何 active provider → 抛 PRECONDITION_FAILED(可执行提示)。
 *
 * @param opts.value 已读到的 binding 值(省一次查;传 undefined 则内部按 bindingKey 读)
 */
export async function resolveBoundModelId(
  prisma: PrismaClient,
  opts: {
    bindingKey: string;
    kind: BindingProviderKind;
    override?: string | null;
    value?: string | null;
    purpose?: string; // 错误信息里的中文业务名,如 '灵感创作'
  },
): Promise<string> {
  const bindingVal =
    opts.value !== undefined
      ? (opts.value ?? '').trim()
      : ((await loadSystemSetting(prisma, opts.bindingKey)) ?? '').trim();
  const override = (opts.override ?? '').trim();

  // 候选:override 优先,其次 binding 值;去重去空
  const candidates = [...new Set([override, bindingVal].filter(Boolean))];
  for (const id of candidates) {
    const ok = await prisma.providerConfig.findFirst({
      where: { providerId: id, kind: opts.kind, isActive: true },
      select: { providerId: true },
    });
    if (ok) return ok.providerId;
  }

  // 悬空 / 停用 / 空 → fallback 同 kind 第一个 active provider
  const fallback = await prisma.providerConfig.findFirst({
    where: { kind: opts.kind, isActive: true },
    orderBy: [{ providerId: 'asc' }],
    select: { providerId: true, displayName: true },
  });
  if (fallback) {
    console.warn(
      `[binding] ${opts.bindingKey}=${JSON.stringify(
        candidates[0] ?? '(空)',
      )} 无可用 ${opts.kind} 模型(不存在/已停用),自动改用 "${fallback.providerId}"(${fallback.displayName})。` +
        ` 去 /admin/bindings 修正绑定可消除此告警。`,
    );
    return fallback.providerId;
  }

  // 该 kind 一个 active provider 都没有 → 抛清晰可执行错误
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: `${opts.purpose ?? opts.bindingKey} 没有可用的 ${opts.kind} 模型 — 请去 /admin/providers 启用一个 ${opts.kind} 模型,并在 /admin/bindings 完成绑定`,
  });
}

/**
 * Layer A · 把所有指向 providerId 的 binding.* 自动改绑到同 kind 另一个 active provider。
 *   用于删除 / 停用 provider 前维护引用完整性,防止静默悬空。
 *
 * @returns 改绑明细(供 mutation 汇报给前端);找不到替代时该 binding 留原值(不动,靠 Layer B 兜底)。
 */
export async function repointBindingsAwayFrom(
  prisma: PrismaClient,
  opts: { providerId: string; kind: BindingProviderKind },
): Promise<Array<{ key: string; to: string }>> {
  const bindings = await prisma.systemSetting.findMany({
    where: { key: { startsWith: 'binding.' }, value: opts.providerId },
    select: { key: true },
  });
  if (bindings.length === 0) return [];

  // 同 kind 另一个 active provider(排除正被删/停用的自己)
  const replacement = await prisma.providerConfig.findFirst({
    where: { kind: opts.kind, isActive: true, providerId: { not: opts.providerId } },
    orderBy: [{ providerId: 'asc' }],
    select: { providerId: true },
  });

  const repointed: Array<{ key: string; to: string }> = [];
  if (!replacement) return repointed; // 无替代 → 不动,留给 Layer B 用时兜底 + Layer C 标红
  for (const b of bindings) {
    await prisma.systemSetting.update({
      where: { key: b.key },
      data: { value: replacement.providerId },
    });
    repointed.push({ key: b.key, to: replacement.providerId });
  }
  return repointed;
}
