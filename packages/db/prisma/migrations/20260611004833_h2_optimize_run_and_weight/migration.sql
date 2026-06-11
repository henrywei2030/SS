-- AlterTable
ALTER TABLE "prompt_knowledge" ADD COLUMN     "weight" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "prompt_optimize_runs" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stagesJson" JSONB NOT NULL,
    "dimScoresJson" JSONB,
    "fragmentIds" TEXT[],
    "iterations" INTEGER NOT NULL DEFAULT 0,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "denyCode" TEXT,
    "totalCostCny" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_optimize_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompt_optimize_runs_groupId_createdAt_idx" ON "prompt_optimize_runs"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "prompt_optimize_runs_episodeId_idx" ON "prompt_optimize_runs"("episodeId");

-- CreateIndex
CREATE INDEX "prompt_optimize_runs_projectId_createdAt_idx" ON "prompt_optimize_runs"("projectId", "createdAt");
