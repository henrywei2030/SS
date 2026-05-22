#!/usr/bin/env node
// 跨平台环境变量初始化脚本(macOS / Linux / Windows 通用)
// 用法: pnpm setup:env  或  node scripts/init-env.mjs
//
// 行为:
//   1. 若 .env.local 不存在,从 .env.example 复制一份
//   2. 检查 JWT_SECRET / APP_MASTER_KEY,若缺失或仍是 placeholder 则用 crypto.randomBytes 生成
//   3. 已是有效 64 字符 hex 的密钥保留不动 (避免覆盖已部署的加密底座)
//
// 设计原因: BSD sed (macOS) 与 GNU sed (Linux) 与 Win 默认无 sed 的语法不一致,
//          用 Node 直接读写文件,三平台一致。

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
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

console.log('\n下一步: pnpm preflight  ← 跑一次环境自检');
