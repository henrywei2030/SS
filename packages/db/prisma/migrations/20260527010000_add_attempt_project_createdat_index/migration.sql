-- r8 性能优化:GenerationAttempt 加 (projectId, createdAt) 复合 index
--
-- 使用场景:
--   - insights.getProjectOverview:status groupBy WHERE projectId = ? AND createdAt >= ?
--   - admin.apiUsage.list/exportCsv:projectId + 时间窗 + 排序
--   - 项目首页统计:近 30 天 attempt 数 / cost
--
-- 现状:已有 [projectId] 单列 index,但跨时间窗的查询走单列后再 filter,
-- 数据量大时 cost > IO 节省。加 composite index 让规划器直接 range scan。
--
-- 风险:几乎零 — 新 index 只是加速读,不影响写(略微增加 insert 索引维护成本可忽略)

CREATE INDEX IF NOT EXISTS "generation_attempts_projectId_createdAt_idx"
  ON "generation_attempts" ("projectId", "createdAt");
