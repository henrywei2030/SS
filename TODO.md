# 项目任务清单 · StarsAlign Studio / 星垣工坊

> 最后更新：2026-05-21
> 仓库：https://github.com/henrywei2030/SS

---

## 🚧 进行中

- [ ] **W3 · Storyboard Studio 分镜工坊**（下一阶段开工点）
  - 三栏 Linear 布局（集列表 / 剧本 / 分镜）
  - AI 生成分镜（基于 W2.7 已完成的 Story Compass 价值曲线）
  - "向下合并" 按 Provider `maxDuration` 动态判断（W1.6 算法已就绪）
  - 分镜发布 → 触发 `EVENTS.STORYBOARD_PUBLISHED` 给 AIGC
  - Y.js + Hocuspocus 实时协作试点（仅分镜表）

- [ ] **跨设备协作工作流验证**（Mac Studio 端）
  - ✅ 公司 Mac Mini 端三件套就绪 + 跑通"收工"流程
  - ✅ Project 知识库上传包已生成在 `~/Downloads/SS-project-knowledge/`
  - 待：在家 Mac Studio `git pull` + 登录同一 Project + 说"开工"验证接续

---

## 📋 待办

### 🔧 环境与基础设施
- [ ] 在 Mac Studio（家）拉取仓库验证 `git pull` 流程
- [ ] 确认两台设备 Node 24.x / pnpm 9.x / Docker 29.x 一致
- [ ] 家里 Mac Studio 准备 `.env.local`（JWT_SECRET / APP_MASTER_KEY 可重新生成）
- [ ] `*.tsbuildinfo` 加到 `.gitignore`（避免增量编译缓存噪声被提交）

### 📐 Phase 1 已规划但暂未做的小项
- [ ] `apps/desktop/` Tauri 包装（计划 W7，目前空目录占位）
- [ ] `packages/workers/` BullMQ 视频生成 worker（W5 主题）
- [ ] `packages/ui/` 跨 web/desktop 共享 UI（Phase 2）
- [ ] OG 分享图 `apps/web/public/logo.png` 放置（用户原 logo PNG）

### 🚀 开发任务（W3 - W8）

#### W3 · Storyboard Studio（分镜工坊）
- [ ] `apps/web/app/[locale]/(workspace)/projects/[id]/director/storyboard/` 三栏布局
- [ ] `storyboardRouter.generate` — 调用 Claude 生成分镜
- [ ] `storyboardRouter.publish` — 发布触发 EventBus event
- [ ] `storyboardRouter.mergeDown` — 应用 W1.6 merge 算法
- [ ] Y.js + Hocuspocus 集成（共享分镜表）
- [ ] 草图低成本预览（Nano Banana Fast）

#### W4 · Asset Forge（美术工作台）
- [ ] 人物资产页（三视图 + 火山合规通道 + 角色身份分类）
- [ ] 场景资产页（4 视图 + 360° 全景）
- [ ] 道具资产页（出场绑定）
- [ ] 资产拆解 4 步链（核心/配角/物种/群演 → merge）
- [ ] 火山合规 ComplianceProvider 实现

#### W5 · Generation Engine + Media Vault
- [ ] AIGC 集卡片 + 分镜级 4 列布局
- [ ] 自动 @ 资产匹配（复用 W1.6 auto-match 算法）
- [ ] Seedance 抽卡 + 历史记录 + 重抽
- [ ] BullMQ video-gen worker（异步生成）
- [ ] 实时进度推送（WebSocket / SSE）
- [ ] 素材库上传 / 搜索 / 收藏 / 批量

#### W6 · Insight Cockpit + Collab Hub
- [ ] 数据总览（30 天趋势 + 模型分布 + 项目费用 Top5）
- [ ] API 用量明细
- [ ] 抽卡率 Top10 镜头
- [ ] 成员 / 集数分配 / 进度总览 / 工作报告
- [ ] CRDT 实时协作扩展到资产卡

#### W7 · 后台 + 国际化 + 打磨
- [ ] Prompt 模板编辑器（含版本树）
- [ ] 风格管理 UI（AI 真人 / 3D 国漫 / 2D 动漫）
- [ ] 预设模板（景别 / 机位 / 运镜 / 光线）
- [ ] Tauri 桌面端打包
- [ ] EN 语言文案 review

#### W8 · 团队真实使用 + 紧急迭代
- [ ] 5 人冷启动会议（分配集数）
- [ ] 完成至少 1 集 7 镜头实战
- [ ] P0 / P1 bug fix
- [ ] 操作日志审计

### 📝 文档与协作
- [ ] 跑通一次完整的"开工 → 收工"流程，确认工作流顺畅
- [ ] README.md 增加 W1-W2 完成度徽章 + 路线图
- [ ] CHANGELOG.md（按 commit 自动生成）
- [ ] 视情况决定是否引入 issue 管理（GitHub Issues / Linear）

---

## ✅ 已完成

