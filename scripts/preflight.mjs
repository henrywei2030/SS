#!/usr/bin/env node
// 跨平台开工自检 — 新设备首次拉起 / 每日开工前快速跑一遍
// 用法: pnpm preflight
//
// 检查项: Node / pnpm / Docker / .env.local / git 同步状态 / pnpm 依赖是否装过

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const checks = [];

const run = (cmd, opts = {}) =>
  execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();

const check = (label, fn) => {
  try {
    const detail = fn() || 'ok';
    checks.push({ label, status: 'ok', detail });
  } catch (err) {
    const msg = (err.stderr?.toString() || err.message || '').split('\n')[0].slice(0, 120);
    checks.push({ label, status: 'fail', detail: msg });
  }
};

const checkWarn = (label, fn) => {
  try {
    const detail = fn() || 'ok';
    checks.push({ label, status: 'ok', detail });
  } catch (err) {
    const msg = (err.stderr?.toString() || err.message || '').split('\n')[0].slice(0, 120);
    checks.push({ label, status: 'warn', detail: msg });
  }
};

check('Node ≥ 20.18', () => {
  const v = process.versions.node;
  const [major, minor] = v.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 18))
    throw new Error(`v${v} < 20.18 — 请升级 Node`);
  return `v${v}`;
});

check('pnpm ≥ 9', () => {
  const out = run('pnpm -v');
  const major = Number(out.split('.')[0]);
  if (major < 9) throw new Error(`v${out} < 9 — 请跑 corepack enable`);
  return `v${out}`;
});

check('Docker 可达', () => {
  execSync('docker info', { stdio: 'ignore' });
  return 'daemon running';
});

check('.env.local 存在', () => {
  if (!existsSync(resolve(rootDir, '.env.local')))
    throw new Error('缺失 — 请跑 pnpm setup:env');
  return 'present';
});

// Next.js / worker 各自从 cwd 加载 .env.local,monorepo root 文件它们看不到
// init-env.mjs 已自动建 symlink,这里检查防漏建
check('apps/web/.env.local', () => {
  if (!existsSync(resolve(rootDir, 'apps/web/.env.local')))
    throw new Error('缺失 — 请跑 pnpm setup:env 自动建 symlink → root .env.local');
  return 'symlink ok';
});

check('apps/workers/video-gen/.env.local', () => {
  if (!existsSync(resolve(rootDir, 'apps/workers/video-gen/.env.local')))
    throw new Error('缺失 — 请跑 pnpm setup:env 自动建 symlink → root .env.local');
  return 'symlink ok';
});

check('Prisma client 已生成', () => {
  if (!existsSync(resolve(rootDir, 'packages/db/src/generated/prisma/client.ts')))
    throw new Error('缺失 — 请跑 pnpm db:generate(7 升级后 generated 在 src/generated/,不入 git)');
  return 'generated';
});

check('node_modules 已装', () => {
  if (!existsSync(resolve(rootDir, 'node_modules')))
    throw new Error('缺失 — 请跑 pnpm install');
  return 'present';
});

checkWarn('git 工作区状态', () => {
  const out = run('git status --porcelain', { cwd: rootDir });
  if (out) {
    const lines = out.split('\n').length;
    throw new Error(`有 ${lines} 个未提交变更`);
  }
  return 'clean';
});

checkWarn('git 远程同步', () => {
  try {
    run('git fetch --quiet', { cwd: rootDir });
  } catch {
    throw new Error('无法 fetch 远程 (检查网络/凭证)');
  }
  const local = run('git rev-parse @', { cwd: rootDir });
  let remote;
  try {
    remote = run('git rev-parse @{u}', { cwd: rootDir });
  } catch {
    throw new Error('未设置 upstream');
  }
  if (local === remote) return 'in sync';
  const base = run('git merge-base @ @{u}', { cwd: rootDir });
  if (local === base) throw new Error('本地落后 — 请跑 git pull');
  if (remote === base) throw new Error('本地领先 — 未 push');
  throw new Error('分叉 — 需手动处理');
});

console.log('\nPreflight Check\n');
const w = 22;
for (const c of checks) {
  const icon = c.status === 'ok' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
  console.log(`${icon}  ${c.label.padEnd(w)} ${c.detail}`);
}

const failed = checks.filter((c) => c.status === 'fail').length;
const warned = checks.filter((c) => c.status === 'warn').length;
console.log(
  `\n${failed === 0 ? (warned === 0 ? 'All green' : `Ready (${warned} warning)`) : `${failed} check failed`}\n`
);
process.exit(failed === 0 ? 0 : 1);
