-- CreateEnum
CREATE TYPE "PromptDimension" AS ENUM ('SUBJECT', 'ACTION', 'SCENE', 'LIGHTING', 'CAMERA', 'STYLE', 'QUALITY', 'CONSTRAINT');

-- CreateEnum
CREATE TYPE "PromptKnowledgeSource" AS ENUM ('SEED', 'MANUAL', 'MINED');

-- CreateTable
CREATE TABLE "prompt_knowledge" (
    "id" TEXT NOT NULL,
    "dimension" "PromptDimension" NOT NULL,
    "slug" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tagsJson" JSONB NOT NULL DEFAULT '{}',
    "embedding" JSONB,
    "embeddingModel" TEXT,
    "projectId" TEXT,
    "source" "PromptKnowledgeSource" NOT NULL DEFAULT 'SEED',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prompt_knowledge_slug_key" ON "prompt_knowledge"("slug");

-- CreateIndex
CREATE INDEX "prompt_knowledge_dimension_enabled_idx" ON "prompt_knowledge"("dimension", "enabled");

-- CreateIndex
CREATE INDEX "prompt_knowledge_projectId_idx" ON "prompt_knowledge"("projectId");

-- AddForeignKey
ALTER TABLE "prompt_knowledge" ADD CONSTRAINT "prompt_knowledge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
