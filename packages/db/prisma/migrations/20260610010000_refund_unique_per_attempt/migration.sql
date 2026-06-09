-- 12 维深审落地:CostLedgerEntry 加 (attemptId) WHERE entryType='REFUND' partial unique
--
-- 场景:
--   退款幂等目前是代码级保证(refundPrepayForAttempt 先查 REFUND 再写 +
--   process-job 'attempt_refund' advisory 锁)。本索引是 DB 级兜底(belt-and-suspenders):
--   未来重构若绕过 helper/锁,并发双退款会在第二条 insert 处抛 P2002 整事务回滚,
--   而不是无声多退钱。
--
-- 不约束 PREPAY / NORMAL / ADJUSTMENT:
--   - PREPAY 与占位 attempt 同事务创建(attempt id 是新 cuid,天然不重)
--   - NORMAL 允许同 attempt 多条(历史语义)、ADJUSTMENT 允许多次人工校正
--
-- 影响:
--   触发 P2002 = 真发生了并发双退竞态,回滚是期望行为(竞态赢家已完成同等清理)。
--   各机执行前数据已核查无存量重复(本迁移创建当日 mac-studio REFUND 共 0 条)。

CREATE UNIQUE INDEX "cost_ledger_entries_refund_attemptId_key"
ON "cost_ledger_entries" ("attemptId")
WHERE "entryType" = 'REFUND' AND "attemptId" IS NOT NULL;
