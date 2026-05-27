/**
 * SystemSetting 批量读 helper
 *
 * 背景:`prisma.systemSetting.findUnique` 散在 10+ 处(admin / aigc / script / storyboard / insights),
 * 多 key 同时读时各跑一次 query。这里做最小封装统一入口 + 一次性 IN 查询。
 *
 * 不加 cache(setSetting 写完后立刻要新值,cache 反复 invalidate 复杂度更高)。
 * 单 query IN 查 N 个 key,N=10 时省 9 次往返。
 */
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
