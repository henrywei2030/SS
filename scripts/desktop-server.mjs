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

import { bootstrapDesktop, getDesktopPaths } from './desktop-bootstrap.mjs';
import { spawn } from 'node:child_process';
import { openSync, mkdirSync, writeFileSync, writeSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── 早期日志:必须在 bootstrap 之前就绪(诊断核心)────────────────────────────
// 打包态(main.rs windows_subsystem="windows")无控制台 → stdout/stderr 丢失;旧版 desktop.log
// 直到 bootstrap 返回【之后】才打开,导致 initdb/pg.start 这类最易在全新机崩的阶段报错无迹可寻
// (= "卡初始界面、无任何信息" 的根)。现在:模块加载第一时间算出 logs 目录、开 fd,
// 把全部 console 输出 tee 进 desktop.log;启动失败时把错误写 last-error.txt 供 splash 回显。
const earlyPaths = getDesktopPaths();
mkdirSync(earlyPaths.logs, { recursive: true });
const logPath = join(earlyPaths.logs, 'desktop.log');
const lastErrorPath = join(earlyPaths.logs, 'last-error.txt');
const logFd = openSync(logPath, 'a');
const ts = () => {
  try {
    return new Date().toISOString();
  } catch {
    return '';
  }
};
const logLine = (s) => {
  try {
    writeSync(logFd, `${s}\n`);
  } catch {
    /* ignore */
  }
};
// tee:bootstrap 内所有 console.log/error 既走原 stdout(dev 可见)又落 desktop.log(打包态唯一可查处)。
// orig 也包 try —— 打包态原 stdout 句柄无效,直接调会抛,会连带打断 console.log。
for (const stream of [process.stdout, process.stderr]) {
  const orig = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => {
    try {
      writeSync(logFd, typeof chunk === 'string' ? chunk : chunk.toString());
    } catch {
      /* ignore */
    }
    try {
      return orig(chunk, ...rest);
    } catch {
      return true;
    }
  };
}
logLine(`\n[desktop] ===== 启动 ${ts()} =====`);
logLine(
  `[desktop] packaged=${process.env.SS_DESKTOP_PACKAGED ?? '0'} mode=${process.env.SS_DESKTOP_WEB_MODE ?? 'dev'} port=${process.env.PORT ?? '47900'}`,
);
logLine(`[desktop] node=${process.execPath} cwd=${process.cwd()}`);

async function main() {
  const { env, stop, reportProgress } = await bootstrapDesktop({ logFd });
  console.log('[desktop] bootstrap 完成,启动 web 服务...');
  reportProgress?.(95, '启动应用界面…');

  const mode = process.env.SS_DESKTOP_WEB_MODE ?? 'dev';
  // 打包态由 main.rs 传 PORT=47900(冷门端口,避开常见 dev 端口冲突);dev 模式走 next dev -p 3000(忽略 PORT)
  const port = process.env.PORT ?? '47900';

  const maskedUrl = (env.DATABASE_URL || '(未设)').replace(/:[^:@/]+@/, ':***@');
  logLine(`[desktop] DATABASE_URL=${maskedUrl}`);

  let webChild;
  if (mode === 'standalone') {
    // standalone / 打包态:用同一 node(打包态 = bundled node,process.execPath)跑 Next standalone。
    //   SS_DESKTOP_STANDALONE_DIR 指向 standalone 根(打包后 = 资源里的 web/);默认仓库内产物(dev 测)。
    //   cwd 设为 server.js 所在目录(standalone 按 __dirname 找 .next/static、public)。
    // 六八:桌面构建独立 distDir(.next-desktop) → 仓库内默认产物路径同步
    const standaloneDir =
      process.env.SS_DESKTOP_STANDALONE_DIR || join(rootDir, 'apps/web/.next-desktop/standalone');
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

  // 已越过 bootstrap 崩溃点、web 子进程已拉起 → 清掉上一轮失败留下的 last-error 标记
  try {
    rmSync(lastErrorPath, { force: true });
  } catch {
    /* ignore */
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
  const detail = (e && e.stack) || String(e);
  const msg = `[desktop] 启动失败 ${ts()}:\n${detail}`;
  logLine(msg);
  // last-error.txt:供 main.rs 在超时分支读取并回显到 splash(把"瞎卡"变"自报错")
  try {
    writeFileSync(lastErrorPath, `${msg}\n`, { flag: 'w' });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
