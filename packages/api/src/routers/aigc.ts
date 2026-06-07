/**
 * AIGC Router — 视频生成工作台(W5.2)
 *
 * 模块边界:
 *   - 不重新拆生成段:1-8 / 9-18 直接复用 W3 ShotGroup 表
 *   - 不重写剧本 / 提示词:原始剧本 = Scene.content,提示词 = ShotGroup.prompt(由 W3 LLM 生成)
 *   - 资产关联用 W4 AssetUsageBinding 表(已加 shotGroupId + refSlotIdx 字段)
 *   - 视频拼接用 packages/core/storyboard/video.ts 的 compileShotGroupVideoPrompt
 *   - W5.2 不接 Seedance(留 W5.4),只做查询 + 自动匹配 + 自动@ + 预览
 *
 * 机械重构(ADR-31):~1847 行 god 路由按组拆到同目录 sibling(overview / prompt /
 *   bindings / video / groups),共用 helper(loadGroupOrThrow)在 aigc-shared.ts。
 *   本文件只做组装 —— 把各组 procedures spread 回 aigcRouter,对外签名 / 行为完全不变。
 */
import { router } from '../trpc.js';

import { overviewProcedures } from './aigc-overview.js';
import { promptProcedures } from './aigc-prompt.js';
import { bindingsProcedures } from './aigc-bindings.js';
import { videoProcedures } from './aigc-video.js';
import { groupsProcedures } from './aigc-groups.js';

// ---------------------------------------------------------------------------
// Router(各 procedure 见同目录 aigc-<组>.ts;共用 helper 见 aigc-shared.ts)
// ---------------------------------------------------------------------------

export const aigcRouter = router({
  ...overviewProcedures,
  ...promptProcedures,
  ...bindingsProcedures,
  ...videoProcedures,
  ...groupsProcedures,
});
