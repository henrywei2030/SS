# 开发日志

> 按日期倒序，最新在最上方
> 仓库：https://github.com/henrywei2030/SS

---

## 2026-05-23(周六,mac-studio · 七次收工)— 跨设备协作工作流升级 + Win 笔记本接入方案

**完成**
- ✅ **多设备协作 SOP 升级**(CLAUDE.md):
  - 双端 → 多端,新增「设备登记表」(mac-mini / mac-studio / win-laptop)+ 跨设备数据矩阵
  - 按用户决策**统一为「开工/收工」两态**,删除原"换设备"独立协议(简化心智 — 离开当前设备必 commit + push)
  - 强化破坏性命令清单(rm / force push / 改 .gitignore / 改 git config / 跑 migration 仍需点头)
- ✅ **跨平台工具链落地**:
  - [scripts/init-env.mjs](scripts/init-env.mjs) — 一键生成 `.env.local` + `JWT_SECRET` / `APP_MASTER_KEY`(替代 BSD `sed`,Node `crypto.randomBytes` 三平台通用,幂等)
  - [scripts/preflight.mjs](scripts/preflight.mjs) — 30 秒开工自检(node ≥20.18 / pnpm ≥9 / Docker / .env / node_modules / git 工作区 / git 远程同步)
  - `package.json` 加 `pnpm setup:env` + `pnpm preflight`
  - 修了 preflight 的 Docker 检测 bug(stdio:ignore 时 run helper 触发 null.trim)
- ✅ **Win 笔记本完整接入方案** — 新建 [docs/SETUP-WINDOWS.md](docs/SETUP-WINDOWS.md):
  - PowerShell 7 + Docker Desktop 原生路径(WSL2 作为附录 A 可选)
  - 11 步首次拉起(按用户决策:API Key 留到系统构建完成后录入,首次拉起精简)
  - Win 专属常见问题(corepack / 长路径 / OneDrive 同步 / Defender / GBK 编码 9 项)
  - 出差携带 checklist(改:删 API Key 同步项,加 GitHub 账户对齐项)
  - **附录 B 新增:GitHub 账户对齐**(`git config --global user.name/email` + `gh auth login` 三步)
- ✅ **文档收口**:
  - [docs/HOME-SETUP.md](docs/HOME-SETUP.md) 加跨设备 banner + 删 BSD `sed` 命令换成跨平台脚本 + 删 API Key 录入步骤
  - [QUICKSTART.md](QUICKSTART.md) 顶部加平台分流导航 + 用脚本替换 `sed`
  - [TODO.md](TODO.md) 跨设备验证升级为多端,勾完 mac-studio 验证 2 项 + 留 Win 待办 + 加 GitHub 对齐待办
- ✅ **GitHub 账户对齐诊断**:
  - 现状:全局 `~/.gitconfig` 文件不存在,`git config --global user.name/email` 全空
  - 但历史 commit author 一直是 `henrywei2030 <henrywei1624@gmail.com>` — 说明之前一直靠 Claude Code 临时注入,身份未持久化
  - `osxkeychain` helper 已就位但 `security find-internet-password -s github.com` 查不到(可能在专用 keychain item)
  - `gh` CLI 未登录
  - 本次 commit 用 `git -c user.name=... -c user.email=...` 临时身份完成(遵守"不擅自改 git config"硬规则)
  - 一键固化命令已准备给用户(见本次会话末)
- ✅ **脚本现场验证**:`pnpm setup:env`(密钥幂等保留)+ `pnpm preflight`(7/7 项检查全绿,git 未提交变更仅 warning)

**进行中**
- 🚧 W5.1 UI 骨架(4 列布局产品形态待决策)— 主线挂起,等出差回来或在 Win 上启动
- 🚧 Win 笔记本现场首次拉起验证 — 明天出差到达后做

**问题 / 待决策**
- ❓ GitHub 账户身份是否要永久固化到 `~/.gitconfig`?(我无法擅自改 git config,需要用户手动跑命令或显式授权一次)
- ❓ W5.1 产品形态(主交互节奏)

**下次接着做**
- 📌 (出差路上)在 Win 笔记本按 [docs/SETUP-WINDOWS.md](docs/SETUP-WINDOWS.md) 11 步首次拉起
- 📌 Win 上跑 `pnpm preflight` 应全绿 + GitHub 账户对齐(附录 B)
- 📌 在 Win 上说 `开工,在 win-laptop` 验证接续 SOP 是否丝滑
- 📌 待 Win 验证完,回归 W5.1 主线

---

## 2026-05-22(周五,公司 Mac Mini · 六次收工)— W5.0 视频生成数据底座

**完成**
- ✅ **W5.0.1 SystemSetting 加 4 条 video 配置**(共 21 → 25 条):
  - `binding.shot.video.providerId` = seedance-2.0(快速档可改 seedance-2.0-fast)
  - `shot.video.maxDurationS` = 10 / `defaultAspectRatio` = 9:16(短剧竖屏)/ `dailyBudgetCny` = 500(预算护栏)
