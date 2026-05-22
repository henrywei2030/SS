-- CreateEnum
CREATE TYPE "SceneTimeOfDay" AS ENUM ('DAWN', 'DAY', 'DUSK', 'NIGHT');

-- CreateEnum
CREATE TYPE "SceneLocation" AS ENUM ('INDOOR', 'OUTDOOR', 'MIXED');

-- CreateEnum
CREATE TYPE "PromptEditTarget" AS ENUM ('SHOT', 'SHOT_GROUP', 'SCENE');

-- AlterTable
ALTER TABLE "shots" ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "sceneId" TEXT;

-- CreateTable
CREATE TABLE "scenes" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "scriptId" TEXT,
    "number" TEXT NOT NULL,
    "timeOfDay" "SceneTimeOfDay" NOT NULL DEFAULT 'DAY',
    "location" "SceneLocation" NOT NULL DEFAULT 'INDOOR',
    "place" TEXT,
    "characters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content" TEXT NOT NULL,
    "positionIdx" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shot_groups" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "positionIdx" INTEGER NOT NULL,
    "durationS" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "prompt" TEXT NOT NULL,
    "promptCompiled" TEXT,
    "status" "ShotStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "shot_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_edits" (
    "id" TEXT NOT NULL,
    "targetType" "PromptEditTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "diffNote" TEXT,
    "projectId" TEXT NOT NULL,
    "episodeId" TEXT,
    "scriptId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_edits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scenes_episodeId_idx" ON "scenes"("episodeId");

-- CreateIndex
CREATE INDEX "scenes_scriptId_idx" ON "scenes"("scriptId");

-- CreateIndex
CREATE UNIQUE INDEX "scenes_episodeId_positionIdx_key" ON "scenes"("episodeId", "positionIdx");

-- CreateIndex
CREATE INDEX "shot_groups_episodeId_idx" ON "shot_groups"("episodeId");

-- CreateIndex
CREATE INDEX "shot_groups_status_idx" ON "shot_groups"("status");

-- CreateIndex
CREATE UNIQUE INDEX "shot_groups_episodeId_positionIdx_key" ON "shot_groups"("episodeId", "positionIdx");

-- CreateIndex
CREATE INDEX "prompt_edits_targetType_targetId_idx" ON "prompt_edits"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "prompt_edits_projectId_createdAt_idx" ON "prompt_edits"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "prompt_edits_field_createdAt_idx" ON "prompt_edits"("field", "createdAt");

-- CreateIndex
CREATE INDEX "shots_sceneId_idx" ON "shots"("sceneId");

-- CreateIndex
CREATE INDEX "shots_groupId_idx" ON "shots"("groupId");

-- AddForeignKey
ALTER TABLE "shots" ADD CONSTRAINT "shots_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "scenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shots" ADD CONSTRAINT "shots_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "shot_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "scripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shot_groups" ADD CONSTRAINT "shot_groups_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_edits" ADD CONSTRAINT "prompt_edits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
