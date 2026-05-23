-- W1-W5 audit 三轮 F1:GenerationAttempt.shotGroupId FK 从 Cascade → SetNull
--
-- 原因:
--   archiveGroup 走软删(写 deletedAt),不触发 FK。但如果未来有人在 admin 后台
--   或脚本里 prisma.shotGroup.delete() 硬删,Cascade 会连带删所有该 group 的 video
--   attempts,违背 archiveGroup 注释"attempts 保留审计"。
--
--   改 SetNull 后:硬删 group 时,attempt.shotGroupId 置空但 attempt 行保留,
--   ledger / MediaItem / 审计链路全部完整。

ALTER TABLE "generation_attempts"
  DROP CONSTRAINT "generation_attempts_shotGroupId_fkey";

ALTER TABLE "generation_attempts"
  ADD CONSTRAINT "generation_attempts_shotGroupId_fkey"
  FOREIGN KEY ("shotGroupId") REFERENCES "shot_groups"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
