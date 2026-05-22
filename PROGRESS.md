# 开发日志

> 按日期倒序，最新在最上方
> 仓库：https://github.com/henrywei2030/SS

---

## 2026-05-22（周五，公司 Mac Mini · 三次收工）— W4 Asset Forge 骨架交付 + W3 第三轮 audit 修

**完成**
- ✅ **W3 第三轮 audit**:11 项发现,修 4 真 bug(mergeShots 跨组孤儿 / publishEpisode 重发布 / CSV 重组织 / max positionIdx 含 soft-del) + **整剧批量分析升级空间预留**(ScriptAnalysis scope/scriptId-nullable/projectId/episodeIds[]/perEpisodeStats/comparisonJson + analyzeProject 占位 + GenerationAction.BATCH_ANALYSIS enum)
- ✅ **W4.0** SystemSetting 加 7 条 W4 配置(LLM/Image/Compliance binding + 业务参数)
- ✅ **W4.1** packages/core/asset/breakdown.ts:LLM 输出 characters/scenes/props 严格基于原文 + 8 单测(类型分组/最大数截断/字段过滤)
- ✅ **W4.2** assetRouter 11 procedures(list/get/create/batchCreate/update/delete/breakdown LLM/generateImage 占位/complianceCheck 占位/setComplianceManually)+ PromptEdit target=ASSET 训练集
- ✅ **W4.3** art-workspace.tsx 顶部 4 类型 tab(URL ?type= 同步)+ 卡片网格 + 人物按主演/配角/群演自动分组 + asset-card.tsx 含合规 badge
- ✅ **W4.4** asset-edit-dialog(create+update 双态)+ breakdown-dialog(选 episode → LLM → 预览 → 复选 → 批量入库)
- ✅ 2 个新 migration(`script_analysis_scope` + `asset_prompt_edit_target`)
- ✅ 7 包 typecheck 全过 / **48 单测全过**(原 40 + breakdown 8) / 28 张表 + 20 条 SystemSetting

**进行中**
- 🚧 W4.5 图像生成接入(NanoBanana 主形象/三视图 + GPT Image 全景)
- 🚧 W4.6 火山合规 ComplianceProvider 实装

**问题 / 待决策**
- ❓ 临时新功能待用户明确需求(用户提及收工后需加新功能)
- ❓ NanoBanana / 火山合规 真实 API endpoint + 文档需确认
- ❓ MediaItem 存储链路(MinIO upload → CDN url)等 W4.5 接入时一并实测

**下次接着做**
- 📌 用户先讲新功能需求
- 📌 然后回到 W4.5 / W4.6 真实接入
- 📌 真实剧本端到端验证

---

## 2026-05-22（周五，公司 Mac Mini · 二次收工）— W3 收尾(W3.6 + W3.7)

**完成**
- ✅ **W3.6 行内编辑入训练集**:edit-dialog.tsx 含 ShotEditDialog + GroupEditDialog,改 framing/angle/content/prompt + diffNote;每行 ✎ 按钮;保存写 PromptEdit + toast 反馈
- ✅ **W3.7 polish**:字号 A-/A+ 8 档(11-18px) + localStorage 持久化 + CSS var 注入;顶部进度条 X/Y 镜;CSV 导出(UTF-8 BOM 让 Excel 正确识别)
- ✅ 7 包 typecheck 全过 / 40 单测全过

**进行中**
- 🚧 W3 手动业务验证(配 Claude API Key 跑 e2e)
- 🚧 跨设备 Mac Studio 验证

**问题 / 待决策**
- ❓ Episode.status='GENERATING' 软锁 + 集成测试(followup,不阻塞)
- ❓ xlsx 真格式导出(目前 CSV,Excel 兼容但不是原生 xlsx;若 W4+ 用户要求再加 ExcelJS)

**下次接着做**
- 📌 跨设备验证 + 真实剧本 e2e
- 📌 W4 Asset Forge 启动

---

## 2026-05-22（周五，公司 Mac Mini · 收工）— W3 分镜工坊大块交付（W3.0 → W3.5）

