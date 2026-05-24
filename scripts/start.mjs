#!/usr/bin/env node
/**
 * StarsAlign Studio · 一键开发环境启动
 *
 * 用法: pnpm start              (默认全流程)
 *       pnpm start --skip-infra   (infra 已起则跳过 docker)
 *       pnpm start --skip-preflight (跳过 Node/pnpm/Docker 自检)
 *       pnpm start --no-open       (不自动打开浏览器)
 *       pnpm start --auto-migrate  (检测到未应用 migration 时自动 deploy)
 *
 * 流程:
 *   1. preflight - Node/pnpm/Docker/.env 自检
 *   2. docker compose up -d - postgres / redis / minio 启动 + 等 healthy
 *   3. Prisma migration status - 检查未应用(默认提示,--auto-migrate 自动跑)
 *   4. turbo dev - web + worker 并行,stdio inherit 用户看实时日志
 *   5. wait :3000 ready - HTTP 探测 web ready
 *   6. open browser - 跨平台自动打开 http://localhost:3000
 *   7. Ctrl+C - 优雅停 turbo dev(docker 保留,用 pnpm infra:down 停)
 *
 * 跨平台:Win / macOS / Linux 都跑(Win 用 start, mac 用 open, linux 用 xdg-open)
 */
import { spawn, execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const SKIP_INFRA = args.has('--skip-infra');
const SKIP_PREFLIGHT = args.has('--skip-preflight');
const NO_OPEN = args.has('--no-open');
const AUTO_MIGRATE = args.has('--auto-migrate');

const WEB_URL = 'http://localhost:3000';
const COMPOSE_FILE = 'infra/docker-compose.yml';
const INFRA_SERVICES = ['ss-postgres', 'ss-redis', 'ss-minio'];
const WEB_READY_TIMEOUT_MS = 90_000; // next dev 首次编译可能慢
const INFRA_HEALTH_TIMEOUT_S = 60;

const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};
const log = {
  step: (m) => console.log(`${c.cyan}▶${c.reset}  ${m}`),
  ok: (m) => console.log(`${c.green}✓${c.reset}  ${m}`),
  warn: (m) => console.log(`${c.yellow}⚠${c.reset}  ${m}`),
  err: (m) => console.log(`${c.red}✗${c.reset}  ${m}`),
  dim: (m) => console.log(`${c.dim}${m}${c.reset}`),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runSync(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: rootDir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

// ----------------------------------------------------------------------------
// Step 1: preflight
// ----------------------------------------------------------------------------
function preflight() {
  log.step('Preflight 自检(Node / pnpm / Docker / .env / git)');
  try {
    execSync(`node ${JSON.stringify(resolve(__dirname, 'preflight.mjs'))}`, {
      cwd: rootDir,
      stdio: 'inherit',
    });
  } catch {
    log.err('Preflight 失败 — 修复后再跑 pnpm start(或加 --skip-preflight 跳过)');
    process.exit(1);
  }
}

// ----------------------------------------------------------------------------
// Step 2: infra up + wait healthy
// ----------------------------------------------------------------------------
async function startInfra() {
  log.step('docker compose up -d(postgres / redis / minio)');
  try {
    execSync(`docker compose -f ${COMPOSE_FILE} up -d`, {
      cwd: rootDir,
      stdio: 'inherit',
    });
  } catch (e) {
    log.err(`docker compose up 失败 — 检查 Docker daemon 跑没,或加 --skip-infra`);
    process.exit(1);
  }

  log.step(`等容器 health check(每个 service 最多 ${INFRA_HEALTH_TIMEOUT_S}s)`);
  for (const svc of INFRA_SERVICES) {
    let healthy = false;
    for (let i = 0; i < INFRA_HEALTH_TIMEOUT_S; i++) {
      try {
        const status = runSync(
          `docker inspect ${svc} --format "{{.State.Health.Status}}"`,
        );
        if (status === 'healthy') {
          healthy = true;
          log.ok(`${svc} healthy`);
          break;
        }
        if (status === 'unhealthy') {
          log.err(`${svc} unhealthy — 跑 pnpm infra:logs 看原因`);
          process.exit(1);
        }
      } catch {
        // 容器还没起来 → 继续等
      }
      await sleep(1000);
    }
    if (!healthy) {
      log.err(`${svc} ${INFRA_HEALTH_TIMEOUT_S}s 后仍未 healthy — 跑 pnpm infra:logs`);
      process.exit(1);
    }
  }
}

// ----------------------------------------------------------------------------
// Step 3: Prisma migration status
// ----------------------------------------------------------------------------
function checkMigrations() {
  log.step('Prisma migration 状态');
  let output;
  try {
    output = runSync('pnpm --filter @ss/db exec prisma migrate status', {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    // prisma migrate status 在有 pending migration 时 exit code != 0,stderr 含 status
    output = ((e.stdout?.toString() || '') + (e.stderr?.toString() || '')).trim();
  }

  const hasPending =
    /have not yet been applied|following migration\(s\) have not been applied/i.test(
      output,
    );

  if (!hasPending) {
    log.ok('migration 全已 apply');
    return;
  }

  if (AUTO_MIGRATE) {
    log.warn('检测到未应用 migration → 自动 deploy(--auto-migrate)');
    try {
      execSync('pnpm db:migrate:deploy', {
        cwd: rootDir,
        stdio: 'inherit',
      });
      log.ok('migration deploy 完成');
    } catch {
      log.err('migration deploy 失败');
      process.exit(1);
    }
  } else {
    log.warn('有未应用 migration — 建议先跑 pnpm db:migrate:deploy(或 --auto-migrate 自动)');
    console.log(`${c.dim}${output.split('\n').slice(0, 8).join('\n')}${c.reset}\n`);
  }
}

// ----------------------------------------------------------------------------
// Step 3.5: 检测 :3000 / :9200 是否已被占用(已有 dev 在跑时 graceful skip)
// ----------------------------------------------------------------------------
async function checkPortFree(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}`, { timeout: 800 }, () => {
      resolve(false); // got response = occupied
    });
    req.on('error', () => resolve(true)); // ECONNREFUSED = free
    req.on('timeout', () => {
      req.destroy();
      resolve(true);
    });
  });
}

// ----------------------------------------------------------------------------
// Step 4: turbo dev (web + worker 并行)
// ----------------------------------------------------------------------------
let devChild = null;
function startDev() {
  log.step('启动 turbo dev(web + worker 并行,stdio inherit)');
  // 注意:Windows 下 spawn pnpm 需 shell:true(.cmd shim);Unix 直接跑
  devChild = spawn('pnpm', ['dev'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  devChild.on('exit', (code, signal) => {
    if (signal) {
      log.dim(`turbo dev 退出 (signal=${signal})`);
    } else if (code !== 0 && code !== null) {
      log.err(`turbo dev 异常退出 (exit=${code})`);
    }
    process.exit(code ?? 0);
  });
  devChild.on('error', (err) => {
    log.err(`turbo dev 启动失败:${err.message}`);
    process.exit(1);
  });
}

// ----------------------------------------------------------------------------
// Step 5: wait :3000 ready
// ----------------------------------------------------------------------------
async function waitWebReady() {
  const deadline = Date.now() + WEB_READY_TIMEOUT_MS;
  let lastErr = '';
  while (Date.now() < deadline) {
    const ok = await new Promise((r) => {
      const req = http.get(WEB_URL, { timeout: 2000 }, (res) => {
        res.resume();
        // 307 redirect to /zh-CN/ / 200 / 任何 < 500 都算 ready
        r(res.statusCode != null && res.statusCode < 500);
      });
      req.on('error', (e) => {
        lastErr = e.code || e.message;
        r(false);
      });
      req.on('timeout', () => {
        req.destroy();
        lastErr = 'timeout';
        r(false);
      });
    });
    if (ok) return true;
    await sleep(1500);
  }
  log.warn(
    `web ${WEB_READY_TIMEOUT_MS / 1000}s 仍未 ready(${lastErr}) — turbo dev 仍跑,可能编译慢/有错`,
  );
  return false;
}

// ----------------------------------------------------------------------------
// Step 6: open browser (跨平台)
// ----------------------------------------------------------------------------
function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      // cmd /c start "" "url" — 第一个空 "" 是 start 命令的 window title
      spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else if (process.platform === 'darwin') {
      execSync(`open ${JSON.stringify(url)}`, { stdio: 'ignore' });
    } else {
      execSync(`xdg-open ${JSON.stringify(url)}`, { stdio: 'ignore' });
    }
    log.ok(`已打开浏览器:${url}`);
  } catch {
    log.warn(`自动打开浏览器失败 — 请手动访问 ${url}`);
  }
}

// ----------------------------------------------------------------------------
// Step 7: Ctrl+C 优雅退出
// ----------------------------------------------------------------------------
function setupShutdown() {
  const shutdown = (signal) => {
    log.dim(`\n收到 ${signal} — 停 turbo dev`);
    if (devChild && devChild.pid && !devChild.killed) {
      try {
        if (process.platform === 'win32') {
          // Windows:taskkill 整个进程树(turbo + next + tsx)
          execSync(`taskkill /pid ${devChild.pid} /T /F`, { stdio: 'ignore' });
        } else {
          devChild.kill('SIGTERM');
        }
      } catch {
        /* ignore */
      }
    }
    log.dim('Docker 容器仍跑 — 停 infra 用 pnpm infra:down');
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ----------------------------------------------------------------------------
// main
// ----------------------------------------------------------------------------
async function main() {
  console.log(`\n${c.bold}${c.cyan}╭─ StarsAlign Studio · 一键开发启动 ─╮${c.reset}\n`);

  if (!SKIP_PREFLIGHT) preflight();
  if (!SKIP_INFRA) await startInfra();
  checkMigrations();

  // 检测端口被占用 — 已有 dev 在跑时 graceful 跳过 startDev,直接等 ready + open browser
  const webFree = await checkPortFree(3000);
  const workerFree = await checkPortFree(9200);
  const skipDev = !webFree || !workerFree;
  if (skipDev) {
    log.warn(
      `端口已被占用(web=${webFree ? 'free' : 'busy'} worker=${workerFree ? 'free' : 'busy'})— 跳过 turbo dev 启动,直接等 web ready + open browser`,
    );
  }

  setupShutdown();
  if (!skipDev) startDev();

  // 等 next dev 起步
  await sleep(skipDev ? 500 : 2500);
  const ready = await waitWebReady();
  if (ready && !NO_OPEN) openBrowser(WEB_URL);

  console.log(
    `\n${c.bold}${c.green}╰─ 全部就绪${skipDev ? '(dev 已在别处跑)' : ' · Ctrl+C 退出 turbo dev'} ─╯${c.reset}\n`,
  );
  console.log(`${c.dim}  · web:    ${WEB_URL}`);
  console.log(`  · admin:  ${WEB_URL}/zh-CN/admin/providers`);
  console.log(`  · bindings: ${WEB_URL}/zh-CN/admin/bindings`);
  console.log(`  · minio:  http://localhost:9001 (ss_minio_user / ss_minio_password)`);
  console.log(`  · worker health: http://localhost:9200/health${c.reset}\n`);

  if (skipDev) {
    // 不接管已在别处跑的 dev,立即退出(浏览器已开)
    process.exit(0);
  }
  // 否则 hang — devChild.on('exit') 触发 process.exit
}

main().catch((err) => {
  log.err(`一键启动失败:${err.message}`);
  process.exit(1);
});
