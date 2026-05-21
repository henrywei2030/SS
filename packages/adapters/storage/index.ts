/**
 * StorageAdapter 工厂 — 根据 STORAGE_DRIVER 环境变量切换实现
 */
export * from './types.js';
export { MinioStorageAdapter } from './minio.js';
export { LocalFsStorageAdapter } from './local-fs.js';

import type { StorageAdapter } from './types.js';
import { MinioStorageAdapter } from './minio.js';
import { LocalFsStorageAdapter } from './local-fs.js';

let _instance: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (_instance) return _instance;
  const driver = (process.env.STORAGE_DRIVER ?? 'minio').toLowerCase();

  switch (driver) {
    case 'minio':
    case 'r2':
    case 'oss':
    case 's3': {
      _instance = new MinioStorageAdapter({
        endpoint: required('S3_ENDPOINT'),
        accessKey: required('S3_ACCESS_KEY'),
        secretKey: required('S3_SECRET_KEY'),
        bucket: required('S3_BUCKET'),
        region: process.env.S3_REGION,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      });
      break;
    }
    case 'local-fs': {
      _instance = new LocalFsStorageAdapter({
        rootDir: process.env.STORAGE_LOCAL_DIR ?? '.local/storage',
        publicBaseUrl: process.env.STORAGE_LOCAL_BASE_URL,
      });
      break;
    }
    default:
      throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
  }
  return _instance;
}

/** 测试时重置 */
export function resetStorageAdapter(): void {
  _instance = null;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
