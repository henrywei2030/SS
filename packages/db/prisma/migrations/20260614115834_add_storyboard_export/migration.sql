-- CreateTable
CREATE TABLE "storyboard_exports" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "episodeNumbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "scriptText" TEXT NOT NULL,
    "shotCountSnapshot" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "storyboard_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storyboard_exports_projectId_idx" ON "storyboard_exports"("projectId");

-- CreateIndex
CREATE INDEX "storyboard_exports_deletedAt_idx" ON "storyboard_exports"("deletedAt");

-- AddForeignKey
ALTER TABLE "storyboard_exports" ADD CONSTRAINT "storyboard_exports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
