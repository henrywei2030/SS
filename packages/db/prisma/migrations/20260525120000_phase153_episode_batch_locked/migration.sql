-- Phase 1.5.3:Episode 加 batchLocked 字段,用户手动锁定后批量生成跳过本集
-- 区别于 generatingStartedAt 软锁(临时):batchLocked 是永久跳过直到手动解锁

ALTER TABLE "episodes" ADD COLUMN "batchLocked" BOOLEAN NOT NULL DEFAULT false;
