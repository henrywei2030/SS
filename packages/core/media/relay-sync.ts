/**
 * 媒体 → 中转站素材库同步(六八:声线投喂闭环)
 *
 * 背景:本地生成(TTS 声线)/本地处理(规范化)的媒体只有 MinIO storageKey,远端视频
 * provider 拉不到。中转站素材库 createAsset 只收 URL(服务端下载),所以给它 12h 签名 URL,
 * 成功后 meta.relayAssetUrl(asset://)在 relay provider 视频生成时免重传直引。
 *
 * ⚠️ 本地 dev(存储非公网可达)时中转站下载会失败 → 同步开关(voice.sample.syncToRelay)
 * 默认关,部署到公网存储后再开;失败 best-effort 记 meta.relaySyncError,不阻塞主流程。
 */
import { getRelayAssetProvider, getRelayDefaultGroupId } from '@ss/adapters/provider';
import { getStorageAdapter } from '@ss/adapters/storage';
import { sanitizeErrorMsg } from '@ss/shared/errors';

export interface RelaySyncResult {
  relayAssetUrl?: string;
  relayAssetId?: string;
  relaySyncError?: string;
}

/**
 * best-effort 同步一个已落存储的媒体到中转站素材库。
 *
 * - 未配置(无 active relay-* provider / 未填 group_id)→ 返回 null(可选基建,不记噪音);
 *   `reportUnconfigured: true` 时返回 relaySyncError 文案(media.upload 显式勾选场景用)
 * - 配置了但失败 → `{ relaySyncError }`(调用方记入 meta 便于排查)
 * - 成功 → `{ relayAssetUrl, relayAssetId }`(meta 直接 spread)
 */
export async function syncMediaToRelay(args: {
  storageKey: string;
  kind: 'IMAGE' | 'VIDEO' | 'AUDIO';
  filename: string;
  /** PUBLIC scope 的公开 URL(有则优先,免签名) */
  publicUrl?: string | null;
  reportUnconfigured?: boolean;
}): Promise<RelaySyncResult | null> {
  try {
    const [relayProvider, groupId] = await Promise.all([
      getRelayAssetProvider(),
      getRelayDefaultGroupId(),
    ]);
    if (!relayProvider || groupId === null) {
      if (args.reportUnconfigured) {
        return {
          relaySyncError: relayProvider
            ? 'relay.assets.default_group_id 未配置(去 /admin/settings 填)'
            : '无 active 中转站 provider(去 /admin/providers 启用 relay-* 项)',
        };
      }
      return null;
    }
    const fetchUrl =
      args.publicUrl ??
      (await getStorageAdapter().getSignedUrl(args.storageKey, 12 * 3600));
    const assetType =
      args.kind === 'IMAGE' ? 'Image' : args.kind === 'VIDEO' ? 'Video' : 'Audio';
    const created = await relayProvider.createAsset({
      url: fetchUrl,
      assetType,
      groupId,
      name: args.filename.slice(0, 64),
    });
    return { relayAssetUrl: created.assetUrl, relayAssetId: created.id };
  } catch (e) {
    const msg = sanitizeErrorMsg(e);
    console.warn(`[relay-sync] ${args.filename} 同步中转站失败:`, msg);
    return { relaySyncError: msg };
  }
}
