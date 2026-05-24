-- Phase 1.5 P0-1 + P0-2 同 migration(主次重审 v2.1)
-- P0-1: CostLedgerEntry 加 entryType + 预扣/退还机制
-- P0-2: ProviderConfig 加 2 倍率字段(modelRate + outputRate)
--
-- 不破坏现有数据:
--   - 已有 ledger 行 entryType 默认 NORMAL
--   - attemptId 从 @unique 改成 @@index(允许同 attempt 多条 entry,如 PREPAY + REFUND)
--   - ProviderConfig modelRate/outputRate 默认 NULL(fallback 到 unitPriceCny 单价旧逻辑)

-- ===========================================================================
-- P0-1: CostLedgerEntry entryType enum + 字段 + 关系
-- ===========================================================================

CREATE TYPE "ledger_entry_type" AS ENUM ('NORMAL', 'PREPAY', 'REFUND', 'ADJUSTMENT');

ALTER TABLE "cost_ledger_entries"
  ADD COLUMN "entryType" "ledger_entry_type" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "refundReason" TEXT,
  ADD COLUMN "parentEntryId" TEXT;

-- 去掉 attemptId @unique(允许同 attempt 多条 entry — PREPAY + REFUND)
ALTER TABLE "cost_ledger_entries"
  DROP CONSTRAINT IF EXISTS "cost_ledger_entries_attemptId_key";

-- 自引用 FK:REFUND/ADJUSTMENT 指向对应的 PREPAY/NORMAL 形成账目链
ALTER TABLE "cost_ledger_entries"
  ADD CONSTRAINT "cost_ledger_entries_parentEntryId_fkey"
  FOREIGN KEY ("parentEntryId") REFERENCES "cost_ledger_entries"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "cost_ledger_entries_attemptId_idx"
  ON "cost_ledger_entries"("attemptId");

CREATE INDEX "cost_ledger_entries_entryType_idx"
  ON "cost_ledger_entries"("entryType");

-- ===========================================================================
-- P0-2: ProviderConfig 加 2 倍率字段(modelRate + outputRate)
-- ===========================================================================

ALTER TABLE "provider_configs"
  ADD COLUMN "modelRate" DECIMAL(10,6),
  ADD COLUMN "outputRate" DECIMAL(10,4);
