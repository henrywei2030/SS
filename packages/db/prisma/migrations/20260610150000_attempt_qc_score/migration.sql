-- M3c QC 质检(蓝图 docs/06 §M3):GenerationAttempt 加 VLM 评分两列(可空,无数据回填需求)
-- qcScore: 0-100 总分;qcJson: 评分明细(维度分/漂移标记/判官模型)或失败 {error}
ALTER TABLE "generation_attempts" ADD COLUMN "qcScore" DOUBLE PRECISION;
ALTER TABLE "generation_attempts" ADD COLUMN "qcJson" JSONB;
