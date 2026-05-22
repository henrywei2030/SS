# 项目任务清单 · StarsAlign Studio / 星垣工坊

> 最后更新：2026-05-22(深夜·五收工)
> 仓库：https://github.com/henrywei2030/SS

---

## 🚧 进行中

- [ ] **W5.0 数据底座**(下一步) — schema 加 GenerationAttempt 视频字段 + Shot 视频 mediaItem 槽位 + SystemSetting 加 video 配置;分步骤推进
- [ ] **W5.1+** — AIGC 抽卡引擎
  - 分镜级 4 列布局(资产关联 / 原始剧本 / 视频提示词 / 视频预览)
  - 自动 @ 资产匹配(W1.6 auto-match 算法已就绪)
  - Seedance 抽卡 + 历史记录 + 重抽
  - BullMQ video-gen worker + 实时进度推送

- [ ] **跨设备协作工作流验证**(Mac Studio 端)
  - 待：在家 Mac Studio `git pull` + 登录同一 Project + 说"开工"验证接续

- [ ] **手动业务验证 W3 + W4**(任一设备)
  - 配 Claude API Key → 跑剧本上传 + generateForEpisode + asset.breakdown
  - 看 LLM 输出质量(真实剧本"陆乘 1-1")
  - 合并/拆分 + 行内编辑全套手动测试
  - 资产生成 mock 链路完整跑通(picsum 占位图能渲染)
  - 确认发布触发 EventBus event(消费端 W5 才接)

- [ ] **W4 真实 ImageProvider 接入**(从 mock 替换)
  - NanoBanana / GPT Image / 豆包图像 实装 — Phase 2
  - 当前 MockImageProvider 已让全链路跑通,真接入只改 getImageProvider 内的 switch

- [ ] **W4 火山合规真实接入**
  - ComplianceProvider 实装 — Phase 2(setComplianceManually 过渡中)

---

## 📋 待办

### 🔧 环境与基础设施
- [ ] 在 Mac Studio（家）拉取仓库验证 `git pull` 流程
- [ ] 确认两台设备 Node 24.x / pnpm 9.x / Docker 29.x 一致
- [ ] 家里 Mac Studio 准备 `.env.local`（JWT_SECRET / APP_MASTER_KEY 可重新生成）
- [ ] `*.tsbuildinfo` 加到 `.gitignore`（避免增量编译缓存噪声被提交）

### 📐 W3 / W4 followup(不阻塞下阶段)
- [x] **Episode.status='GENERATING' 软锁**防 generateForEpisode 重入扣费(W3.1.followup) — 2026-05-22(五收工)
- [ ] **storyboardRouter / assetRouter 集成测试**(mergeShots / splitGroup / confirmCandidate 并发场景 — generate 已覆盖)
- [ ] parse.ts 边界 case 测试("时间:xxx"误识场景)
- [ ] PromptEdit 加 Project / Episode / Script `@@index` 反向外键
- [ ] 单 shot durationS > maxDurationS 时算法的明确处理
- [ ] storyboard.generateForEpisode 并发限流(p-limit 3)+ 流式进度
- [ ] `listBindings batch` 端点 — art-workspace 100 张卡 N+1 性能
- [ ] OperationLog action 命名规范化(asset.create / asset.binding.create / image.generate 混风)
- [ ] a11y aria-label / focus trap / ESC 关闭(Dialog/img/icon-button)
- [ ] 替换 20 处硬编码颜色(emerald/rose/amber)→ CSS 变量 跟主题
- [ ] CandidateInfoDialog 大图 loading skeleton(慢网络体验)
- [ ] CharacterRole enum 中文 → 改英文 + UI label map(i18n 友好)
- [ ] OperationLog action 中英混用错误消息统一(用户面向中文 / 日志 code 英文)
- [ ] DateTime locale 强制 zh-CN → 跟用户 locale

### 📐 Phase 1 已规划但暂未做的小项
- [ ] `apps/desktop/` Tauri 包装（计划 W7，目前空目录占位）
- [ ] `packages/workers/` BullMQ 视频生成 worker（W5 主题）
- [ ] `packages/ui/` 跨 web/desktop 共享 UI（Phase 2）
- [ ] OG 分享图 `apps/web/public/logo.png` 放置

### 🚀 开发任务（W4 - W8）

