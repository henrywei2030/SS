-- W5 audit S1:AssetUsageBinding.refSlotIdx 在同 shotGroup 内必须唯一
--
-- 问题:
--   refSlotIdx 是 group 内的展示序号(@图片1/@图片2/...),autoMatchAssets 用 max+1 续接,
--   但 schema 没强制唯一 — 并发或手动可让两个 binding 都占同 idx → compile 时
--   references 数组同 token 出现两次,Seedance 不知道选哪个。
--
-- 修复:
--   partial unique index on (shotGroupId, refSlotIdx) WHERE deletedAt IS NULL AND
--   shotGroupId IS NOT NULL AND refSlotIdx IS NOT NULL
--
--   (refSlotIdx 是 nullable 的因为 binding 在 episode/scene 级时不需要编号,
--    所以 partial 必须过滤 refSlotIdx IS NOT NULL)

CREATE UNIQUE INDEX "asset_usage_bindings_shotGroup_refSlot_key"
ON "asset_usage_bindings" ("shotGroupId", "refSlotIdx")
WHERE "deletedAt" IS NULL
  AND "shotGroupId" IS NOT NULL
  AND "refSlotIdx" IS NOT NULL;
