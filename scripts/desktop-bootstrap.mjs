#!/usr/bin/env node
// =============================================================================
// 桌面化 Phase 2 · Step B —— 内嵌 postgres + 首跑 bootstrap
// =============================================================================
// 全程用 Node(跨 macOS / Windows / Linux 一致),职责:
//   1. 解析 app 数据目录(各平台标准位置;可用 SS_DESKTOP_DATA_DIR 覆盖,便于测试)
//   2. load-or-create 持久化密钥(JWT_SECRET / APP_MASTER_KEY / SSE_TOKEN_SECRET / pg 密码)
//      ⚠️ APP_MASTER_KEY 一旦生成绝不更换 —— 它加密 DB 里的 Provider API Key,换了就解不开
//   3. 用 embedded-postgres(pg16,匹配 docker)起内嵌实例(首跑 initdb)+ 建库(幂等)
//   4. 装配「桌面档」env:embedded DATABASE_URL + Phase 1 的 4 个驱动开关 + local-fs 存储目录 + 密钥
//   5. 复用现有命令做 migrate deploy + 种子(首跑 db:seed 全量 / 后续 db:sync 增量)
//      —— 注入的 process.env 压过 packages/db/.env(dotenv/prisma 都不覆盖已设的 env)
//   6. 收尾:node-postgres 直连内嵌实例核对迁移/表数(与 prisma 注入路径不同源 → 真证明落在 embedded)
//
// 决策见 ADR-35:嵌入式 postgres(零侵入),现有 schema/计费/锁/裸 SQL 一行不改。
//
// 导出 bootstrapDesktop() 供 desktop-server.mjs(Tauri sidecar 入口)调用。
// CLI:
//   node scripts/desktop-bootstrap.mjs          bootstrap 后保持 pg 存活到 Ctrl+C
//   node scripts/desktop-bootstrap.mjs --once    bootstrap 后停 pg 退出(纯验证用)
// =============================================================================

import EmbeddedPostgresPkg from 'embedded-postgres';
import pgPkg from 'pg';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// CJS/ESM 互操作兜底(embedded-postgres 默认导出 / pg 命名导出)
const EmbeddedPostgres = EmbeddedPostgresPkg.default ?? EmbeddedPostgresPkg;
const { Client } = pgPkg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// ---- 常量(可被 env 覆盖,便于多实例 / 测试)----
const PG_PORT = Number(process.env.SS_DESKTOP_PG_PORT ?? 54329); // 避开 docker 5432
const PG_USER = process.env.SS_DESKTOP_PG_USER ?? 'ss_desktop';
const PG_DB = process.env.SS_DESKTOP_PG_DB ?? 'starsalign';

// =============================================================================
// 1. app 数据目录(各平台标准位置)
// =============================================================================
export function getDesktopPaths() {
  const override = process.env.SS_DESKTOP_DATA_DIR;
  const appName = 'StarsAlign Studio';
  let base;
  if (override) {
    base = resolve(override);
  } else if (platform() === 'win32') {
    base = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), appName);
  } else if (platform() === 'darwin') {
    base = join(homedir(), 'Library', 'Application Support', appName);
  } else {
    base = join(
      process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
      'starsalign-studio',
    );
  }
  return {
    base,
    pgData: join(base, 'pgdata'),
    storage: join(base, 'storage'),
    logs: join(base, 'logs'),
    secrets: join(base, 'secrets.env'),
  };
}

function ensureDirs(paths) {
  // pgData 不预建 —— initdb 要求目标目录不存在或为空,交给 initialise() 处理。
  for (const d of [paths.base, paths.storage, paths.logs]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

// =============================================================================
// 2. 持久化密钥 load-or-create
// =============================================================================
const genKey = () => randomBytes(32).toString('hex');

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function serializeEnvFile(obj) {
  return (
    Object.entries(obj)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n'
  );
}

export function loadOrCreateSecrets(paths) {
  let secrets = {};
  if (existsSync(paths.secrets)) {
    secrets = parseEnvFile(readFileSync(paths.secrets, 'utf-8'));
  }
  let mutated = false;
  const ensure = (k) => {
    const v = secrets[k];
    if (!v || v.length < 32) {
      secrets[k] = genKey();
      mutated = true;
    }
  };
  ensure('JWT_SECRET');
  ensure('APP_MASTER_KEY'); // ⚠️ 生成后绝不更换
  ensure('SSE_TOKEN_SECRET');
  if (!secrets.SS_DESKTOP_PG_PASSWORD) {
    // 内嵌 pg 只监听本机回环,密码主要为满足 scram 认证;持久化以便重连
    secrets.SS_DESKTOP_PG_PASSWORD = genKey();
    mutated = true;
  }
  if (mutated) writeFileSync(paths.secrets, serializeEnvFile(secrets), { mode: 0o600 });
  return secrets;
}

// =============================================================================
// 复用现有 pnpm 命令(注入桌面 env)
// =============================================================================
function run(cmd, args, env, cwd = rootDir) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32', // Windows 下 pnpm 是 .cmd,需 shell
    });
    child.on('exit', (code) =>
      code === 0 ? res() : rej(new Error(`\`${cmd} ${args.join(' ')}\` 退出码 ${code}`)),
    );
    child.on('error', rej);
  });
}

