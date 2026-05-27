/**
 * Admin Router — 后台管理(仅 isAdmin 可访问)
 *
 * 三十一收工 R3 重构:2403 行单文件拆 15 个 sub-router 模块到 admin/ 子目录。
 * 主 admin.ts 只做 import + merge,新增 admin sub-router 在 admin/ 下加文件即可。
 *
 * 子路由列表:
 *   - admin.provider      AI Provider 配置(W2 重点:API Key 在此设置)
 *   - admin.relay         中转站多 token 管理(Phase 1.5.1)
 *   - admin.catalog       Provider catalog 静态目录
 *   - admin.dashboard     平台总览
 *   - admin.style         风格管理
 *   - admin.prompt        提示词模板
 *   - admin.preset        景别/机位/运镜/光线 预设
 *   - admin.system        系统设置(SystemSetting CRUD)
 *   - admin.binding       业务 binding(model/parser/style 绑定)
 *   - admin.episode       Episode 管理
 *   - admin.health        基础设施健康检查
 *   - admin.audit         OperationLog 审计
 *   - admin.apiUsage      API 用量统计 + 视频明细
 *   - admin.user          全局用户管理
 *   - admin.reports       工作报告
 *   - admin.dbExplorer    数据库表浏览(白名单)
 */
import { router } from '../trpc.js';

import { providerRouter } from './admin/provider.js';
import { relayRouter, catalogRouter } from './admin/relay.js';
import { styleRouter } from './admin/style.js';
import { promptRouter } from './admin/prompt.js';
import { presetRouter } from './admin/preset.js';
import { systemRouter } from './admin/system.js';
import { bindingRouter } from './admin/binding.js';
import { episodeRouter } from './admin/episode.js';
import { healthRouter } from './admin/health.js';
import { auditRouter } from './admin/audit.js';
import { apiUsageRouter } from './admin/api-usage.js';
import { userRouter } from './admin/user.js';
import { reportsRouter } from './admin/reports.js';
import { dbExplorerRouter } from './admin/db-explorer.js';
import { dashboardRouter } from './admin/dashboard.js';

export const adminRouter = router({
  relay: relayRouter,
  catalog: catalogRouter,
  dashboard: dashboardRouter,
  provider: providerRouter,
  style: styleRouter,
  prompt: promptRouter,
  preset: presetRouter,
  system: systemRouter,
  binding: bindingRouter,
  episode: episodeRouter,
  health: healthRouter,
  audit: auditRouter,
  apiUsage: apiUsageRouter,
  user: userRouter,
  reports: reportsRouter,
  dbExplorer: dbExplorerRouter,
});
