/**
 * StorageAdapter — 对象存储抽象
 *
 * Phase 1: LocalFs / MinIO
 * Phase 2: R2 / OSS / S3
 *
 * 业务代码只用此接口；切换 driver 时只换实现，业务代码 0 改动。
 */
import type { Readable } from 'node:stream';

export interface PutOptions {
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
  /** ACL: public-read (生成 CDN URL) | private (默认) */
  acl?: 'public-read' | 'private';
}

export interface ObjectInfo {
  key: string;
  size: number;
  lastModified: Date;
  etag?: string;
}

export interface PutResult {
  key: string;
  /**
   * 直接可访问的 URL（public-read 时为 CDN URL；private 时为 storage URL，访问需签名）
   * 业务代码应当避免直接持久化此字段，应使用 storageKey 通过 getSignedUrl 动态获取。
   */
  url: string;
  sizeBytes: number;
  etag?: string;
}

export interface StorageAdapter {
  readonly id: string;

  /** 上传对象 */
  putObject(
    key: string,
    data: Buffer | Uint8Array | Readable | Blob,
    opts?: PutOptions,
  ): Promise<PutResult>;

  /** 读取对象（流） */
  getObject(key: string): Promise<Readable>;

  /** 读取对象（Buffer，小文件） */
  getObjectBuffer(key: string): Promise<Buffer>;

  /** 生成临时签名 URL */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;

  /** 删除对象 */
  deleteObject(key: string): Promise<void>;

  /** 检查存在 */
  exists(key: string): Promise<boolean>;

  /** 列出前缀下所有对象 */
  listObjects(prefix: string): AsyncIterable<ObjectInfo>;

  /** 复制对象 */
  copyObject(sourceKey: string, destKey: string): Promise<void>;
}

/**
 * 标准化 storageKey 生成。所有业务代码使用此函数，不要手拼。
 *
 * 形式: {scope}/{projectId|public}/{kind}/{yyyymmdd}/{uuid}.{ext}
 *
 * 示例: project/clx123abc/video/20260521/9f8e7d.mp4
 */
export function buildStorageKey(args: {
  scope: 'project' | 'public' | 'personal' | 'temp';
  projectId?: string;
  kind: 'image' | 'video' | 'audio' | 'doc' | 'other';
  ext: string;
  id?: string;
}): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const id = args.id ?? randomId();
  const owner = args.scope === 'project' && args.projectId ? args.projectId : args.scope;
  const safeExt = args.ext.replace(/^\./, '');
  return `${args.scope}/${owner}/${args.kind}/${today}/${id}.${safeExt}`;
}

function randomId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36).slice(-4);
}
