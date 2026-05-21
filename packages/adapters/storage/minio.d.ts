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
export declare class MinioStorageAdapter implements StorageAdapter {
    private readonly cfg;
    readonly id: string;
    private readonly s3;
    private readonly bucket;
    private readonly publicBaseUrl;
    constructor(cfg: MinioAdapterConfig);
    putObject(key: string, data: Buffer | Uint8Array | Readable | Blob, opts?: PutOptions): Promise<PutResult>;
    getObject(key: string): Promise<Readable>;
    getObjectBuffer(key: string): Promise<Buffer>;
    getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
    deleteObject(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
    listObjects(prefix: string): AsyncIterable<ObjectInfo>;
    copyObject(sourceKey: string, destKey: string): Promise<void>;
}
//# sourceMappingURL=minio.d.ts.map