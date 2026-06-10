/**
 * 视频本地缓存(六八,queue kind `cache-video` 的 handler 本体)。
 *
 * 背景:视频 take 的 MediaItem 存 provider 直链(external://),播放走远端直链
 * 卡顿且 24h 过期。生成成功后异步把视频下载进对象存储:播放/成片/抽帧全走本地。
 *
 * 语义:
 *   - 只处理 kind=VIDEO 且 storageKey 还是 external:// 的(已缓存/本地生成的跳过,幂等)
 *   - 成功:storageKey → 真实 key,sizeBytes 补真值,meta.{cached,cachedAt,originUrl}
 *   - 失败:meta.cacheError 记录,**不抛**(原直链仍可播,下次重新生成/手动重试)
 */
import { prisma } from '@ss/db';
import { getStorageAdapter, buildStorageKey } from '@ss/adapters/storage';
import { sanitizeErrorMsg } from '@ss/shared/errors';
import { z } from 'zod';

export const CACHE_VIDEO_JOB_KIND = 'cache-video' as const;

export const CacheVideoJobDataSchema = z.object({
  mediaId: z.string().cuid(),
});
export type CacheVideoJobData = z.infer<typeof CacheVideoJobDataSchema>;

export async function processCacheVideoJob(data: unknown): Promise<void> {
  const { mediaId } = CacheVideoJobDataSchema.parse(data);
  const media = await prisma.mediaItem.findFirst({
    where: { id: mediaId, deletedAt: null },
    select: {
      id: true,
      kind: true,
      filename: true,
      projectId: true,
      mimeType: true,
      storageKey: true,
      cdnUrl: true,
      meta: true,
    },
  });
  if (!media || media.kind !== 'VIDEO' || !media.projectId) return;
  if (!media.storageKey.startsWith('external://')) return; // 已是本地存储,幂等跳过

  const originUrl = media.cdnUrl ?? media.storageKey.slice('external://'.length);
  const baseMeta =
    media.meta && typeof media.meta === 'object' && !Array.isArray(media.meta)
      ? (media.meta as Record<string, unknown>)
      : {};
  try {
    const res = await fetch(originUrl, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`源下载失败 HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const key = buildStorageKey({
      scope: 'project',
      projectId: media.projectId,
      kind: 'video',
      ext: 'mp4',
    });
    await getStorageAdapter().putObject(key, buf, {
      contentType: media.mimeType || 'video/mp4',
    });
    await prisma.mediaItem.update({
      where: { id: media.id },
      data: {
        storageKey: key,
        sizeBytes: buf.length,
        meta: {
          ...baseMeta,
          cached: true,
          cachedAt: new Date().toISOString(),
          originUrl,
        },
      },
    });
    console.log(
      `[cache-video] ${media.filename} 已缓存本地 (${(buf.length / 1048576).toFixed(1)}MB)`,
    );
  } catch (e) {
    const msg = sanitizeErrorMsg(e, 300);
    console.warn(`[cache-video] ${media.filename} 缓存失败(直链仍可播):`, msg);
    await prisma.mediaItem
      .update({
        where: { id: media.id },
        data: { meta: { ...baseMeta, cacheError: msg } },
      })
      .catch(() => {});
  }
}