#### W4 · Asset Forge(美术工作台,**完整交付** 含 W4-MM 大改 + 6 轮 audit)
- [x] **W4.0** SystemSetting 加 7 条 W4 配置 — 2026-05-22
- [x] **W4.1** packages/core/asset/breakdown.ts 拆解算法 + 8 单测 — 2026-05-22
- [x] **W4.2** assetRouter 11 procedures + 同名重检测 + PromptEdit 训练 — 2026-05-22
- [x] **W4.3** art-workspace.tsx 顶部 4 类型 tab + 卡片网格 + 分组 — 2026-05-22
- [x] **W4.4** asset-edit-dialog + breakdown-dialog 完整闭环 — 2026-05-22
- [x] **W4-MM.0** Asset 数据建模大改:archetypeKey + 7 视角槽位 + AssetUsageBinding + maturity L0-L5 — 2026-05-22
- [x] **W4-MM.1** packages/core/asset/compile-prompt.ts 拼接公式 + 11 单测 — 2026-05-22
- [x] **W4-MM.2** assetRouter 大升级(20+ procedures)+ computeMaturity helper — 2026-05-22
- [x] **W4-MM.3** 资产卡片升级 + 出场集 badge 联动 + 成熟度 chips — 2026-05-22
- [x] **W4-MM.4** 编辑弹窗三栏重构(~1000 行)— 2026-05-22
- [x] **W4-MM.5** 候选图 metadata 弹窗(模型/比例/提示词/同款/删除) — 2026-05-22
- [x] **W4-MM.6** MockImageProvider 接入(picsum 占位图,真接入路径已铺) — 2026-05-22
- [x] **W4-MM.7** archetypeKey 分组 UI(同人物多变体) — 2026-05-22
- [x] **W4-MM.8** 按集补充 + 缺口检测 dialog — 2026-05-22
- [x] **W4-MM.9** 资产-剧集二次匹配审计页 — 2026-05-22
- [x] **W4 4 轮 audit + 全栈 audit + 第 6 轮 audit** — 共修 28+ 项 P0/P1 — 2026-05-22
- [ ] 真实 ImageProvider 接入 — 见上方"进行中"
- [ ] 火山合规 ComplianceProvider 实装 — 见上方"进行中"
- [ ] 资产关系图谱(人物关系 / 场景空间相邻)— Phase 2

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
- [ ] README.md 增加 W1-W3 完成度徽章 + 路线图
- [ ] CHANGELOG.md（按 commit 自动生成）
- [ ] 视情况决定是否引入 issue 管理（GitHub Issues / Linear）

---

## ✅ 已完成

### 2026-05-22 — W3 全部交付（W3.0 → W3.7）

#### W3.6 · 行内编辑入 PromptEdit 训练集
- [x] edit-dialog.tsx 含 ShotEditDialog + GroupEditDialog,改 framing/angle/content/prompt + diffNote — 2026-05-22
- [x] Shot 行 / Group 行各加 ✎ 编辑按钮,保存自动 invalidate listShots — 2026-05-22
- [x] toast "改动已记录到 PromptEdit 训练集" — 2026-05-22

#### W3.7 · polish(字号 / 进度 / CSV 导出)
- [x] 字号 A-/A+ 8 档(11-18px),localStorage 持久化,CSS var `--storyboard-fs` 注入分镜表 — 2026-05-22
- [x] 顶部进度条 X/Y 镜(status != DRAFT 算已发布)— 2026-05-22
- [x] CSV 导出(组级合并 prompt + 单镜级 framing/angle/content/prompt,UTF-8 BOM)— 2026-05-22

### 2026-05-22 — W3 大块交付（W3.0 → W3.5）

#### W3.0 · 数据底座
- [x] **W3.0.1** Prisma schema 加 3 表（Scene / ShotGroup / PromptEdit）+ Shot 加 sceneId/groupId + 反向关系；3 个新 migration 已 apply — 2026-05-22
- [x] **W3.0.2** SystemSetting seed 加 7 条 W3 配置（4 个 model_binding + 3 个 storyboard 业务参数）— 2026-05-22
- [x] **W3.0.3** `packages/core/script/parse.ts` 剧本纯文本 parser（场号/时段/内外/人物/动作/对白/旁白）+ 12 个单测 — 2026-05-22
- [x] **W3.0.4** `packages/core/storyboard/generate.ts` LLM 分镜生成器 + warning 字段 + 自动按 index 排序 — 2026-05-22

#### W3.1 · storyboardRouter（11 procedures）
- [x] listEpisodes（含聚合）/ getEpisode / listScenes / listShots（grouped）/ createShot / updateShot / deleteShot — 2026-05-22
- [x] mergeShots（手动合并）/ splitGroup（soft-delete + 清 groupId 事务）/ updateGroup — 2026-05-22
- [x] generateForEpisode（自动拆场→调 LLM→预合并组）/ publishEpisode（触发 EVENTS.STORYBOARD_PUBLISHED）— 2026-05-22
- [x] 挂到 root router — 2026-05-22

