-- F4 批量(深审 F-5.4 建议项):GenerationAttempt.groupId 加索引 — batch-followup 在每个
-- take 终态按批次标签(groupId=batch_*)查询重试计数 + 完成判定(×3 查询),无索引会随
-- attempt 表增长线性变慢。纯加索引,无数据变更。
CREATE INDEX "generation_attempts_groupId_idx" ON "generation_attempts"("groupId");
