-- 七二·跨集换装(需求 #2):AssetVersion 空表重定义为「按集造型版本」
-- 同一人物在不同集数更换服装造型 — 每行 = 某资产在某集的一套槽位覆盖,空字段回退 Asset 默认槽位。
-- 安全前提:asset_versions 为空表(0 行,原"生成历史版本"语义零代码引用),
--           DROP COLUMN + ADD NOT NULL 无数据丢失。

-- DropIndex
DROP INDEX "asset_versions_assetId_version_key";

-- AlterTable
ALTER TABLE "asset_versions" DROP COLUMN "cost",
DROP COLUMN "generatedBy",
DROP COLUMN "mediaItemIds",
DROP COLUMN "prompt",
DROP COLUMN "version",
ADD COLUMN     "episodeId" TEXT NOT NULL,
ADD COLUMN     "label" TEXT,
ADD COLUMN     "portraitMediaId" TEXT,
ADD COLUMN     "sceneMainMediaId" TEXT,
ADD COLUMN     "threeViewMediaId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "asset_versions_episodeId_idx" ON "asset_versions"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_versions_assetId_episodeId_key" ON "asset_versions"("assetId", "episodeId");

-- AddForeignKey
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
