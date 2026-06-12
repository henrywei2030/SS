/**
 * MediaItem → 浏览器可直接渲染的预览 URL。
 *
 * - cdnUrl 优先(PUBLIC 对象 / 外链 / AIGC 视频已填);
 * - 否则对本地 storageKey 现签 MinIO signed URL(本地 dev cdnUrl 永远 null,
 *   裸 storageKey 形如 `projects/xxx/image/abc.png` 不是 URL,直接当 <img src> 会 404);
 * - `external://` strip 前缀取直链;`placeholder://`(Mock 占位)返回 null,前端显示占位 icon。
 *
 * 背景:media.list 早已用同款逻辑(故素材库预览正常),此处抽共享给 asset-crud 的
 *   mediaMap 复用 —— 资产编辑/卡片预览此前直接用裸 storageKey 当 URL 导致上传图预览 404。
 */
import { getStorageAdapter } from '@ss/adapters/storage';

export async function resolveMediaPreviewUrl(m: {
  cdnUrl?: string | null;
  storageKey: string;
}): Promise<string | null> {
  if (m.cdnUrl) return m.cdnUrl;
  if (m.storageKey.startsWith('external://')) return m.storageKey.replace(/^external:\/\//, '');
  if (m.storageKey.startsWith('placeholder://')) return null;
  try {
    return await getStorageAdapter().getSignedUrl(m.storageKey, 3600);
  } catch {
    return null;
  }
}