// =============================================================================
// 自包含 migration runner(打包态无 prisma CLI):顺序应用 migrations/*/migration.sql,
//   写 prisma 兼容的 _prisma_migrations(checksum = sha256(sql)),逐条事务、幂等。
//   dev 态仍走 `pnpm migrate:deploy`(prisma 官方),二者产出的 _prisma_migrations 等价。
// =============================================================================
async function applyMigrations(databaseUrl, migrationsDir) {
  if (!existsSync(migrationsDir)) {
    throw new Error(`[desktop] migrations 目录不存在:${migrationsDir}`);
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        id varchar(36) PRIMARY KEY,
        checksum varchar(64) NOT NULL,
        finished_at timestamptz,
        migration_name varchar(255) NOT NULL,
        logs text,
        rolled_back_at timestamptz,
        started_at timestamptz NOT NULL DEFAULT now(),
        applied_steps_count integer NOT NULL DEFAULT 0
      )`);
    const done = new Set(
      (
        await client.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')
      ).rows.map((r) => r.migration_name),
    );
    // prisma 迁移目录名前缀为时间戳 → 字典序即时间序
    const dirs = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    let applied = 0;
    for (const name of dirs) {
      if (done.has(name)) continue;
      const sqlPath = join(migrationsDir, name, 'migration.sql');
      if (!existsSync(sqlPath)) continue;
      const sql = readFileSync(sqlPath, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      await client.query('BEGIN');
      try {
        await client.query(sql); // node-postgres 简单查询支持多语句(prisma migration 是事务安全的)
        await client.query(
          `INSERT INTO "_prisma_migrations"(id, checksum, migration_name, started_at, finished_at, applied_steps_count)
           VALUES ($1, $2, $3, now(), now(), 1)`,
          [randomUUID(), checksum, name],
        );
        await client.query('COMMIT');
        applied++;
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${name} 应用失败:${e.message}`);
      }
    }
    return { total: dirs.length, applied };
  } finally {
    await client.end();
  }
}

// =============================================================================
// 建库(幂等)—— 自己「先查存在性、缺了才建」,连接全程掌控、必关。
//   不用 embedded-postgres 的 createDatabase:它在「库已存在」抛错路径上不关内部连接,
//   悬空连接会在 pg.stop() 时被终止(57P01),打出唬人 stack。
// =============================================================================
async function ensureDatabase(password) {
  const admin = new Client({
    host: 'localhost',
    port: PG_PORT,
    user: PG_USER,
    password,
    database: 'postgres', // initdb 默认建的维护库
  });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [PG_DB]);
    if (rowCount === 0) {
      // 标识符不能参数化;PG_DB 来自受控常量/env,用双引号包裹防注入
      await admin.query(`CREATE DATABASE "${PG_DB}"`);
      console.log(`[desktop] 已建库 ${PG_DB}`);
    } else {
      console.log(`[desktop] 库 ${PG_DB} 已存在,跳过`);
    }
  } finally {
    await admin.end();
  }
}

// =============================================================================
// 收尾核对:直连内嵌实例(与 prisma 注入路径不同源 → 真证明数据落在 embedded)
// =============================================================================
async function verifyEmbedded(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const mig = await client.query('SELECT count(*)::int AS n FROM _prisma_migrations');
    const tbl = await client.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
    );
    // 表名经 @@map 映射为 snake_case 复数(User → users),核对种子数据已落库
    const usr = await client.query('SELECT count(*)::int AS n FROM users');
    return {
      migrations: mig.rows[0].n,
      tables: tbl.rows[0].n,
      users: usr.rows[0].n,
    };
  } finally {
    await client.end();
  }
}

