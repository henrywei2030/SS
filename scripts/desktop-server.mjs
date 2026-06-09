#!/usr/bin/env node
// =============================================================================
// 桌面端启动器 —— Tauri sidecar 入口(Step C/D 将由 Tauri 壳拉起本脚本)
// =============================================================================
// 流程:
//   1. bootstrapDesktop():起内嵌 pg + migrate + 种子,拿到「桌面档」env
//   2. 用该 env 拉起 web 服务(继承 DATABASE_URL + 4 驱动开关 → 进程内 worker 自动注册)
//   3. 转发 SIGINT / SIGTERM:先优雅停 web,再停内嵌 pg
//
// web 启动模式(SS_DESKTOP_WEB_MODE):
//   dev(默认)   pnpm --filter @ss/web dev —— 本机开发/Step B 集成验证用
//   standalone   Next standalone server.js —— 打包后(Step D)用
// =============================================================================

import { bootstrapDesktop } from './desktop-bootstrap.mjs';
import { spawn } from 'node:child_process';
import { openSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const { env, stop, paths } = await bootstrapDesktop();
  console.log('[desktop] bootstrap 完成,启动 web 服务...');

  const mode = process.env.SS_DESKTOP_WEB_MODE ?? 'dev';
  // 打包态由 main.rs 传 PORT=47900(冷门端口,避开常见 dev 端口冲突);dev 模式走 next dev -p 3000(忽略 PORT)
  const port = process.env.PORT ?? '47900';

  // 文件日志:.app GUI 启动会 detach、stdout 丢失 → 把关键信息 + web 服务输出写进数据目录,便于诊断。
  mkdirSync(paths.logs, { recursive: true });
  const logPath = join(paths.logs, 'desktop.log');
  const maskedUrl = (env.DATABASE_URL || '(未设)').replace(/:[^:@/]+@/, ':***@');
  writeFileSync(
    logPath,
    `[desktop] ${new Date().toISOString?.() ?? ''} mode=${mode} port=${port}\n[desktop] DATABASE_URL=${maskedUrl}\n`,
    { flag: 'a' },
  );
  const logFd = openSync(logPath, 'a');

  let webChild;
  if (mode === 'standalone') {
    // standalone / 打包态:用同一 node(打包态 = bundled node,process.execPath)跑 Next standalone。
    //   SS_DESKTOP_STANDALONE_DIR 指向 standalone 根(打包后 = 资源里的 web/);默认仓库内产物(dev 测)。
    //   cwd 设为 server.js 所在目录(standalone 按 __dirname 找 .next/static、public)。
    const standaloneDir =
      process.env.SS_DESKTOP_STANDALONE_DIR || join(rootDir, 'apps/web/.next/standalone');
    const serverDir = join(standaloneDir, 'apps/web');
    // HOSTNAME 与「webview/代理使用的主机名」必须一致,否则 next-intl 的 rewrite 被 Next 判为
    //   跨源 → 自代理到 localhost:PORT,若 server 绑在别的回环地址(127.0.0.1 vs ::1)→ ECONNREFUSED。
    //   默认 localhost(与 webview 加载的 http://localhost 对齐);可用 SS_DESKTOP_WEB_HOST 覆盖。
    const host = process.env.SS_DESKTOP_WEB_HOST ?? 'localhost';
    console.log(`[desktop] standalone 服务 ← ${serverDir}/server.js(host ${host}:${port})`);
    webChild = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: { ...env, PORT: port, HOSTNAME: host },
      stdio: ['ignore', logFd, logFd], // 输出写进 desktop.log(survive .app detach,便于诊断)
    });
  } else {
    webChild = spawn('pnpm', ['--filter', '@ss/web', 'dev'], {
      cwd: rootDir,
      env: { ...env, PORT: port },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  }

  let shuttingDown = false;
  const shutdown = async (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[desktop] 收到 ${sig},优雅退出...`);
    try {
      webChild.kill('SIGTERM');
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 1500));
    await stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  webChild.on('exit', (code) => {
    if (!shuttingDown) void shutdown(`web 进程退出(${code})`);
  });
}

main().catch((e) => {
  console.error('[desktop] 启动失败:', e);
  process.exit(1);
});
