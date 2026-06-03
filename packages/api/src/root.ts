/**
 * 根 Router — 聚合所有子模块路由
 *
 * 客户端调用形如：trpc.project.list / trpc.admin.provider.setApiKey
 */
import { router } from './trpc.js';
import { authRouter } from './routers/auth.js';
import { meRouter } from './routers/me.js';
import { projectRouter } from './routers/project.js';
import { scriptRouter } from './routers/script.js';
import { inspirationRouter } from './routers/inspiration.js';
import { storyboardRouter } from './routers/storyboard.js';
import { assetRouter } from './routers/asset.js';
import { aigcRouter } from './routers/aigc.js';
import { insightsRouter } from './routers/insights.js';
import { adminRouter } from './routers/admin.js';
import { i18nRouter } from './routers/i18n.js';
import { mediaRouter } from './routers/media.js';

export const appRouter = router({
  auth: authRouter,
  me: meRouter,
  project: projectRouter,
  script: scriptRouter,
  inspiration: inspirationRouter,
  storyboard: storyboardRouter,
  asset: assetRouter,
  aigc: aigcRouter,
  insights: insightsRouter,
  admin: adminRouter,
  i18n: i18nRouter,
  media: mediaRouter,
});

export type AppRouter = typeof appRouter;
