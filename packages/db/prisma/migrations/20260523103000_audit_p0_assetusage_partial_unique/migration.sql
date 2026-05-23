-- W1-W5 audit P0(D1):AssetUsageBinding 复合 unique 含 nullable 列在 PG 失效
--
-- 问题:
--   `@@unique([assetId, episodeId, sceneId, shotId, usageType])` 中
--   sceneId / shotId 是 nullable,PG 中 NULL ≠ NULL,
--   并发两个 `(陆乘, 第14集, null, null, APPEAR)` 不会被唯一约束拦住,
--   asset.ts:bindUsage 的 findFirst 防御也救不了(P2002 不会触发)。
--
-- 修复:
--   1. 删旧的 multi-column unique
--   2. 建一个 partial functional unique index:
--      - COALESCE(sceneId, '') / COALESCE(shotId, '') 把 NULL 当 sentinel 比较
--      - WHERE deletedAt IS NULL — 软删后允许重建同槽位 binding

-- 删旧索引(由 W4-MM migration 创建)
DROP INDEX IF EXISTS "asset_usage_bindings_assetId_episodeId_sceneId_shotId_usage_key";

-- 建新的 partial functional unique
CREATE UNIQUE INDEX "asset_usage_bindings_assetId_episodeId_sceneId_shotId_usage_key"
ON "asset_usage_bindings" (
  "assetId",
  "episodeId",
  COALESCE("sceneId", ''),
  COALESCE("shotId", ''),
  "usageType"
)
WHERE "deletedAt" IS NULL;
