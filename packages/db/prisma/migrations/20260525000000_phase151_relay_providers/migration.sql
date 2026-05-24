-- Phase 1.5.1(2026-05-25)— 中转站凭证表 + 模型 ↔ 中转站 FK 关联
--
-- 目标:
--   - 多中转站(moyu / poe / openrouter / 自定义)独立管理凭证
--   - 1 个 RelayProvider = 1 个 apiUrl + 1 个 token,关联多个 ProviderConfig
--   - 直连 Provider(relayProviderId=null)继续用 ProviderConfig 自己的 apiKey/apiUrl
--   - 现有 relay-* 8 个 provider 自动关联到默认 "moyu" RelayProvider(数据迁移)

-- ===========================================================================
-- 1. 创建 relay_providers 表
-- ===========================================================================

CREATE TABLE "relay_providers" (
  "id"              TEXT PRIMARY KEY,
  "name"            TEXT NOT NULL UNIQUE,
  "displayName"     TEXT NOT NULL,
  "apiUrl"          TEXT,
  "catalogKey"      TEXT,
  "apiKeyEnc"       TEXT,
  "apiKeyMasked"    TEXT,
  "apiKeyUpdatedAt" TIMESTAMP(3),
  "apiKeyUpdatedBy" TEXT,
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);

-- ===========================================================================
-- 2. provider_configs 加 relayProviderId 列 + FK + Index
-- ===========================================================================

ALTER TABLE "provider_configs"
  ADD COLUMN "relayProviderId" TEXT;

ALTER TABLE "provider_configs"
  ADD CONSTRAINT "provider_configs_relayProviderId_fkey"
  FOREIGN KEY ("relayProviderId") REFERENCES "relay_providers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "provider_configs_relayProviderId_idx"
  ON "provider_configs"("relayProviderId");

-- ===========================================================================
-- 3. 数据迁移:把现有 relay-* provider 关联到默认 "moyu" RelayProvider
-- ===========================================================================

-- 3.1 创建默认 "moyu" RelayProvider(若已存在跳过)
-- apiUrl + apiKey 从现有第一个 hasKey 的 relay-* provider 继承
DO $$
DECLARE
  v_moyu_id TEXT;
  v_first_relay RECORD;
BEGIN
  -- 找第一个 hasKey 的 relay-* provider(用户之前配过 token 的)
  SELECT "apiUrl", "apiKeyEnc", "apiKeyMasked", "apiKeyUpdatedAt", "apiKeyUpdatedBy"
    INTO v_first_relay
    FROM "provider_configs"
   WHERE "providerId" LIKE 'relay-%' AND "apiKeyEnc" IS NOT NULL
   ORDER BY "apiKeyUpdatedAt" DESC NULLS LAST
   LIMIT 1;

  -- 生成 moyu RelayProvider id(用 timestamp + random 保 unique)
  v_moyu_id := 'rly_' || replace(gen_random_uuid()::text, '-', '');

  -- 插入(若已存在则不插)
  INSERT INTO "relay_providers" (
    "id", "name", "displayName", "apiUrl", "catalogKey",
    "apiKeyEnc", "apiKeyMasked", "apiKeyUpdatedAt", "apiKeyUpdatedBy",
    "isActive", "notes", "createdAt", "updatedAt"
  )
  VALUES (
    v_moyu_id,
    'moyu',
    'moyu.info(默认中转站)',
    COALESCE(v_first_relay."apiUrl", 'https://www.moyu.info/v1'),
    'moyu',
    v_first_relay."apiKeyEnc",
    v_first_relay."apiKeyMasked",
    v_first_relay."apiKeyUpdatedAt",
    v_first_relay."apiKeyUpdatedBy",
    true,
    'Phase 1.5.1 数据迁移自动创建 — 关联了所有 relay-* provider',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT ("name") DO NOTHING;

  -- 3.2 把所有 relay-* provider 的 relayProviderId 设为新创建的 moyu
  UPDATE "provider_configs"
     SET "relayProviderId" = (SELECT "id" FROM "relay_providers" WHERE "name" = 'moyu')
   WHERE "providerId" LIKE 'relay-%';
END $$;
