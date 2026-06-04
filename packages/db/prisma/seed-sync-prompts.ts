/**
 * DB 增量同步 + 强更 prompt 正文(四九收工)— `pnpm db:sync:prompts`
 *
 * 在 db:sync(只补缺失)基础上,额外把 seed.ts 里的 prompt 正文强更到 DB
 * (prompt 是可改进的默认值,改进应能跨机传播)。
 *
 * ⚠️ 会覆盖 admin 在 /admin/prompts 手动编辑过的 prompt 正文 —— 故单独命令显式触发。
 * 不碰 binding 值 / 密钥 / provider / 各机配置(那些仍只增不改)。
 */
process.env.SEED_ADDITIVE = '1';
process.env.SEED_FORCE_PROMPTS = '1';
await import('./seed.ts');
