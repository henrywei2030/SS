-- 四八收工:灵感草稿顶置标记(需求1d)
-- pinned=true 的草稿在剧本子模块「关联剧本」选项中可见(需求1e),用户用来标记最满意的剧本。
-- additive,默认 false 不影响现有草稿。

ALTER TABLE "inspiration_drafts"
  ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