### 2026-05-21 — 一天集中完成 W1 + W2 + UI 升级

#### W1 · 基础设施（10 子任务）
- [x] **W1.1** Monorepo (pnpm workspace + Turborepo + TS base) — 2026-05-21
- [x] **W1.2** Prisma schema 24 张表 + 18 枚举 + 完整 seed — 2026-05-21
- [x] **W1.3** 三大 Adapter 接口（Storage / Provider / EventBus / Auth）— 2026-05-21
- [x] **W1.4** Cost Ledger 中间件（自动记账 + 预算护栏）— 2026-05-21
- [x] **W1.5** docker-compose（PG + Redis + MinIO）— 2026-05-21
- [x] **W1.6** 核心算法：storyboard/merge + generation/auto-match（17 测试）— 2026-05-21
- [x] **W1.7** API Key 后台加密存储（AES-256-GCM）— 2026-05-21
- [x] **W1.8** i18n CN/EN 基础设施（next-intl + 8 词条文件）— 2026-05-21
- [x] **W1.9** 品牌定为「星垣工坊 / StarsAlign Studio」— 2026-05-21
- [x] **W1.10** 自建 DB 浏览器规划（替代 Prisma Studio）— 2026-05-21

#### W2 · 应用层（7 子任务）
- [x] **W2.1** tRPC v11 框架（Context / Middleware / 3 procedure 类型）— 2026-05-21
- [x] **W2.2** 6 个子路由（auth / me / project / script / admin / i18n）— 2026-05-21
- [x] **W2.3** Next.js 15 + Tailwind v4 + shadcn UI 库 — 2026-05-21
- [x] **W2.4** 登录页 + TopNav + 语言切换器 — 2026-05-21
- [x] **W2.5** Mission Control（项目列表 + 详情）— 2026-05-21
- [x] **W2.6** `/admin/providers` API Key 管理 UI — 2026-05-21
- [x] **W2.7** Claude Text Provider + Story Compass 单集分析 — 2026-05-21

#### UI 系统升级
- [x] Cursor 风格全站重塑（去渐变 / 光晕，中性灰 + 蓝 accent）— 2026-05-21
- [x] Logo 系统（LogoMark + Wordmark + LogoLockup + favicon）— 2026-05-21
- [x] 双主题切换（明亮 #FFFFFF / 深夜 #1F1F1F）+ 防 FOUC — 2026-05-21
- [x] 后台字号系统（admin-pane +1px 提升可读性）— 2026-05-21
- [x] 品牌字体方案（Inter + Noto Sans SC）— 2026-05-21
- [x] Sonner Toast 全局通知 + Skeleton 骨架屏 — 2026-05-21

#### Phase 2 升级性基础设施
- [x] `@ss/shared/events.ts` 46 个 EventBus topic + 类型化 Payload — 2026-05-21
- [x] `@ss/shared/schemas/` 共用 Zod schemas（episode / compliance / voice / team）— 2026-05-21
- [x] `docs/THEMING.md` 184 行主题系统指南 — 2026-05-21
- [x] `docs/W2-admin-module-spec.md` 自建 DB Explorer 规划 — 2026-05-21

#### 文档与协作
- [x] CLAUDE.md 项目级协作规范 — 2026-05-21
- [x] TODO.md / PROGRESS.md 文档体系建立并集成到项目根 — 2026-05-21
- [x] 创建 Claude Project「SS 项目 - 开发助手」 — 2026-05-21
- [x] 配置 Custom Instructions，定义开工 / 收工协作规则 — 2026-05-21

#### 质量验证
- [x] 全 7 包 TypeScript typecheck 通过 — 2026-05-21
- [x] 34 个单元测试全过（adapters 8 + core 17 + i18n 9）— 2026-05-21
- [x] Docker 3 容器（ss-postgres / ss-redis / ss-minio）健康运行 — 2026-05-21

---

## 💡 想法池（idea backlog，暂不排期）

- 接入 LiteLLM 后统一所有 Provider 调用接口
- 引入 next-themes 替代手写 ThemeToggle（OS 偏好自动同步）
- 添加 ColorPicker 让企业租户自定义品牌色
- **Wireless Canvas（脑暴模式，画布拖拽分镜）** — Phase 3 旗舰
- 3D 一致性（Gaussian Splatting 数字分身）— Phase 3
- Distribution Hub（多平台发布 + 数据回流 ROI 分析）— Phase 3
- AI 多 Agent 对抗评审（Critic + Defender + Judge）— Phase 2
- Auto-Salvage 废片回收（从失败片段中截取可用段）— Phase 2
- 高对比 / 色弱友好 主题（无障碍）

---

> 📌 **使用说明**
> - `[ ]` 未完成 / `[x]` 已完成
> - 完成后从"进行中 / 待办"剪切到"已完成"，并标注完成日期
> - 新任务先进"待办"，开始做时再移到"进行中"
> - 每次收工时让 Claude 帮你更新本文件并重新上传到 Project 知识库
