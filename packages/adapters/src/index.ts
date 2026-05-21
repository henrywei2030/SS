/**
 * @ss/adapters — 云端切换命脉
 *
 * 通过环境变量决定使用哪个 driver：
 *   STORAGE_DRIVER       minio | local-fs | r2 | oss | s3
 *   EVENT_BUS_DRIVER     in-process | nats
 *
 * 业务层只面向接口编程，不感知 driver。
 */
export * from './crypto.js';
export * from '../storage/index.js';
export * from '../provider/index.js';
export * from '../eventbus/index.js';
export * from '../auth/index.js';
