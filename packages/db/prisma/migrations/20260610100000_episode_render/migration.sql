-- CreateTable
CREATE TABLE "episode_renders" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'QUEUED',
    "mediaId" TEXT,
    "srtMediaId" TEXT,
    "paramsJson" JSONB NOT NULL,
    "errorMsg" TEXT,
    "createdBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "episode_renders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "episode_renders_episodeId_createdAt_idx" ON "episode_renders"("episodeId", "createdAt");

-- CreateIndex
CREATE INDEX "episode_renders_status_idx" ON "episode_renders"("status");

-- AddForeignKey
ALTER TABLE "episode_renders" ADD CONSTRAINT "episode_renders_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