#### W3.1.fix · Bug 修（两轮 code-review agent 独立审计共 54 项,修了 28 项关键）
- [x] **第一轮 P0 8 项**：mergeShots positionIdx unique race / splitGroup 缺事务 / publishEpisode 状态覆盖 / PromptEdit 写入数据集污染 / createShot|deleteShot logOperation 缺 projectId 等 — 2026-05-22
- [x] **第一轮 P1 9 项**：parse.ts 时段/dialog 正则严格化 / merge.ts 单 shot 超长 warning / generate.ts maxShotDurationS 一致 / recordPromptEdit 失败 log 加 requestId / ShotGroup.durationS 自动重算 / PromptEdit 加 episodeId 索引 — 2026-05-22
- [x] **第二轮 P0 11 项**：storyboard-workspace 切集主流程崩（useSearchParams 实时读）/ createNextVersion + autoMerge + mergeShots 加 pg_advisory_xact_lock 串行化防 unique race / stripRtf 栈式扫描正确处理嵌套 destructive group / stripHtml 循环到收敛防 `<scrip<script>t>` 绕过 / fileToBase64 改 FileReader.readAsDataURL 防内存爆 / filename zod path traversal 防御 / docx zip bomb 5M chars 硬上限 / ScriptPane 切集 reset selectedId / TopBar episodeNumber 自动同步左栏 — 2026-05-22

#### W3.2 · 剧本版本子系统
- [x] Schema 加 Script.isCurrent + lockedAt + @@unique([episodeId, version]) + Episode.scripts[] 反向关系 — 2026-05-22
- [x] scriptRouter 重写 createNextVersion 事务模型（advisory lock + isCurrent 切换原子化）— 2026-05-22
- [x] 新增 listVersions / setCurrentVersion / lockVersion / unlockVersion / getById endpoints — 2026-05-22

#### W3.2.ext · 多格式剧本上传
- [x] scriptRouter.uploadDocx → uploadFile 通用化 — 2026-05-22
- [x] packages/api/src/utils/script-extract.ts：统一提取入口，支持 docx/txt/md/rtf/html，各自做格式去标 — 2026-05-22
- [x] 11 个 extract 单测覆盖所有格式 + 嵌套绕过攻击 — 2026-05-22
- [x] 前端 input accept 扩展 + 大文件 FileReader 编码 — 2026-05-22

#### W3.3 · admin 模型用途绑定
- [x] admin.binding 后端 router（list / set，带 ProviderKind 校验）— 2026-05-22
- [x] 前端 `/admin/bindings` 页面（下拉切换 + provider 状态显示）+ sidebar 入口 — 2026-05-22

#### W3.4 · 前端三栏布局 + 剧本/分镜 tab
- [x] `apps/web/.../director/storyboard/` 完整骨架（5 组件）— 2026-05-22
- [x] storyboard-workspace.tsx 主框架（URL `?ep=&tab=` 实时同步）— 2026-05-22
- [x] episode-sidebar.tsx 左栏集卡（含聚合元信息：场/镜/组数）— 2026-05-22
- [x] top-bar.tsx tab 切换 + 上传剧本 / 生成分镜 / 确认发布按钮 — 2026-05-22
- [x] script-pane.tsx 剧本版本切换 + 内容浏览 — 2026-05-22
- [x] shots-pane.tsx 分镜表（组级展开式展示）— 2026-05-22
- [x] director 首页"分镜工坊"卡解锁 — 2026-05-22

#### W3.5 · 分镜表合并/拆分交互
- [x] 多选 checkbox + 选中态高亮 — 2026-05-22
- [x] 顶部操作栏（向上合并 / 向下合并 / 勾选合并 / 删除 / 清空）— 2026-05-22
- [x] 组级 [拆分] 按钮（soft-delete + 清 groupId）— 2026-05-22
- [x] 切集自动清空选中 / sticky 表头 — 2026-05-22

#### 质量验证
- [x] 7 包 TypeScript typecheck 通过 — 2026-05-22
- [x] **40 个单元测试全过**（W1.6 17 + 新 parser 12 + auto-match 9 + script-extract 11 + RTF/HTML 攻击防御 2 -3）— 2026-05-22
- [x] 27 张数据库表 + 14 条 SystemSetting 入库 — 2026-05-22

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
- [x] **规划文档体系**（docs/ 8 份共 2086 行：愿景/架构/模块/路线图/数据/ADR/指南）— 2026-05-21
- [x] **协同三大铁律**写入 docs/README.md — 2026-05-21
- [x] **"收工"协议升级**为自动执行模式（保留 push 失败 / merge conflict 安全门槛）— 2026-05-21

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
- **PromptEdit 训练数据集导出工具**（fine-tune 数据管道）— W6+

---

> 📌 **使用说明**
> - `[ ]` 未完成 / `[x]` 已完成
> - 完成后从"进行中 / 待办"剪切到"已完成"，并标注完成日期
> - 新任务先进"待办"，开始做时再移到"进行中"
> - 每次收工时让 Claude 帮你更新本文件并重新上传到 Project 知识库