- ✅ **W5.0.2 [packages/core/storyboard/video.ts](packages/core/storyboard/video.ts) compileShotVideoPrompt 拼接公式**:
  - 8 段顺序拼接:风格 → 角色 → 场景 → 道具 → 镜头内容 → 视频描述 → 镜头语言 → 时长/宽高比
  - aspectRatio 默认 9:16,durationS clamp [5默认, 10上限],forbiddenWords ∪ extraNegative 去重
  - 资产 description 优先 fallback prompt,缺段不留空行
  - **18 个 happy/缺段/clamp/合并去重 单测全过**
- ✅ **W5.0.3 GenerationAttempt 加 providerJobId 字段**:
  - Seedance 等异步 Provider(create→poll)的任务 ID 存档
  - 客户端轮询 / W5.3 BullMQ worker 复用同一字段(架构提前对齐)
  - migration `20260522082406_w5_0_video_foundation`(单字段 additive 安全)
- ✅ **审计上下文确认**:agent 报告 GenerationAttempt + MediaItem + IVideoProvider + SeedanceProvider 都已就绪(W4 已铺路),W5.0 真正缺口很窄,这次精准补齐
- ✅ **2 commits + push**:
  - `5356a27` feat(w3.1.followup) Episode 软锁
  - `72cb995` feat(w5.0) 视频生成数据底座
- ✅ **质量**:7 包 typecheck 全绿 / **60 单测全过**(35 core + 25 api)/ 30 张表 + 10 migrations / 25 SystemSetting
- ✅ **docs 同步**:04-data-model 加 providerJobId 字段说明,03-roadmap W5 状态从 📋 改 🚧

**进行中**
- 🚧 W5.1 UI 骨架 — 4 列布局产品形态待决策(表格式 / 详情面板 / 混合)

**问题 / 待决策**
- ❓ W5.1 产品形态(主交互节奏)需用户决策
- ❓ W5.3 BullMQ vs 客户端轮询的执行模型 — providerJobId 字段已铺,具体由 W5.3 阶段决定

**下次接着做**
- 📌 W5.1:用户决策产品形态后开干 UI 骨架
- 📌 或先回 Mac Studio 验证跨设备接续(`git pull` → "开工"看是否能丝滑接手)

---

## 2026-05-22(周五,公司 Mac Mini · 五次收工)— W3.1.followup 软锁(Episode.status='GENERATING' 防重入)

**完成**
- ✅ **W3.1.followup Episode 软锁交付** — 解决 generateForEpisode 并发重入双重扣费风险:
  - Schema:EpisodeStatus 加 `GENERATING` 枚举值 + Episode 加 `generatingStartedAt DateTime?` 字段
  - Migration:`20260522075846_w3_followup_episode_soft_lock`(两行 SQL,additive 安全)
  - 新 helper [packages/api/src/utils/episode-lock.ts](packages/api/src/utils/episode-lock.ts):
    - `acquireEpisodeLock` — 事务内 `pg_advisory_xact_lock` 串行化抢锁,CAS 设 GENERATING + 戳 startedAt;15 分钟 stale TTL 自愈(进程崩溃也不会永远卡死)
    - `releaseEpisodeLock` — 仅当 status==GENERATING 才回滚到 previousStatus(防外部 force-unlock 后误改)
    - `isEpisodeLockedNow` — 纯函数,publishEpisode 用
  - generateForEpisode:入口 acquire + try/finally release;失败 log 不掩盖原始错误
  - publishEpisode:本集 fresh GENERATING 拒绝发布(防发布到一半数据)
  - admin.episode.forceUnlock 端点:逃生口,只允 GENERATING → NOT_STARTED,写 OperationLog 可审计
- ✅ **14 个并发场景单测**(覆盖 6 个分支)— [packages/api/src/utils/episode-lock.test.ts](packages/api/src/utils/episode-lock.test.ts):
  - 抢锁 from NOT_STARTED/IN_PROGRESS / fresh GENERATING 抢锁失败 / stale 自愈 / orphan(GENERATING+null startedAt)/ 集不存在 NOT_FOUND
  - 连续两次抢锁模拟并发请求 / release 正常还原 / 外部 force-unlock 后 release no-op
  - isEpisodeLockedNow 各分支(fresh/stale/orphan/NOT_STARTED/IN_PROGRESS 残留 startedAt)
- ✅ **修了 @ss/api 测试脚本**:原本 `vitest run --passWithNoTests` 在包目录下找不到测试文件(配置 include 用了 `packages/**` 相对根目录),改成 `--config=/dev/null` 走默认 scan
- ✅ 质量:7 包 typecheck 全绿 / **73 单测全过**(原 59 + 新 14 lock)/ 29 张表 + 9 migrations