**完成**
- ✅ **W3.0 数据底座**：Prisma schema 加 3 表（Scene / ShotGroup / PromptEdit）+ Shot.sceneId/groupId + 3 个新 migration；SystemSetting 加 7 条 W3 配置；剧本 parser（packages/core/script/parse.ts）+ 12 单测；LLM 分镜生成器（packages/core/storyboard/generate.ts）
- ✅ **W3.1 storyboardRouter**：11 个 procedures（listEpisodes 含聚合 / mergeShots / splitGroup / generateForEpisode / publishEpisode 等）挂到 root router
- ✅ **W3.2 剧本版本子系统**：Script.isCurrent + lockedAt + @@unique([episodeId, version])；scriptRouter 重写 createNextVersion 事务模型（pg_advisory_xact_lock）+ 新增 listVersions / setCurrentVersion / lockVersion / getById
- ✅ **W3.2.ext 多格式上传**：scriptRouter.uploadFile 通用化（docx / txt / md / rtf / html），新工具 utils/script-extract.ts 各自做格式去标 + 11 个单测覆盖含嵌套绕过攻击
- ✅ **W3.3 admin 模型用途绑定**：admin.binding 后端（list / set，带 ProviderKind 校验）+ 前端 `/admin/bindings` 页面 + sidebar 入口
- ✅ **W3.4 前端三栏布局**：apps/web/.../director/storyboard/ 完整骨架（5 组件 — workspace / sidebar / top-bar / script-pane / shots-pane）；URL ?ep=&tab= 实时同步；director 首页"分镜工坊"卡解锁
- ✅ **W3.5 分镜表合并/拆分交互**：多选 checkbox + 顶部操作栏（向上/向下/勾选合并/删除/清空）+ 组级 [拆分] 按钮 + sticky 表头 + 切集自动清空选中
- ✅ **两轮 code-review agent 独立审计共 54 项,关键 P0 全修**：第一轮 P0 8 项 + P1 9 项；第二轮 P0 11 项（主流程切集崩 / pg_advisory_xact_lock 防 unique race / RTF 栈式扫描 / HTML 循环到收敛防绕过 / FileReader 防内存爆 / docx zip bomb 5M 上限 / filename path traversal 防御 等）
- ✅ **质量**：7 包 typecheck 全过 / **40 单测全过** / 27 张表 + 14 条 SystemSetting 入库

**进行中**
- 🚧 W3.6 行内编辑提示词 → 自动写 PromptEdit 训练集（后端 mutation 已就绪,前端 UI 待做）
- 🚧 W3.7 polish — 字号 A-/A+ / xlsx 导出 / 进度条 8/61

**问题 / 待决策**
- ❓ Mac Studio 跨设备验证还没做（这一会话全在公司 Mac Mini）
- ❓ Episode.status='GENERATING' 软锁防重入扣费（已列 followup,不阻塞）
- ❓ storyboardRouter 集成测试（concurrent merge / split / generate race）

**下次接着做**
- 📌 **W3.6**：分镜表 prompt 编辑弹窗 / 行内编辑,触发 updateShot → PromptEdit 写训练集
- 📌 **W3.7**：字号调节 + 导出 xlsx + 顶部进度条
- 📌 **followup**：Episode 软锁 / 集成测试 / parse.ts 边界 case 测试
- 📌 跨设备验证(Mac Studio `git pull` + `pnpm dev`)

---

## 2026-05-21（周四，公司 Mac Mini · 晚 20:30 二次收工）— 规划体系 + 协议升级

**完成**
- ✅ **规划文档体系**：新增 `docs/` 8 份核心文档（共 2086 行）：README + 00-vision + 01-architecture + 02-modules + 03-roadmap + 04-data-model + 05-ADR + HOME-SETUP；覆盖愿景/架构/模块/路线图/数据/决策/操作指南完整闭环
- ✅ **协同保障**：明文写入"协同三大铁律"（规划只在 docs/ 改 / 改完必 push / 收工必传 Project 知识库）；项目外不再维护规划副本
- ✅ **CLAUDE.md "收工"协议升级**：从"等用户确认提交"→ "自动执行三连"；扫描范围扩展到所有 docs/ 文件；保留 push 失败 / merge conflict 时的安全门槛
- ✅ **GitHub 同步**：commit `e4e17b7` 已 push（规划文档体系）

**进行中**
- 🚧 等待用户在 claude.ai → SS Project 知识库重传 4-7 份文件（含 docs/）

**问题 / 待决策**
- ❓ Mac Studio（家）尚未验证 `git pull` + `pnpm dev` 完整跑通

**下次接着做**
- 📌 Mac Studio 跨设备验证（`git pull` + 跑 `pnpm dev` + 试 `/admin/providers` 填 API Key）
- 📌 **W3 启动**：搭建 Storyboard Studio 三栏布局
- 📌 验证新版"收工"协议是否顺畅

---

## 2026-05-21（周四，公司 Mac Mini · 晚 19:44 收工）— 协作工作流跑通

**完成**
- ✅ **TODO.md / PROGRESS.md 三件套到齐**：从 Downloads 占位版重写为 160 + 74 行实际版，反映完整 W1-W2 工作
- ✅ **Project 知识库上传包就绪**：4 份文件（CLAUDE.md / TODO.md / PROGRESS.md / README.md）已整理到 `/Users/jk/Downloads/SS-project-knowledge/`，附 `_README_先看我.md` 上传说明 + 换设备 checklist
- ✅ **GitHub 同步完成 5 次 commit**：first → README → CLAUDE.md → W2 大 commit → TODO/PROGRESS 文档体系
- ✅ **CLAUDE.md 协作协议首次完整跑通"收工"流程**（含 git diff review + 中文 commit message + push 后提醒）

