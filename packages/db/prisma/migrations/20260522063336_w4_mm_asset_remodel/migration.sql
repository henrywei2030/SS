-- CreateEnum
CREATE TYPE "AssetUsageType" AS ENUM ('APPEAR', 'SPEAK', 'HOLD', 'WEAR', 'ENVIRONMENT', 'BACKGROUND', 'SOUND_BG', 'SOUND_VOICE', 'THEME', 'REFERENCE');

-- CreateEnum
CREATE TYPE "AssetMaturity" AS ENUM ('L0_IDENTIFIED', 'L1_PROMPT_READY', 'L2_CANDIDATE', 'L3_MAIN_CONFIRMED', 'L4_CONSISTENCY_READY', 'L5_PRODUCTION_READY');

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "archetypeKey" TEXT,
ADD COLUMN     "complianceExpiresAt" TIMESTAMP(3),
ADD COLUMN     "complianceVendor" TEXT,
ADD COLUMN     "importance" TEXT,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "maturity" "AssetMaturity" NOT NULL DEFAULT 'L0_IDENTIFIED',
ADD COLUMN     "panoramaMediaId" TEXT,
ADD COLUMN     "portraitMediaId" TEXT,
ADD COLUMN     "sceneBackMediaId" TEXT,
ADD COLUMN     "sceneFrontMediaId" TEXT,
ADD COLUMN     "sceneLeftMediaId" TEXT,
ADD COLUMN     "sceneMainMediaId" TEXT,
ADD COLUMN     "sceneRightMediaId" TEXT,
ADD COLUMN     "threeViewMediaId" TEXT,
ADD COLUMN     "voiceModelId" TEXT;

-- AlterTable
ALTER TABLE "generation_attempts" ADD COLUMN     "candidateForSlot" TEXT,
ADD COLUMN     "rejected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedBy" TEXT;

-- AlterTable
ALTER TABLE "media_items" ADD COLUMN     "aspectRatio" TEXT,
ADD COLUMN     "viewKind" TEXT;

-- CreateTable
CREATE TABLE "asset_usage_bindings" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "sceneId" TEXT,
    "shotId" TEXT,
    "usageType" "AssetUsageType" NOT NULL DEFAULT 'APPEAR',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "asset_usage_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_usage_bindings_assetId_idx" ON "asset_usage_bindings"("assetId");

-- CreateIndex
CREATE INDEX "asset_usage_bindings_episodeId_idx" ON "asset_usage_bindings"("episodeId");

-- CreateIndex
CREATE INDEX "asset_usage_bindings_sceneId_idx" ON "asset_usage_bindings"("sceneId");

-- CreateIndex
CREATE INDEX "asset_usage_bindings_shotId_idx" ON "asset_usage_bindings"("shotId");

-- CreateIndex
CREATE INDEX "asset_usage_bindings_projectId_idx" ON "asset_usage_bindings"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_usage_bindings_assetId_episodeId_sceneId_shotId_usage_key" ON "asset_usage_bindings"("assetId", "episodeId", "sceneId", "shotId", "usageType");

-- CreateIndex
CREATE INDEX "assets_projectId_archetypeKey_idx" ON "assets"("projectId", "archetypeKey");

-- CreateIndex
CREATE INDEX "media_items_aspectRatio_kind_idx" ON "media_items"("aspectRatio", "kind");

-- AddForeignKey
ALTER TABLE "asset_usage_bindings" ADD CONSTRAINT "asset_usage_bindings_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_usage_bindings" ADD CONSTRAINT "asset_usage_bindings_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_usage_bindings" ADD CONSTRAINT "asset_usage_bindings_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "scenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_usage_bindings" ADD CONSTRAINT "asset_usage_bindings_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "shots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
