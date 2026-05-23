-- W5.4:GenerationAttempt 加 shotGroupId,AIGC 视频生成绑到 ShotGroup(1-8 这种生成段)
--
-- 为什么不复用 shotId:group 级 video attempt 不属于任一 shot,而是整个 group。
-- 历史记录(listVideoTakes by groupId)和重抽逻辑都需要 group 维度。

ALTER TABLE "generation_attempts" ADD COLUMN "shotGroupId" TEXT;

ALTER TABLE "generation_attempts"
  ADD CONSTRAINT "generation_attempts_shotGroupId_fkey"
  FOREIGN KEY ("shotGroupId") REFERENCES "shot_groups"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "generation_attempts_shotGroupId_action_status_idx"
  ON "generation_attempts"("shotGroupId", "action", "status");
