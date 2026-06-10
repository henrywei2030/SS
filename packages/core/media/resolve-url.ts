/**
 * MediaItem → 可 fetch 的 http(s) URL(M3a 六八)。
 *
 * 解析序:cdnUrl(provider 直链)> external://(直链落 storageKey 的旧格式)
 *   > 对象存储签名 URL(默认 1h)。placeholder:// (mock 占位)解析不出返回 null。
 * 想法池「resolveMediaFetchUrl 收 media→URL ×3」的落地起点 — 新代码一律走这里,
 * 旧三处(asset-generate 参考图等)留待工程卫生顺手收。
 */
import { getStorageAdapter } from '@ss/adapters/storage';

export async function resolveMediaFetchUrl(
  media: { cdnUrl: string | null; storageKey: string },
  opts: { expiresInSeconds?: number } = {},
): Promise<string | null> {
  if (media.cdnUrl) return media.cdnUrl;
  if (media.storageKey.startsWith('external://')) {
    return media.storageKey.slice('external://'.length);
  }
  if (media.storageKey.startsWith('placeholder://')) return null;
  try {
    return await getStorageAdapter().getSignedUrl(
      media.storageKey,
      opts.expiresInSeconds ?? 3600,
    );
  } catch {
    return null;
  }
}