// =============================================================================
// 主流程
// =============================================================================
export async function bootstrapDesktop() {
  const paths = getDesktopPaths();
  ensureDirs(paths);
  const secrets = loadOrCreateSecrets(paths);

  const freshInstall = !existsSync(join(paths.pgData, 'PG_VERSION'));
  console.log(`[desktop] 数据目录: ${paths.base}`);
  console.log(
    `[desktop] 内嵌 postgres: ${freshInstall ? '首次安装(将 initdb)' : '已存在,复用'} · 端口 ${PG_PORT}`,
  );

  const pg = new EmbeddedPostgres({
    databaseDir: paths.pgData,
    user: PG_USER,
    password: secrets.SS_DESKTOP_PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
    authMethod: 'scram-sha-256',
  });

  if (freshInstall) {
    console.log('[desktop] initdb...');
    await pg.initialise();
  }
  console.log('[desktop] 启动内嵌 postgres...');
  await pg.start();

  // 建库(幂等)
  await ensureDatabase(secrets.SS_DESKTOP_PG_PASSWORD);

  const databaseUrl = `postgresql://${PG_USER}:${secrets.SS_DESKTOP_PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}?schema=public`;

  // 装配「桌面档」env —— 注入子进程;.env 文件不会覆盖已设的 process.env(dotenv/prisma/Next 同此规则)
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    JWT_SECRET: secrets.JWT_SECRET,
    APP_MASTER_KEY: secrets.APP_MASTER_KEY,
    SSE_TOKEN_SECRET: secrets.SSE_TOKEN_SECRET,
    // Phase 1 的 4 个驱动开关 —— 桌面档全部脱 infra
    STORAGE_DRIVER: 'local-fs',
    STORAGE_LOCAL_DIR: paths.storage,
    CACHE_DRIVER: 'l1-only',
    PROGRESS_BUS_DRIVER: 'in-process',
    QUEUE_DRIVER: 'in-process',
    EVENT_BUS_DRIVER: 'in-process',
    AUTH_DRIVER: 'local',
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  };

  // 打包态(SS_DESKTOP_PACKAGED=1):无 pnpm / prisma CLI / tsx —— 用自包含 runner + bundled seed。
  // dev 态:复用现有 pnpm 命令(prisma 官方 migrate + seed.ts)。
  const packaged = process.env.SS_DESKTOP_PACKAGED === '1';

  // ---- migrate ----
  if (packaged) {
    const migDir = process.env.SS_DESKTOP_MIGRATIONS_DIR || join(rootDir, 'packages/db/prisma/migrations');
    console.log(`[desktop] 应用 migrations(自包含 runner)← ${migDir}`);
    const m = await applyMigrations(databaseUrl, migDir);
    console.log(`[desktop] migrations:共 ${m.total} 个,本次新应用 ${m.applied} 个`);
  } else {
    console.log('[desktop] prisma migrate deploy...');
    await run('pnpm', ['--filter', '@ss/db', 'migrate:deploy'], env);
  }

  // ---- seed:首跑全量(建 admin + provider 占位 + 结构),后续增量补缺(SEED_ADDITIVE) ----
  const seedEnv = { ...env, ADMIN_DEFAULT_PASSWORD: env.ADMIN_DEFAULT_PASSWORD ?? 'admin123!@#' };
  if (packaged) {
    const seedJs = process.env.SS_DESKTOP_SEED_JS;
    if (!seedJs || !existsSync(seedJs)) {
      throw new Error(`[desktop] 打包态缺 seed bundle:SS_DESKTOP_SEED_JS=${seedJs}`);
    }
    console.log(`[desktop] ${freshInstall ? '首跑全量' : '增量'} seed(bundle)← ${seedJs}`);
    // 用同一个 node(process.execPath)跑 bundle;cwd 用数据目录(打包后 rootDir 不存在,
    //   且避开仓库根 .env —— DATABASE_URL 仍由注入的 env 提供,dotenv 不覆盖已设值)。
    //   非首跑走增量(SEED_ADDITIVE,不覆盖各机配置)。
    await run(
      process.execPath,
      [seedJs],
      freshInstall ? seedEnv : { ...seedEnv, SEED_ADDITIVE: '1' },
      paths.base,
    );
  } else if (freshInstall) {
    console.log('[desktop] 首跑 db:seed(全量)...');
    await run('pnpm', ['db:seed'], seedEnv);
  } else {
    console.log('[desktop] db:sync(增量补缺,不覆盖各机配置)...');
    await run('pnpm', ['db:sync'], env);
  }

  // 收尾核对
  const stats = await verifyEmbedded(databaseUrl);
  console.log(
    `[desktop] ✅ 内嵌库核对:migrations=${stats.migrations} · public 表=${stats.tables} · 用户=${stats.users}`,
  );

  const stop = async () => {
    console.log('[desktop] 停止内嵌 postgres...');
    await pg.stop();
  };

  return { pg, env, databaseUrl, freshInstall, paths, stats, stop };
}

// =============================================================================
// CLI 入口
// =============================================================================
const isMain = resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const once = process.argv.includes('--once');
  bootstrapDesktop()
    .then(async ({ databaseUrl, stop }) => {
      console.log(`\n[desktop] bootstrap 完成。DATABASE_URL=${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);
      if (once) {
        await stop();
        process.exit(0);
      } else {
        console.log('[desktop] 内嵌 postgres 保持运行中,Ctrl+C 退出。');
        const shutdown = async () => {
          await stop();
          process.exit(0);
        };
        process.on('SIGINT', () => void shutdown());
        process.on('SIGTERM', () => void shutdown());
      }
    })
    .catch((e) => {
      console.error('[desktop] bootstrap 失败:', e);
      process.exit(1);
    });
}
