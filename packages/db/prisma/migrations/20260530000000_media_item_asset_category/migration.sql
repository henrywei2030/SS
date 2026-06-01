-- 四二收工:素材库 MediaItem 加资产归属类别字段
--
-- 需求:用户在 /library 看到上传的图片只有 IMAGE 占位 + 无法按"人物/场景/道具"归类。
-- 现有 MediaItem.kind 是媒体类型(IMAGE/VIDEO/AUDIO),MediaItem.viewKind 是视角细分,
-- 都不表达"资产归属类别"。本字段补这层语义。
--
-- 字段:assetCategory TEXT NULL,值约定 'CHARACTER' / 'SCENE' / 'PROP' / 'OTHER',null = 未归类
-- 索引:筛选查询用
-- additive 安全,老数据 NULL 不影响业务

ALTER TABLE "media_items"
  ADD COLUMN "assetCategory" TEXT;

CREATE INDEX "media_items_assetCategory_idx" ON "media_items" ("assetCategory");
