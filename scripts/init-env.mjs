#!/usr/bin/env node
// 跨平台环境变量初始化脚本(macOS / Linux / Windows 通用)
// 用法: pnpm setup:env  或  node scripts/init-env.mjs
//
// 行为:
//   1. 若 .env.local 不存在,从 .env.example 复制一份
//   2. 检查 JWT_SECRET / APP_MASTER_KEY,若缺失或仍是 placeholder 则用 crypto.randomBytes 生成
//   3. 已是有效 64 字符 hex 的密钥保留不动 (避免覆盖已部署的加密底座)
//   4. 给 apps/web / apps/workers/video-gen 各自建 .env.local symlink → root .env.local
//      (Next.js 和 worker 各自从其 cwd 加载 .env.local,monorepo root 文件它们看不到)
//      Windows 没权限 symlink 时退回 copy(单一真相源在 root,需手动同步复制)
//
// 设计原因: BSD sed (macOS) 与 GNU sed (Linux) 与 Win 默认无 sed 的语法不一致,
//          用 Node 直接读写文件,三平台一致。

import { randomBytes } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  symlinkSync,
  lstatSync,
} from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const envExample = resolve(rootDir, '.env.example');
const envLocal = resolve(rootDir, '.env.local');

if (!existsSync(envExample)) {
  console.error('[init-env] .env.example 不存在,请确认仓库完整');
  process.exit(1);
}

if (!existsSync(envLocal)) {
  copyFileSync(envExample, envLocal);
  console.log('[init-env] 已从 .env.example 复制创建 .env.local');
} else {
  console.log('[init-env] .env.local 已存在,仅补齐缺失密钥');
}

let content = readFileSync(envLocal, 'utf-8');
let mutated = false;

const genKey = () => randomBytes(32).toString('hex');

const ensureKey = (varName) => {
  const re = new RegExp(`^${varName}=(.*)$`, 'm');
  const match = content.match(re);
  if (!match) {
    const eol = content.endsWith('\n') ? '' : '\n';
    content += `${eol}${varName}=${genKey()}\n`;
    console.log(`  + ${varName}: 新增`);
    mutated = true;
    return;
  }
  const value = match[1].trim();
  const isPlaceholder =
    !value ||
    value.startsWith('change-me') ||
    value === '""' ||
    value.length < 32;
  if (isPlaceholder) {
    content = content.replace(re, `${varName}=${genKey()}`);
    console.log(`  ~ ${varName}: 重新生成 (原值为 placeholder)`);
    mutated = true;
  } else {
    console.log(`  = ${varName}: 已配置,保留`);
  }
};

ensureKey('JWT_SECRET');
ensureKey('APP_MASTER_KEY');

if (mutated) {
  writeFileSync(envLocal, content, 'utf-8');
  console.log('[init-env] .env.local 已更新');
} else {
  console.log('[init-env] .env.local 无需变更');
}

// ----------------------------------------------------------------------------
// 子目录 .env.local symlink — Next.js / worker 从其 cwd 加载 .env.local,
// 不会上溯 monorepo root。给每个需要的子项目建相对 symlink。
// ----------------------------------------------------------------------------
const SUBDIR_TARGETS = [
  'apps/web/.env.local',
  'apps/workers/video-gen/.env.local',
];

console.log('\n[init-env] 同步子目录 .env.local(Next.js / worker 各自从 cwd 加载):');
for (const subPath of SUBDIR_TARGETS) {
  const fullPath = resolve(rootDir, subPath);
  // 相对符号链接,迁移仓库根路径时不会断
  const relTarget = relative(dirname(fullPath), envLocal);

  if (existsSync(fullPath)) {
    try {
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        console.log(`  = ${subPath}: 已是 symlink,跳过`);
        continue;
      }
      console.log(`  ! ${subPath}: 已是普通文件,跳过(请手动确认内容与 root 一致)`);
      continue;
    } catch {
      // ignore
    }
  }

  try {
    symlinkSync(relTarget, fullPath);
    console.log(`  + ${subPath} → ${relTarget}`);
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES' || process.platform === 'win32') {
      // Windows 默认无 symlink 权限 → 退回 copy(用户改 root .env.local 后要手动重跑本脚本)
      copyFileSync(envLocal, fullPath);
      console.log(`  + ${subPath} (copied — symlink 不可用,改 root .env.local 后请重跑 pnpm setup:env)`);
    } else {
      throw err;
    }
  }
}

console.log('\n下一步: pnpm preflight  ← 跑一次环境自检');
