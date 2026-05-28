-- 三十六收工 P0 修:scenes / shots / shot_groups 的 (episodeId, positionIdx) UNIQUE 没加 partial WHERE deletedAt IS NULL
--
-- Root cause:
--   storyboard.generateForEpisode 流程:
--     1. findMany scenes WHERE deletedAt IS NULL → 0(被 soft-deleted)
--     2. 触发 parseScriptText + scene.create({ positionIdx: i+1 })
--     3. DB index 不含 partial 条件 → soft-deleted 那条还占着 unique slot → P2002
--
-- 修复:模仿 asset_usage_bindings 已有的 partial unique 模式
--   DROP 老 index → CREATE 新 partial index WHERE deletedAt IS NULL
--   soft-deleted 行不再占 unique slot,replay/regenerate 通畅
--
-- Prisma 7 @@unique 不支持 partial,schema 内仍保留 @@unique 声明(Prisma 用作 type hint),
-- 实际 DB 层用本 raw migration 覆盖为 partial unique。再跑 `prisma migrate deploy` 不会 drift。

-- scenes
DROP INDEX IF EXISTS "scenes_episodeId_positionIdx_key";
CREATE UNIQUE INDEX "scenes_episodeId_positionIdx_key"
  ON public.scenes ("episodeId", "positionIdx")
  WHERE ("deletedAt" IS NULL);

-- shots
DROP INDEX IF EXISTS "shots_episodeId_positionIdx_key";
CREATE UNIQUE INDEX "shots_episodeId_positionIdx_key"
  ON public.shots ("episodeId", "positionIdx")
  WHERE ("deletedAt" IS NULL);

-- shot_groups
DROP INDEX IF EXISTS "shot_groups_episodeId_positionIdx_key";
CREATE UNIQUE INDEX "shot_groups_episodeId_positionIdx_key"
  ON public.shot_groups ("episodeId", "positionIdx")
  WHERE ("deletedAt" IS NULL);
