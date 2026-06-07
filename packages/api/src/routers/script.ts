/**
 * Script Router — 剧本与剧本分析（W2.7 + W3.2 版本化）
 *
 * 版本子系统约定：
 *   - 同 episode 可有多个 Script 行，每个对应一个版本号 version（@@unique([episodeId, version])）
 *   - 任意时刻同 episode 至多一个 isCurrent=true（应用层事务保证）
 *   - lockedAt!=null 的版本只读，禁止 update / delete / setCurrent 之外的操作
 *   - 上传新内容总是 create new version，不再 update 旧版本
 *
 * 机械重构(ADR-31):~1145 行 god 路由按组拆到同目录 sibling(upload / version /
 *   analyze),共用 helper(loadScriptWithAccess)在 script-shared.ts。本文件只做组装
 *   —— 把各组 procedures spread 回 scriptRouter,对外签名 / 行为完全不变。
 */
import { router } from '../trpc.js';

import { uploadProcedures } from './script-upload.js';
import { versionProcedures } from './script-version.js';
import { analyzeProcedures } from './script-analyze.js';

// ---------------------------------------------------------------------------
// Router(各 procedure 见同目录 script-<组>.ts;共用 helper 见 script-shared.ts)
// ---------------------------------------------------------------------------

export const scriptRouter = router({
  ...uploadProcedures,
  ...versionProcedures,
  ...analyzeProcedures,
});
