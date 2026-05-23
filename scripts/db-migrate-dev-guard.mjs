#!/usr/bin/env node
/**
 * db:migrate (dev) 守卫脚本 — 第 13 轮 audit
 *
 * `prisma migrate dev` 在生产环境跑会触发自动 reset(检测 schema drift 时
 * 默认重建 DB,生产 = 灾难)。本脚本在调 migrate dev 前检查 NODE_ENV / DATABASE_URL。
 *
 * 生产侧应该跑 `db:migrate:deploy`(只应用已有 migration,不 reset),
 * 已直接暴露在 package.json 的 db:migrate:deploy 命令。
 *
 * 跨平台 ESM。
 */
import { spawnSync } from 'node:child_process';

const env = process.env.NODE_ENV ?? 'development';
const dbUrl = process.env.DATABASE_URL ?? '';

const isProd = env === 'production';
const dbLooksProd = /prod(uction)?/i.test(dbUrl);
const dbNotLocal = dbUrl && !/(localhost|127\.0\.0\.1|::1)/i.test(dbUrl);

if (isProd || dbLooksProd || dbNotLocal) {
  console.error('');
  console.error('❌ REFUSED: db:migrate (prisma migrate dev) 在疑似生产环境拒绝执行');
  console.error('');
  console.error(`   NODE_ENV       = ${env}`);
  console.error(`   DATABASE_URL   = ${dbUrl ? '[set, ' + (dbLooksProd ? 'looks prod' : dbNotLocal ? 'not local' : '?') + ']' : '[unset]'}`);
  console.error('');
  console.error('   生产环境应使用 db:migrate:deploy(只应用既有 migration,不 reset)');
  console.error('   dev 环境请确认 NODE_ENV=development 且 DATABASE_URL 指向 localhost。');
  console.error('');
  process.exit(1);
}

console.log('✓ NODE_ENV 守卫通过,进入 prisma migrate dev');

const result = spawnSync('pnpm', ['--filter', '@ss/db', 'exec', 'prisma', 'migrate', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
