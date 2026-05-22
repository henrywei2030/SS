-- CreateEnum
CREATE TYPE "AnalysisScope" AS ENUM ('EPISODE', 'PROJECT');

-- AlterEnum
ALTER TYPE "GenerationAction" ADD VALUE 'BATCH_ANALYSIS';

-- AlterTable
ALTER TABLE "script_analyses" ADD COLUMN     "comparisonJson" JSONB,
ADD COLUMN     "episodeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "perEpisodeStats" JSONB,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "scope" "AnalysisScope" NOT NULL DEFAULT 'EPISODE',
ALTER COLUMN "scriptId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "script_analyses_projectId_scope_createdAt_idx" ON "script_analyses"("projectId", "scope", "createdAt");

-- CreateIndex
CREATE INDEX "script_analyses_scope_createdAt_idx" ON "script_analyses"("scope", "createdAt");
