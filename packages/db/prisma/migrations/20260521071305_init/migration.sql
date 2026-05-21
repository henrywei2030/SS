-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('AI_REAL', 'ANIM_3D', 'ANIM_2D', 'POSTER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'LEADER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScriptSource" AS ENUM ('UPLOAD', 'AI_GENERATED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssignRole" AS ENUM ('OWNER', 'COLLAB', 'REVIEWER');

-- CreateEnum
CREATE TYPE "ShotStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'QUEUED', 'GENERATING', 'GENERATED', 'ADOPTED', 'IN_EDIT', 'FINAL', 'FAILED', 'BUDGET_BLOCKED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('S', 'A', 'B', 'C');

-- CreateEnum
CREATE TYPE "AssetRefKind" AS ENUM ('VISIBLE', 'MENTIONED', 'VOICE_ONLY');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('CHARACTER', 'SCENE', 'PROP', 'STYLE_REFERENCE');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('DRAFT', 'CANDIDATE', 'CONFIRMED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MediaScope" AS ENUM ('PUBLIC', 'PROJECT', 'PERSONAL');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'THREE_D', 'OTHER');

-- CreateEnum
CREATE TYPE "CopyrightStatus" AS ENUM ('UNKNOWN', 'SELF_OWNED', 'LICENSED', 'RESTRICTED', 'FORBIDDEN');

-- CreateEnum
CREATE TYPE "MediaSource" AS ENUM ('UPLOAD', 'AIGC', 'IMPORTED', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "GenerationAction" AS ENUM ('VIDEO', 'IMAGE', 'TEXT', 'AUDIO', 'COMPLIANCE', 'ANALYSIS');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'BUDGET_BLOCKED');

-- CreateEnum
CREATE TYPE "PromptCategory" AS ENUM ('ASSET_BREAKDOWN', 'IMAGE_GENERATION', 'SHOT_GENERATION', 'SCRIPT_STORYBOARD', 'PANORAMA_360', 'PROMPT_FRAGMENT', 'PROMPT_PRESET');

-- CreateEnum
CREATE TYPE "StyleKind" AS ENUM ('AI_REAL', 'ANIM_3D', 'ANIM_2D', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('VIDEO', 'IMAGE', 'TEXT', 'AUDIO', 'COMPLIANCE', 'EMBEDDING');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "passwordHash" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "ProjectType" NOT NULL,
    "aspect" TEXT NOT NULL,
    "styleId" TEXT,
    "budgetCny" DECIMAL(12,2),
    "startDate" DATE,
    "daysCount" INTEGER,
    "defaultVideoProviderId" TEXT,
    "defaultImageProviderId" TEXT,
    "defaultLlmModel" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "modules" TEXT[],
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "modules" TEXT[],
    "inviterId" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scripts" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "episodeId" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'zh-CN',
    "source" "ScriptSource" NOT NULL DEFAULT 'UPLOAD',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "scripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "script_analyses" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "episodeId" TEXT,
    "modelId" TEXT NOT NULL,
    "hookScore" DOUBLE PRECISION,
    "suspenseScore" DOUBLE PRECISION,
    "twistScore" DOUBLE PRECISION,
    "climaxScore" DOUBLE PRECISION,
    "conflictScore" DOUBLE PRECISION,
    "dialogueScore" DOUBLE PRECISION,
    "paceScore" DOUBLE PRECISION,
    "urgencyScore" DOUBLE PRECISION,
    "overallScore" DOUBLE PRECISION,
    "summary" TEXT,
    "highlights" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "curveJson" JSONB NOT NULL,
    "productionPlan" JSONB NOT NULL,
    "costCny" DECIMAL(10,4) NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "script_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episodes" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "status" "EpisodeStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "publishedAt" TIMESTAMP(3),
    "publishedVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_assignments" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AssignRole" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episode_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shots" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "framing" TEXT,
    "angle" TEXT,
    "content" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "promptCompiled" TEXT,
    "durationS" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "priority" "Priority",
    "isMerged" BOOLEAN NOT NULL DEFAULT false,
    "mergedFrom" TEXT[],
    "positionIdx" INTEGER NOT NULL,
    "positionX" DOUBLE PRECISION,
    "positionY" DOUBLE PRECISION,
    "status" "ShotStatus" NOT NULL DEFAULT 'DRAFT',
    "versionHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "shots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shot_asset_refs" (
    "id" TEXT NOT NULL,
    "shotId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "refKind" "AssetRefKind" NOT NULL DEFAULT 'VISIBLE',

    CONSTRAINT "shot_asset_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "name" TEXT NOT NULL,
    "alias" TEXT[],
    "description" TEXT,
    "prompt" TEXT NOT NULL,
    "promptStep" JSONB,
    "characterRole" TEXT,
    "tags" TEXT[],
    "styleId" TEXT,
    "mainMediaId" TEXT,
    "threeViewIds" TEXT[],
    "panorama360Id" TEXT,
    "refImageIds" TEXT[],
    "loraIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "voiceMediaId" TEXT,
    "model3dUrl" TEXT,
    "gaussianUrl" TEXT,
    "complianceId" TEXT,
    "complianceStatus" "ComplianceStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "complianceCheckedAt" TIMESTAMP(3),
    "status" "AssetStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_versions" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "mediaItemIds" TEXT[],
    "generatedBy" TEXT NOT NULL,
    "cost" DECIMAL(10,4) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_items" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "scope" "MediaScope" NOT NULL DEFAULT 'PROJECT',
    "kind" "MediaKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "cdnUrl" TEXT,
    "meta" JSONB NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiLabels" JSONB,
    "embeddingId" TEXT,
    "copyright" "CopyrightStatus" NOT NULL DEFAULT 'UNKNOWN',
    "copyrightSource" TEXT,
    "source" "MediaSource" NOT NULL DEFAULT 'UPLOAD',
    "sourceRef" TEXT,
    "isFavorited" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_attempts" (
    "id" TEXT NOT NULL,
    "shotId" TEXT,
    "assetId" TEXT,
    "projectId" TEXT NOT NULL,
    "episodeId" TEXT,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "action" "GenerationAction" NOT NULL,
    "inputJson" JSONB NOT NULL,
    "outputMediaId" TEXT,
    "outputMediaIds" TEXT[],
    "errorMsg" TEXT,
    "inputUnits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outputUnits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPriceCny" DECIMAL(10,6) NOT NULL,
    "costCny" DECIMAL(10,4) NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "adopted" BOOLEAN NOT NULL DEFAULT false,
    "adoptedAt" TIMESTAMP(3),
    "adoptedBy" TEXT,
    "groupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "generation_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_ledger_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "episodeId" TEXT,
    "shotId" TEXT,
    "assetId" TEXT,
    "attemptId" TEXT,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "inputUnits" DOUBLE PRECISION NOT NULL,
    "outputUnits" DOUBLE PRECISION NOT NULL,
    "unitPriceCny" DECIMAL(10,6) NOT NULL,
    "costCny" DECIMAL(12,4) NOT NULL,
    "success" BOOLEAN NOT NULL,
    "billingCycle" TEXT,
    "plan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "projectId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "category" "PromptCategory" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "varsJson" JSONB NOT NULL,
    "modelHint" TEXT,
    "versionTag" TEXT NOT NULL DEFAULT 'v1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_template_versions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionTag" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "varsJson" JSONB NOT NULL,
    "changeLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "prompt_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "StyleKind" NOT NULL,
    "characterPrompt" TEXT NOT NULL,
    "scenePrompt" TEXT NOT NULL,
    "propPrompt" TEXT NOT NULL,
    "forbiddenWords" TEXT[],
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "embeddingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "style_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_configs" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "kind" "ProviderKind" NOT NULL,
    "apiUrl" TEXT,
    "apiKeyRef" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "unitPriceCny" DECIMAL(10,6) NOT NULL,
    "unitName" TEXT NOT NULL,
    "maxConcurrent" INTEGER NOT NULL DEFAULT 5,
    "rateLimitRpm" INTEGER NOT NULL DEFAULT 60,
    "defaultParams" JSONB,
    "healthScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_report_snapshots" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "gachaRatio" DOUBLE PRECISION NOT NULL,
    "targetSeconds" DOUBLE PRECISION NOT NULL,
    "generatedSeconds" DOUBLE PRECISION NOT NULL,
    "perUserJson" JSONB NOT NULL,
    "topGachaShots" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_report_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE INDEX "projects_ownerId_idx" ON "projects"("ownerId");

-- CreateIndex
CREATE INDEX "projects_deletedAt_idx" ON "projects"("deletedAt");

-- CreateIndex
CREATE INDEX "projects_type_idx" ON "projects"("type");

-- CreateIndex
CREATE INDEX "project_members_userId_idx" ON "project_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- CreateIndex
CREATE INDEX "invitations_projectId_idx" ON "invitations"("projectId");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "scripts_episodeId_key" ON "scripts"("episodeId");

-- CreateIndex
CREATE INDEX "scripts_projectId_idx" ON "scripts"("projectId");

-- CreateIndex
CREATE INDEX "script_analyses_scriptId_idx" ON "script_analyses"("scriptId");

-- CreateIndex
CREATE INDEX "script_analyses_episodeId_idx" ON "script_analyses"("episodeId");

-- CreateIndex
CREATE INDEX "episodes_projectId_idx" ON "episodes"("projectId");

-- CreateIndex
CREATE INDEX "episodes_status_idx" ON "episodes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_projectId_number_key" ON "episodes"("projectId", "number");

-- CreateIndex
CREATE INDEX "episode_assignments_userId_idx" ON "episode_assignments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "episode_assignments_episodeId_userId_role_key" ON "episode_assignments"("episodeId", "userId", "role");

-- CreateIndex
CREATE INDEX "shots_episodeId_idx" ON "shots"("episodeId");

-- CreateIndex
CREATE INDEX "shots_status_idx" ON "shots"("status");

-- CreateIndex
CREATE INDEX "shots_priority_idx" ON "shots"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "shots_episodeId_positionIdx_key" ON "shots"("episodeId", "positionIdx");

-- CreateIndex
CREATE INDEX "shot_asset_refs_assetId_idx" ON "shot_asset_refs"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "shot_asset_refs_shotId_assetId_refKind_key" ON "shot_asset_refs"("shotId", "assetId", "refKind");

-- CreateIndex
CREATE INDEX "assets_projectId_type_idx" ON "assets"("projectId", "type");

-- CreateIndex
CREATE INDEX "assets_projectId_name_idx" ON "assets"("projectId", "name");

-- CreateIndex
CREATE INDEX "assets_deletedAt_idx" ON "assets"("deletedAt");

-- CreateIndex
CREATE INDEX "asset_versions_assetId_idx" ON "asset_versions"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_versions_assetId_version_key" ON "asset_versions"("assetId", "version");

-- CreateIndex
CREATE INDEX "media_items_projectId_kind_idx" ON "media_items"("projectId", "kind");

-- CreateIndex
CREATE INDEX "media_items_scope_kind_idx" ON "media_items"("scope", "kind");

-- CreateIndex
CREATE INDEX "media_items_deletedAt_idx" ON "media_items"("deletedAt");

-- CreateIndex
CREATE INDEX "generation_attempts_projectId_idx" ON "generation_attempts"("projectId");

-- CreateIndex
CREATE INDEX "generation_attempts_shotId_idx" ON "generation_attempts"("shotId");

-- CreateIndex
CREATE INDEX "generation_attempts_providerId_status_idx" ON "generation_attempts"("providerId", "status");

-- CreateIndex
CREATE INDEX "generation_attempts_createdBy_createdAt_idx" ON "generation_attempts"("createdBy", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "cost_ledger_entries_attemptId_key" ON "cost_ledger_entries"("attemptId");

-- CreateIndex
CREATE INDEX "cost_ledger_entries_projectId_createdAt_idx" ON "cost_ledger_entries"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "cost_ledger_entries_userId_createdAt_idx" ON "cost_ledger_entries"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "cost_ledger_entries_providerId_modelId_createdAt_idx" ON "cost_ledger_entries"("providerId", "modelId", "createdAt");

-- CreateIndex
CREATE INDEX "cost_ledger_entries_billingCycle_idx" ON "cost_ledger_entries"("billingCycle");

-- CreateIndex
CREATE INDEX "operation_logs_projectId_createdAt_idx" ON "operation_logs"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "operation_logs_actorId_createdAt_idx" ON "operation_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "operation_logs_targetType_targetId_idx" ON "operation_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "prompt_templates_category_isActive_idx" ON "prompt_templates"("category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_slug_versionTag_key" ON "prompt_templates"("slug", "versionTag");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_template_versions_templateId_versionTag_key" ON "prompt_template_versions"("templateId", "versionTag");

-- CreateIndex
CREATE UNIQUE INDEX "style_profiles_slug_key" ON "style_profiles"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "provider_configs_providerId_key" ON "provider_configs"("providerId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "work_report_snapshots_projectId_periodEnd_idx" ON "work_report_snapshots"("projectId", "periodEnd");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "style_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "script_analyses" ADD CONSTRAINT "script_analyses_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "scripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_assignments" ADD CONSTRAINT "episode_assignments_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_assignments" ADD CONSTRAINT "episode_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shots" ADD CONSTRAINT "shots_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shot_asset_refs" ADD CONSTRAINT "shot_asset_refs_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "shots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shot_asset_refs" ADD CONSTRAINT "shot_asset_refs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "style_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "media_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "shots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "generation_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_template_versions" ADD CONSTRAINT "prompt_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
