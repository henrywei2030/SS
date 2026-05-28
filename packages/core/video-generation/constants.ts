/**
 * Stale RUNNING attempt timeouts for video generation.
 *
 * 三十五收工 R2 Phase A:
 *   原本两套 stale 常量分散在 worker boot 和 router 中,语义不同但容易混。
 *   抽到 core/video-generation 统一管理,加注释说明 scope 差异。
 *
 * Router scope (同 group 短窗口 10min):
 *   - 用户点"生成视频"前 inflight check 用
 *   - 同 group 内 RUNNING/QUEUED > 10min 视为 stale,事务内自愈
 *   - 短窗口防"用户点了 9 分钟前还没回来"误判
 *
 * Worker boot scope (全库长窗口 30min):
 *   - worker 进程启动时扫全部 RUNNING video attempt
 *   - 30min 是"绝对孤儿"阈值 — Seedance 单次抽卡含 6 次重试 + exponential backoff,
 *     极端最长约 10+ 分钟;30min 防多 worker 启动竞态误杀正在跑的真长 job
 *   - BullMQ 自身 lockDuration 5min 内会续锁,正常 job 不会触发 stale
 */
export const STALE_TIMEOUT_GROUP_MS = 10 * 60 * 1000; // 10 min — router inflight check
export const STALE_TIMEOUT_WORKER_BOOT_MS = 30 * 60 * 1000; // 30 min — worker boot global sweep
