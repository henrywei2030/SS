-- StarsAlign Studio · Postgres 初始化扩展
-- 在容器首次启动时执行

-- 全文检索辅助（Phase 1 关键词搜索）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 主键 UUID（Prisma cuid 也常用，但保留 uuid_generate_v4 备用）
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Phase 2 向量检索预留（注释，需要时再启用）
-- CREATE EXTENSION IF NOT EXISTS vector;

-- Phase 3 时序数据预留
-- CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 中文全文检索（zhparser 需要额外安装，原型期暂不启用）
-- CREATE EXTENSION IF NOT EXISTS zhparser;

DO $$
BEGIN
  RAISE NOTICE '✓ StarsAlign Studio · Postgres 扩展初始化完成';
END $$;
