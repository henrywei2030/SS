-- 2026-05-27 audit r15 P0: drop legacy UNIQUE constraint on CostLedgerEntry.attemptId
--
-- Phase 1.5 P0-1 设计:1 attempt 多条 ledger entry(PREPAY + REFUND/ADJUSTMENT),
-- schema 已改成普通 @@index([attemptId]) 但 migration 没生成 → DB 上 UNIQUE 索引仍在 →
-- worker 写第二条 REFUND 时 P2002 unique violation → catch 静默 → attempt 卡 RUNNING + moyu 端视频丢失。
--
-- 表里实际同时有两个索引:
--   cost_ledger_entries_attemptId_idx  (普通,新)
--   cost_ledger_entries_attemptId_key  (UNIQUE,老,需删)
--
-- DROP IF EXISTS 防 reseed 重跑报错。

DROP INDEX IF EXISTS "cost_ledger_entries_attemptId_key";
