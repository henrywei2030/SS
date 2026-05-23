-- W5.1:AssetUsageBinding 加 shotGroupId + refSlotIdx,支持 AIGC 生成段(ShotGroup)级 binding
-- + 图片序号(@图片1 / @音频1)token 机制
--
-- 依赖:D1 partial unique 已应用(migration 20260523103000_audit_p0_assetusage_partial_unique)
-- 本次会先 DROP D1 索引,再以含 shotGroupId 的新版本重建(维度 4 → 5)

-- 1. 加新列
ALTER TABLE "asset_usage_bindings" ADD COLUMN "shotGroupId" TEXT;
ALTER TABLE "asset_usage_bindings" ADD COLUMN "refSlotIdx" INTEGER;

-- 2. 外键(级联 SetNull 与 sceneId/shotId 一致 — ShotGroup 软删后 binding 保留但解绑)
ALTER TABLE "asset_usage_bindings"
  ADD CONSTRAINT "asset_usage_bindings_shotGroupId_fkey"
  FOREIGN KEY ("shotGroupId") REFERENCES "shot_groups"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. 索引
CREATE INDEX "asset_usage_bindings_shotGroupId_idx" ON "asset_usage_bindings"("shotGroupId");
CREATE INDEX "asset_usage_bindings_shotGroupId_refSlotIdx_idx"
  ON "asset_usage_bindings"("shotGroupId", "refSlotIdx");

-- 4. 重建 partial functional unique 索引,把 shotGroupId 纳入维度
-- 旧索引(由 D1 migration 创建)只覆盖 4 列,现在 binding 多了 shotGroup 层,
-- 必须把 shotGroupId 也纳入 COALESCE,否则 group 级 binding 与 episode/scene 级会撞唯一
DROP INDEX "asset_usage_bindings_assetId_episodeId_sceneId_shotId_usage_key";

CREATE UNIQUE INDEX "asset_usage_bindings_assetId_episodeId_sceneId_shotId_usage_key"
ON "asset_usage_bindings" (
  "assetId",
  "episodeId",
  COALESCE("sceneId", ''),
  COALESCE("shotGroupId", ''),
  COALESCE("shotId", ''),
  "usageType"
)
WHERE "deletedAt" IS NULL;
