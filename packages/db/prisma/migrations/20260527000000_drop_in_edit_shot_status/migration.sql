-- 删除 ShotStatus 的 IN_EDIT 枚举值 — 剪辑模块已移除
--
-- 影响:
--   - 历史代码从未 SET status='IN_EDIT'(audit 确认),所以无现存数据需迁移
--   - project.ts listProjects 进度统计已改为 status IN ('ADOPTED','FINAL')
--   - i18n 翻译条目已删
--
-- PostgreSQL 删除枚举值需 ALTER TYPE ... RENAME + 新建 + 替换。
-- 但因没有数据用 IN_EDIT,直接 ALTER TYPE 不行 — PG 不支持 DROP VALUE。
-- 解决:重建类型 — 先重命名旧类型,新建无 IN_EDIT 的新类型,改表列引用,再 DROP 旧类型。

BEGIN;

-- Step 1: 安全断言 — 没有数据用 IN_EDIT(防意外丢数据)
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt FROM "shots" WHERE status::text = 'IN_EDIT';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'shots 表有 % 行 status=IN_EDIT,迁移中止 — 请先 UPDATE 为 ADOPTED 或 FINAL', cnt;
  END IF;
END $$;

-- Step 2: 重命名旧枚举类型
ALTER TYPE "ShotStatus" RENAME TO "ShotStatus_old";

-- Step 3: 创建新枚举类型(无 IN_EDIT)
CREATE TYPE "ShotStatus" AS ENUM (
  'DRAFT',
  'PUBLISHED',
  'QUEUED',
  'GENERATING',
  'GENERATED',
  'ADOPTED',
  'FINAL',
  'FAILED',
  'BUDGET_BLOCKED'
);

-- Step 4: shots 表 status 列迁移到新类型
ALTER TABLE "shots"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ShotStatus" USING "status"::text::"ShotStatus",
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Step 5: shot_groups 表 status 列同步迁移(如有该列)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shot_groups' AND column_name = 'status'
  ) THEN
    EXECUTE 'ALTER TABLE "shot_groups"
      ALTER COLUMN "status" DROP DEFAULT,
      ALTER COLUMN "status" TYPE "ShotStatus" USING "status"::text::"ShotStatus",
      ALTER COLUMN "status" SET DEFAULT ''DRAFT''';
  END IF;
END $$;

-- Step 6: 删除旧枚举类型
DROP TYPE "ShotStatus_old";

COMMIT;
