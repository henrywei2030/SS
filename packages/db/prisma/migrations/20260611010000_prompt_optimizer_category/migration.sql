-- M6 动态 Prompt 优化(蓝图 docs/06 §5):PromptCategory 加 PROMPT_OPTIMIZER 枚举值
-- (优化器 meta-prompt 模板的归类;纯加枚举值,无数据变更)
ALTER TYPE "PromptCategory" ADD VALUE 'PROMPT_OPTIMIZER';
