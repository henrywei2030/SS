/**
 * DB 增量同步入口(四九收工)— `pnpm db:sync`
 *
 * 跨机统一痛点:seed.ts 里的 prompt 模板 / binding KEY / 风格是 git 里的真相,
 * 但开工拉代码后本地 DB 不会自动补。各机独立的 binding 值 / 密钥 / 手动编辑过的
 * prompt 正文又不能被覆盖。
 *
 * 本入口设 SEED_ADDITIVE=1 后跑 seed.ts:
 *   ✓ 补缺失的 prompt 模板 slug / 系统设置 KEY / 风格(insert-if-missing)
 *   ✗ 不覆盖已存在的 binding 值 / prompt 正文 / 风格(update:{})
 *   ✗ 跳过 providers(各机可能已删直连 / 改中转)
 *
 * 用 wrapper 而非 `SEED_ADDITIVE=1 tsx ...` prefix —— 后者在 Windows PowerShell 不生效。
 */
process.env.SEED_ADDITIVE = '1';
await import('./seed.ts');
