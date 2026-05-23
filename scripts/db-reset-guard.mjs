#!/usr/bin/env node
/**
 * db:reset 守卫脚本 — 7 轮 audit A7
 *
 * `prisma migrate reset --force` 会清空整个 DB 后重建,生产跑 = 灾难。
 * 本脚本在调 prisma reset 前检查 NODE_ENV / DATABASE_URL,生产环境立即报错退出。
 *
 * 触发条件(任一为真即拒):
 *   - NODE_ENV === 'production'
 *   - DATABASE_URL 含 'prod' / 'production' 子串
 *   - DATABASE_URL 指向非 localhost(假定生产 DB 不会用 localhost)
 *
 * 跨平台:用 Node ESM,不依赖 shell。
 */
import { spawnSync } from 'node:child_process';

const env = process.env.NODE_ENV ?? 'development';
const dbUrl = process.env.DATABASE_URL ?? '';

const isProd = env === 'production';
const dbLooksProd = /prod(uction)?/i.test(dbUrl);
const dbNotLocal = dbUrl && !/(localhost|127\.0\.0\.1|::1)/i.test(dbUrl);

if (isProd || dbLooksProd || dbNotLocal) {
  console.error('');
  console.error('❌ REFUSED: db:reset 在疑似生产环境拒绝执行');
  console.error('');
  console.error(`   NODE_ENV       = ${env}`);
  console.error(`   DATABASE_URL   = ${dbUrl ? '[set, ' + (dbLooksProd ? 'looks prod' : dbNotLocal ? 'not local' : '?') + ']' : '[unset]'}`);
  console.error('');
  console.error('   db:reset 会清空整个 DB 后重建,只在 dev 环境跑。');
  console.error('   如确实需要,显式设 NODE_ENV=development 并用 localhost DATABASE_URL 再试。');
  console.error('');
  process.exit(1);
}

console.log('✓ NODE_ENV 守卫通过,进入 prisma migrate reset --force');

const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'reset', '--force'], {
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
