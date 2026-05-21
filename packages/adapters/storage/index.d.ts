/**
 * StorageAdapter 工厂 — 根据 STORAGE_DRIVER 环境变量切换实现
 */
export * from './types.js';
export { MinioStorageAdapter } from './minio.js';
export { LocalFsStorageAdapter } from './local-fs.js';
import type { StorageAdapter } from './types.js';
export declare function getStorageAdapter(): StorageAdapter;
/** 测试时重置 */
export declare function resetStorageAdapter(): void;
//# sourceMappingURL=index.d.ts.map