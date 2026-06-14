/**
 * Storyboard Router — 分镜工坊（W3）
 *
 * 子模块边界：
 *   - Episode 级聚合 listEpisodes
 *   - Scene 级 listScenes（剧本场号）
 *   - Shot 级 CRUD
 *   - Group 级 merge / split / update
 *   - 整集 generate（剧本 → 单镜 + 提示词，一次性 LLM 调用）
 *   - publishEpisode 触发 EVENTS.STORYBOARD_PUBLISHED
 *   - recordEdit 把手改入 PromptEdit 表（训练数据集源）
 *
 * 机械重构(ADR-31):~1847 行 god 路由按组拆到同目录 sibling(episode / scene / shot /
 *   group / generate),共用 helper / schema / 常量在 storyboard-shared.ts。本文件只做组装
 *   —— 把各组 procedures spread 回 storyboardRouter,对外签名 / 行为完全不变。
 */
import { router } from '../trpc.js';

import { episodeProcedures } from './storyboard-episode.js';
import { sceneProcedures } from './storyboard-scene.js';
import { shotProcedures } from './storyboard-shot.js';
import { groupProcedures } from './storyboard-group.js';
import { generateProcedures } from './storyboard-generate.js';
import { exportProcedures } from './storyboard-export.js';

// ---------------------------------------------------------------------------
// Router(各 procedure 见同目录 storyboard-<组>.ts;共用 helper / schema / 常量见 storyboard-shared.ts)
// ---------------------------------------------------------------------------

export const storyboardRouter = router({
  ...episodeProcedures,
  ...sceneProcedures,
  ...shotProcedures,
  ...groupProcedures,
  ...generateProcedures,
  ...exportProcedures,
});
