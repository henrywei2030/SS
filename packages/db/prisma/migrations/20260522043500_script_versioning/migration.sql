-- DropIndex
DROP INDEX "scripts_episodeId_key";

-- AlterTable
ALTER TABLE "scripts" ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "scripts_episodeId_version_key" ON "scripts"("episodeId", "version");

-- CreateIndex
CREATE INDEX "scripts_episodeId_isCurrent_idx" ON "scripts"("episodeId", "isCurrent");
