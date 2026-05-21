import type { Readable } from 'node:stream';
import type { StorageAdapter, PutOptions, PutResult, ObjectInfo } from './types.js';
export interface LocalFsConfig {
    /** 数据根目录，如 ./.local/storage */
    rootDir: string;
    /** 公网可访问的 base URL（用于 dev server 直接 serve） */
    publicBaseUrl?: string;
}
export declare class LocalFsStorageAdapter implements StorageAdapter {
    private readonly cfg;
    readonly id: string;
    constructor(cfg: LocalFsConfig);
    private resolve;
    putObject(key: string, data: Buffer | Uint8Array | Readable | Blob, opts?: PutOptions): Promise<PutResult>;
    getObject(key: string): Promise<Readable>;
    getObjectBuffer(key: string): Promise<Buffer>;
    getSignedUrl(key: string): Promise<string>;
    deleteObject(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
    listObjects(prefix: string): AsyncIterable<ObjectInfo>;
    copyObject(sourceKey: string, destKey: string): Promise<void>;
}
//# sourceMappingURL=local-fs.d.ts.map