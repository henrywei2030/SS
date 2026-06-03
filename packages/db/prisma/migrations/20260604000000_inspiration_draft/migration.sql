-- 四七收工:导演模块「灵感创作」子模块 — 灵感创作草稿表
--
-- 需求:导演模块在"剧本/分镜"左侧加"灵感创作"子模块,用户输入想法 → LLM 生成多集剧本
-- (大纲 + 各集),草稿可下载/在线保存,经剧本子模块"关联剧本"按钮 → script.upload(source=AI_GENERATED)转正。
--
-- InspirationDraft 独立于 Script(未绑 episode):一条 = 一个灵感 session,含多集 outline + episodes(JSONB)。
-- additive 建新表,零数据风险。

-- CreateTable
CREATE TABLE "inspiration_drafts" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '未命名灵感',
    "idea" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "outline" JSONB,
    "episodes" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "modelId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "inspiration_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inspiration_drafts_projectId_deletedAt_idx" ON "inspiration_drafts"("projectId", "deletedAt");

-- AddForeignKey
ALTER TABLE "inspiration_drafts" ADD CONSTRAINT "inspiration_drafts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspiration_drafts" ADD CONSTRAINT "inspiration_drafts_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
