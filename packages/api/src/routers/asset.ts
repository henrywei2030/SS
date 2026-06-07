/**
 * Asset Router — 美术工作台(W4)
 *
 * 子模块:
 *   - 列表 / 详情 / 创建 / 更新 / 删除
 *   - 从剧本批量拆解(LLM)
 *   - 图像生成(占位 W4.5)
 *   - 合规检查(占位 W4.6)
 *
 * 训练集采集:对 description / prompt / name / alias 等字段的手改自动入 PromptEdit
 * (target=ASSET)。
 *
 * P2(ADR-31):2400 行 god 路由按组拆到同目录 sibling(crud / generate / breakdown /
 *   candidates / bindings),helper / schema / 常量在 asset-shared.ts。本文件只做组装
 *   —— 把各组 procedures spread 回 assetRouter,对外签名 / 行为完全不变。
 */
import { router } from '../trpc.js';

import { crudProcedures } from './asset-crud.js';
import { generateProcedures } from './asset-generate.js';
import { breakdownProcedures } from './asset-breakdown.js';
import { candidatesProcedures } from './asset-candidates.js';
import { bindingsProcedures } from './asset-bindings.js';

// ---------------------------------------------------------------------------
// Router(各 procedure 见同目录 asset-<组>.ts;helper / schema / 常量见 asset-shared.ts)
// ---------------------------------------------------------------------------

export const assetRouter = router({
  ...crudProcedures,
  ...generateProcedures,
  ...breakdownProcedures,
  ...candidatesProcedures,
  ...bindingsProcedures,
});
