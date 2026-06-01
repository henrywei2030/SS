/**
 * MinIO / S3 兼容 StorageAdapter
 * Phase 1: 默认使用 MinIO（本地 docker-compose 起）
 * Phase 2: 同一实现可对接 Cloudflare R2 / 阿里 OSS / AWS S3，仅换环境变量
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

import type { StorageAdapter, PutOptions, PutResult, ObjectInfo } from './types.js';

export interface MinioAdapterConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region?: string;
  forcePathStyle?: boolean;
  /** 公网可访问的 base URL（用于 public-read 对象 URL；为空则使用 endpoint） */
  publicBaseUrl?: string;
}

export class MinioStorageAdapter implements StorageAdapter {
  readonly id: string;
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(cfg: MinioAdapterConfig) {
    this.id = `minio:${cfg.bucket}`;
    this.bucket = cfg.bucket;
    this.publicBaseUrl = cfg.publicBaseUrl ?? `${cfg.endpoint}/${cfg.bucket}`;
    this.s3 = new S3Client({
      endpoint: cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
      region: cfg.region ?? 'us-east-1',
      forcePathStyle: cfg.forcePathStyle ?? true,
    });
  }

  async putObject(
    key: string,
    data: Buffer | Uint8Array | Readable | Blob,
    opts: PutOptions = {},
  ): Promise<PutResult> {
    const body =
      data instanceof Blob
        ? Buffer.from(await data.arrayBuffer())
        : (data as Buffer | Uint8Array | Readable);

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        CacheControl: opts.cacheControl,
        Metadata: opts.metadata,
        ACL: opts.acl === 'public-read' ? 'public-read' : undefined,
      }),
    );

    const url = opts.acl === 'public-read'
      ? `${this.publicBaseUrl}/${key}`
      : await this.getSignedUrl(key);

    const size = body instanceof Buffer
      ? body.length
      : body instanceof Uint8Array
        ? body.byteLength
        : 0;

    return { key, url, sizeBytes: size };
  }

  async getObject(key: string): Promise<Readable> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`Empty body for ${key}`);
    return res.Body as Readable;
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const stream = await this.getObject(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (e: unknown) {
      if (
        typeof e === 'object' &&
        e !== null &&
        '$metadata' in e &&
        (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw e;
    }
  }

  async *listObjects(prefix: string): AsyncIterable<ObjectInfo> {
    let continuationToken: string | undefined;
    do {
      const res = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) {
          yield {
            key: obj.Key,
            size: obj.Size ?? 0,
            lastModified: obj.LastModified ?? new Date(0),
            etag: obj.ETag,
          };
        }
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  async copyObject(sourceKey: string, destKey: string): Promise<void> {
    // W1-W7 audit:CopySource 必须 URL 编码(AWS SDK v3 不自动编码),
    // sourceKey 含空格/中文/`+` 等字符时会让 S3 解析错。保留 `/` 作为目录分隔符。
    const encodedSource = sourceKey
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: destKey,
        CopySource: `${this.bucket}/${encodedSource}`,
      }),
    );
  }
}
