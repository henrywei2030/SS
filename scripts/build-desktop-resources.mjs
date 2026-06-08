#!/usr/bin/env node
// =============================================================================
// Step D · 打包 DB 资源 —— 产到 apps/desktop/resources/db/(供打包态桌面程序用)
//   seed.mjs     esbuild 自包含 bundle(复用 seed.ts,打包后无 tsx 也能 node 直跑)
//   migrations/  prisma migration SQL(自包含 migration runner 读它建表)
// 这些会被 tauri.conf.json 的 bundle.resources 打进安装包;桌面态 desktop-bootstrap.mjs
//   通过 SS_DESKTOP_MIGRATIONS_DIR / SS_DESKTOP_SEED_JS 指到解包后的资源路径。
// =============================================================================
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbSrc = join(root, 'packages/db/prisma');
const dbOut = join(root, 'apps/desktop/src-tauri/resources/db');

rmSync(dbOut, { recursive: true, force: true });
mkdirSync(dbOut, { recursive: true });

// 1) seed 自包含 bundle(ESM:生成的 prisma client 用 import.meta.url;
//    banner 注入 createRequire 让 CJS 依赖(dotenv 等)的 require 可用;
//    external 掉可选原生 / 平台特例)
await build({
  entryPoints: [join(dbSrc, 'seed.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: join(dbOut, 'seed.mjs'),
  external: ['pg-native', 'cloudflare:sockets'],
  banner: {
    js: "import { createRequire as __ssCreateRequire } from 'module'; const require = __ssCreateRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
console.log('✓ seed.mjs(自包含)');

// 2) migrations(SQL)
cpSync(join(dbSrc, 'migrations'), join(dbOut, 'migrations'), { recursive: true });
console.log('✓ migrations/');

console.log('DB 资源 →', dbOut);