**进行中**
- 🚧 W5.0 启动准备(分步骤做)— AIGC 抽卡数据底座

**问题 / 待决策**
- ❓ 无 — 软锁方案干净落地

**下次接着做**
- 📌 W5.0 数据底座:GenerationAttempt 视频字段补全 + Shot 视频 mediaItem 槽位 + SystemSetting video 配置
- 📌 W5.1 后续:分镜级 4 列布局 UI 骨架

---

## 2026-05-22(周五,公司 Mac Mini · 四次收工 · 深夜)— W4 完整交付 + 6 轮 audit 修复 70 项

**完成**
- ✅ **W4 大改造 + 完整收尾**(W4-MM.0 → W4-MM.9 共 10 子任务):
  - W4-MM.0 数据建模大改:Asset 加 archetypeKey + 7 视角槽位字段(portraitMediaId/threeViewMediaId/sceneMain/Front/Left/Right/Back/PanoramaMediaId)+ maturity (L0-L5 enum) + lockedAt + 合规多 vendor 字段 + voiceMediaId+voiceModelId;新表 AssetUsageBinding(三层 episode/scene/shot + 10 档 UsageType);MediaItem 加 aspectRatio + viewKind;GenerationAttempt 加 candidateForSlot + rejected;ShotAssetRef 标 deprecated;新 migration w4_mm_asset_remodel
  - W4-MM.1 packages/core/asset/compile-prompt.ts 风格拼接公式 + 11 单测
  - W4-MM.2 assetRouter 大升级(20+ procedures:候选 + 出场绑定 + archetype 变体 + 锁定 + compilePrompt)
  - W4-MM.3 资产卡片升级(出场集 group by episode + 成熟度 chips + 合规盾)
  - W4-MM.4 编辑弹窗三栏重构(~1000 行:左信息 / 中生成预览 / 右已确认槽位)
  - W4-MM.5 候选图 metadata 弹窗(模型/比例/提示词/同款/删除)
  - W4-MM.6 MockImageProvider 接入(picsum 占位 + storageKey placeholder://)
  - W4-MM.7 archetypeKey 分组 UI(同人物多变体)
  - W4-MM.8 按集补充 + 缺口检测 dialog
  - W4-MM.9 独立审计页 /art/audit(三类问题:无资产 / 0 绑定 / 悬空 binding)
- ✅ **6 轮 audit + 全栈 audit**(W3/W4 已多轮,W1+W2 首次)— 共找出 **171 项问题**,修复 **70 项 P0/P1**:
  - W4 4th audit:9 项 P0(maturity 重算 / publishEpisode 状态保护 / CSV 重组 / mergeShots 跨组孤儿)
  - W1+W2+跨栈:12 项(admin seed 永远登不上 / project.clone 越权 / local-fs 路径穿越 / login 开放重定向 / trpc HTTP→tRPC 完整映射 / deleteShot 不清 binding / generateImage 不写 CostLedgerEntry / PromptEdit 缺 scriptId / generateForEpisode 完整 stylePrompt)
  - 第 6 轮(2 个并行 agent + 52 项):11 项(rejectCandidate 粒度产品逻辑错 / confirmCandidate+unconfirmSlot+update+generateImage 事务化 / signup 默认关 / 密码强度 / admin prod 不回显 / local-fs Windows / shots-pane 批量 Promise.allSettled / lock onError / img lazy/onError / breakdown warning 透传)
- ✅ **5 个 commit 一气呵成**:f3d17e4(W4 大改造)→ 83d31a9(W4 完整收尾)→ c1d8792(4th audit)→ bafb960(全栈 audit)→ e4109e5(第 6 轮 audit)
- ✅ 质量:7 包 typecheck 全绿 / **59 单测全过**(48 core + 11 api)/ 21 SystemSetting(+1 auth.allowSignup)/ 28 张表 + 8 migrations

**进行中**
- 🚧 W5 启动准备(AIGC 抽卡引擎)
- 🚧 跨设备 Mac Studio 验证
- 🚧 真实剧本端到端业务验证

**问题 / 待决策**
- ❓ 真实 ImageProvider(NanoBanana / GPT Image)接入排期 — Phase 2?
- ❓ 火山合规 ComplianceProvider 排期 — Phase 2?
- ❓ Episode.status='GENERATING' 软锁(W3.1.followup)— 阻塞 W5 真发布?
- ❓ a11y / i18n 抽词 / 颜色 token 化 — 集中到 W7 polish?

**下次接着做**
- 📌 启动 W5 AIGC 抽卡引擎(基于已就绪的 W3 分镜 + W4 资产)
- 📌 或先真实业务验证(配 Claude API Key 跑 e2e)
- 📌 W3.1.followup 软锁 + 集成测试(W5 启动前必清)

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
