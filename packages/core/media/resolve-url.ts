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

/**
 * 该 URL 能否作为 moyu 视频/图像 API 的参考图被「使用」?
 *   moyu 两种用法:① 公网 http(s) → 它 server-side 拉取;② data: 内联 base64 → 它直接解码,不走拉取。
 * - data:(内联 base64)→ **true**(2026-06-13 翻案:seedance 经 moyu 多次真打成功、带 base64 参考图
 *     真出片 ¥6-10 实证 moyu 直接吃 base64;此前把 data: 也滤掉是误杀 → happyhorse 拿 0 图 i2v/r2v 必败)
 * - http(s) 且非本地回环主机 → true(公网可拉)
 * - blob: / 相对路径 / localhost / 127.0.0.1 / [::1] / 0.0.0.0 → false(浏览器域 / moyu 拉不到本机)
 *
 * ⚠️ 只滤「需 moyu 去拉、但它够不到」的本机 localhost(送了会 Headers Timeout 180s 卡死);
 *   data: base64 是内联、不走拉取,绝不能跟 localhost 混为一谈一起滤(那会误杀本可用的生成图参考)。
 */
export function isRelayFetchableUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  // data: 内联 base64 — moyu 直接解码使用,无需 server-side 拉取(seedance 真打实证可用)→ 放行
  if (/^data:/i.test(url)) return true;
  if (!/^https?:\/\//i.test(url)) return false; // blob:/相对路径 → 远端用不了
  try {
    // 去 IPv6 字面量方括号(否则 [fe80::] / [::1] 绕过下面所有检查)
    const host = new URL(url).hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
    // 本机回环 moyu 拉不到 + SSRF 防御:内网/metadata 段一律视为不可拉(全盘审计 low)。
    //   refImageUrls 经此 gate 后送 provider 被服务端 fetch,虽多为系统签名 URL,仍防御性拦内网。
    const INTERNAL = [
      /^127\./,
      /^10\./,
      /^192\.168\./,
      /^169\.254\./, // link-local + 云 metadata
      /^0\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    ];
    return !(
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '::' ||
      host.startsWith('fe80:') ||
      /^f[cd]/.test(host) ||
      INTERNAL.some((re) => re.test(host))
    );
  } catch {
    return false;
  }
}
