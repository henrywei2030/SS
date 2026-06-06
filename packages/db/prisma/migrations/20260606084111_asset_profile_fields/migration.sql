-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "age" INTEGER,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "heightCm" INTEGER,
ADD COLUMN     "mbti" TEXT,
ADD COLUMN     "monologue" TEXT,
ADD COLUMN     "personalityTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "profileJson" JSONB;

-- CreateTable
CREATE TABLE "asset_relations" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromAssetId" TEXT NOT NULL,
    "toAssetId" TEXT NOT NULL,
    "relationLabel" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "asset_relations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_relations_projectId_idx" ON "asset_relations"("projectId");

-- CreateIndex
CREATE INDEX "asset_relations_fromAssetId_idx" ON "asset_relations"("fromAssetId");

-- CreateIndex
CREATE INDEX "asset_relations_toAssetId_idx" ON "asset_relations"("toAssetId");

-- CreateIndex
CREATE INDEX "asset_relations_deletedAt_idx" ON "asset_relations"("deletedAt");

-- AddForeignKey
ALTER TABLE "asset_relations" ADD CONSTRAINT "asset_relations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_relations" ADD CONSTRAINT "asset_relations_fromAssetId_fkey" FOREIGN KEY ("fromAssetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_relations" ADD CONSTRAINT "asset_relations_toAssetId_fkey" FOREIGN KEY ("toAssetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
