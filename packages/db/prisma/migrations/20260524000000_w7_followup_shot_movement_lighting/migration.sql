-- W7 followup: Shot 表加 movement / lighting 两个 nullable 字段
-- 跟 admin.preset 4 大预设(framing/angle/movement/lighting)对齐
-- 零数据迁移风险:nullable 字段历史行自动 NULL
ALTER TABLE "shots" ADD COLUMN "lighting" TEXT,
ADD COLUMN "movement" TEXT;
