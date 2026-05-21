/**
 * MinIO / S3 兼容 StorageAdapter
 * Phase 1: 默认使用 MinIO（本地 docker-compose 起）
 * Phase 2: 同一实现可对接 Cloudflare R2 / 阿里 OSS / AWS S3，仅换环境变量
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, CopyObjectCommand, } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
export class MinioStorageAdapter {
    cfg;
    id;
    s3;
    bucket;
    publicBaseUrl;
    constructor(cfg) {
        this.cfg = cfg;
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
    async putObject(key, data, opts = {}) {
        const body = data instanceof Blob
            ? Buffer.from(await data.arrayBuffer())
            : data;
        await this.s3.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentType: opts.contentType,
            CacheControl: opts.cacheControl,
            Metadata: opts.metadata,
            ACL: opts.acl === 'public-read' ? 'public-read' : undefined,
        }));
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
    async getObject(key) {
        const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        if (!res.Body)
            throw new Error(`Empty body for ${key}`);
        return res.Body;
    }
    async getObjectBuffer(key) {
        const stream = await this.getObject(key);
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
    }
    async getSignedUrl(key, expiresInSeconds = 3600) {
        return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSeconds });
    }
    async deleteObject(key) {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }
    async exists(key) {
        try {
            await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
            return true;
        }
        catch (e) {
            if (typeof e === 'object' &&
                e !== null &&
                '$metadata' in e &&
                e.$metadata?.httpStatusCode === 404) {
                return false;
            }
            throw e;
        }
    }
    async *listObjects(prefix) {
        let continuationToken;
        do {
            const res = await this.s3.send(new ListObjectsV2Command({
                Bucket: this.bucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
            }));
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
    async copyObject(sourceKey, destKey) {
        await this.s3.send(new CopyObjectCommand({
            Bucket: this.bucket,
            Key: destKey,
            CopySource: `${this.bucket}/${sourceKey}`,
        }));
    }
}
//# sourceMappingURL=minio.js.map