-- 三十九收工 perf:GenerationAttempt 加 (episodeId, action, status) 复合索引
--
-- aigc.listEpisodes(集数总览首屏)跑:
--   GenerationAttempt WHERE episodeId IN (...) AND action='VIDEO' AND status='SUCCESS'
-- 原有索引仅覆盖 projectId / shotId / shotGroupId+action+status / providerId+status,
-- episodeId 维度无索引 → 集多时全表扫。本索引让首屏聚合 query 走索引。
CREATE INDEX "generation_attempts_episodeId_action_status_idx"
  ON "generation_attempts" ("episodeId", "action", "status");