**进行中**
- 🚧 等待用户在 claude.ai → SS Project 知识库重传 4 份文件（生效双端协同）

**问题 / 待决策**
- ❓ Mac Studio（家）尚未验证 `git pull` + `pnpm dev` 完整跑通
- ❓ 是否要把 Downloads 上传包做成脚本，下次"收工"时自动重新生成？

**下次接着做**
- 📌 **跨设备验证**：在 Mac Studio `git pull` 后能否正常 `corepack pnpm --filter @ss/web dev` 起来
- 📌 **W3 启动**：搭建 Storyboard Studio 三栏布局 + AI 分镜生成
- 📌 **填 API Key**：进 `/admin/providers` 把 Seedance / Claude 真实 key 加密入库

---

## 2026-05-21（周四，公司 Mac Mini · 下午）— W1 + W2 + UI 集中交付

**完成**
- ✅ **W1 基础设施全部 10 子任务交付**（monorepo / Prisma 24 表 / 三大 Adapter / Cost Ledger / Docker / 核心算法 17 测试 / API Key 加密 / i18n / 品牌定名 / DB Explorer 规划）
- ✅ **W2 应用层全部 7 子任务交付**（tRPC v11 + 6 路由 / Next.js 15 + Tailwind v4 / 登录 / Mission Control / `/admin/providers` / Story Compass + Claude LLM）
- ✅ **UI 系统三次迭代**：v1 暗金极光 → v2 Cursor 极简 → v3 双主题切换（明亮 / 深夜）；含 Logo 系统 + 字体 + Sonner + Skeleton
- ✅ **Phase 2 升级性基础设施**：`@ss/shared/events.ts` 46 个 EventBus topic + 共用 Zod schemas + THEMING.md 184 行指南
- ✅ **代码质量**：全 7 包 typecheck 通过、34 单元测试全过
- ✅ **数据库**：2 个 migration (init + add_apikey_enc_and_system_setting), 24 张表, 6 系统设置, 7 Provider, 3 风格, 3 Prompt 模板, 1 admin 已 seed
- ✅ **Docker**：3 容器（ss-postgres / ss-redis / ss-minio）健康运行
- ✅ **协作规范**：CLAUDE.md 132 行协作协议提交
- ✅ **GitHub 同步**：4 个 commit 已 push（first / README / CLAUDE.md / W2+UI 大 commit）

**进行中**
- 🚧 验证双设备协作工作流（待在 Mac Studio 端测试）
- 🚧 准备进入 W3 分镜工坊（Storyboard Studio）

**问题 / 待决策**
- ❓ Tauri 桌面端打包按计划 W7 才做，还是 W3-W4 同步推进？
- ❓ Y.js 实时协作的 Hocuspocus 服务器要单独部署还是嵌入 Next.js？
- ❓ Seedance / Claude API Key 还未配置进 `/admin/providers`，需要本人在两台机器分别配（或共享内部 API gateway）
- ❓ `*.tsbuildinfo` 是否要加入 `.gitignore`？当前被提交了，会有增量缓存噪声

**下次接着做**
- 📌 **首选 W3.1**：搭建 `apps/web/app/[locale]/(workspace)/projects/[id]/director/storyboard/` 三栏布局
- 📌 **W3.2**：实现 `storyboardRouter.generate` 调 Claude 把剧本拆成分镜
- 📌 **W3.3**：实现"向下合并"按钮（调用 W1.6 `mergeShots` 函数）
- 📌 **跨设备验证**：家里 Mac Studio `git pull` 后能否正常 `pnpm dev` 起来
- 📌 **填 API Key**：进 `/admin/providers` 把 Seedance / Claude 真实 key 加密入库

---

## 2026-05-21（周四，上午）— 初始化

**完成**
- ✅ 项目代码推送到 GitHub 仓库
- ✅ 创建 Claude Project「SS 项目 - 开发助手」
- ✅ 配置 Custom Instructions，定义开工 / 收工协作规则
- ✅ 建立 TODO.md 和 PROGRESS.md 文档体系
- ✅ 文件初版上传到 Project 知识库

**问题 / 待决策**（已在下午会话中解答）
- ❓ ~~是否需要把项目主要功能模块拆得更细，落到 TODO.md 里？~~ → ✅ 已按 W3-W8 拆完
- ❓ ~~是否需要加一份 `CONTRIBUTING.md` 说明协作规范？~~ → ⚪ 已用 CLAUDE.md 覆盖

---

<!--
新日志在上方追加新条目即可。
模板：

## YYYY-MM-DD（周X，设备名）

**完成**
- ✅

**进行中**
- 🚧

**问题/待决策**
- ❓

**下次接着做**
- 📌

---
-->
