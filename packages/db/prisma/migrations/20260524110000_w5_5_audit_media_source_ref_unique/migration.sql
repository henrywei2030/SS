-- W5.5 第 2 轮 audit P1-2 / ADR-25 v3 L2 提前到 Phase 1:
-- MediaItem.sourceRef 加 partial unique 约束(只对 AIGC 来源 + 活跃行)
--
-- 漏洞场景:
--   processor.ts 的 idempotency check(checkIdempotency)防住了大部分 retry 双写,
--   但极端 race(idempotency check 自身 DB 查询抖动 throw → BullMQ 重试 → 进入成功路径
--   → 第二次 mediaItem.create 用同 sourceRef = attemptId)→ 真双写 MediaItem。
--   processor 层是 application-level 防御,schema-level partial unique 是双保险。
--
-- 设计:
--   - 仅对 source = 'AIGC' 的行 unique(其他 source 如 UPLOAD / ASSET_RELATED 不受影响)
--   - WHERE sourceRef IS NOT NULL — null 不参与 unique(public 库不带 sourceRef)
--   - WHERE deletedAt IS NULL — 软删后允许重新生成同 attempt 的 media(罕见,但保留可能)

CREATE UNIQUE INDEX IF NOT EXISTS "media_items_aigc_source_ref_uniq"
ON "media_items" ("sourceRef")
WHERE "source" = 'AIGC'::"MediaSource"
  AND "sourceRef" IS NOT NULL
  AND "deletedAt" IS NULL;
