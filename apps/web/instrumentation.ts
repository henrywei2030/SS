/**
 * Next.js 启动钩子。
 *
 * 桌面化:Node-only 逻辑(进程内 worker 注册 + recover,会引入 pg/ioredis/bullmq)放
 *   ./lib/in-process-worker,**仅在 nodejs runtime 动态 import**。Next 编译 edge bundle 时按
 *   `NEXT_RUNTIME` 编译期常量把这个 import 整段 DCE 掉,避免把 pg 等拉进 edge(否则 fs/pg-native
 *   在 edge bundle 解析失败 → 500)。默认档(bullmq)里 startInProcessVideoWorker 自己 no-op。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startInProcessVideoWorker } = await import('./lib/in-process-worker');
    await startInProcessVideoWorker();
  }
}
