# 项目任务清单 · StarsAlign Studio / 星垣工坊

> 最后更新:2026-05-25(**二十二收工 · /admin/providers 多中转站架构 + 142 catalog + r22/r22.1 双重 audit + 批量测试脚本就绪**)
> 仓库:https://github.com/henrywei2030/SS
> **🚀 一键启动**:`pnpm start`(详见 [README.md](README.md#快速启动) / [CLAUDE.md](CLAUDE.md#设备登记))
> **📖 实战前必读**:[docs/W1-W7-followup.md](docs/W1-W7-followup.md)(P0 已完成,留 Phase 1.5/2/3 续做项)
> **📖 Phase 1.5 完整决议**:[docs/05-tech-decisions.md ADR-28](docs/05-tech-decisions.md) 7 段(§A-§G)

---

## 🚧 进行中

- [x] **W5.0 数据底座** — SystemSetting 4 条 + compileShotVideoPrompt 拼接公式 + GenerationAttempt.providerJobId — 2026-05-22(六收工)
- [x] **W5.0 修补**(Win-laptop · 八收工)— vitest 跨平台 / aspectRatio 空白 fallback / 9 段顺序断言 — 2026-05-23
- [x] **W1-W5 跨模块 audit P0 8 项**(Win-laptop · 八收工)— D1 partial unique / D2 publish 状态守卫 / A1 maturity 重算 / A2 archetypeKey 贯穿 / C1 script.upload 软锁 / B1 三入口 GenerationAttempt / B2 失败 ledger / B3 真单价 — 2026-05-23
- [x] **D1 migration 已跑**(Win-laptop · 九收工)— `20260523103000_audit_p0_assetusage_partial_unique` 应用 — 2026-05-23
- [x] **W5.1 schema + compileShotVideoPrompt token 化重写**(Win-laptop · 九收工)— AssetUsageBinding 加 shotGroupId+refSlotIdx / video.ts 重写 4 个 API(tokenFor / autoTagPromptWithReferences / compileShotGroupVideoPrompt / kindFromUsage)/ 19→39 单测 / migration `20260523113000_w5_1_assetusage_shotgroup_refslot` — 2026-05-23
- [x] **W5.2 v0 AIGC 单集工作台**(Win-laptop · 九收工)— aigc router 7 procedures + UI 左列表 + 右详情 4 区 + 自动匹配 / 自动 @ 可用 — 2026-05-23
- [x] **W5.2.1** 工作台 v1(十收工前已完成)— 关联素材 / 删除 binding / 编辑提示词 ✓;上传素材走 /art workaround
- [x] **W5.3** AIGC 集数总览页(十收工前已完成)— 5 集卡片 + 状态筛选 + 进度统计 + 创建集数 + project-overview nav 入口
- [x] **W5.4** Seedance 抽卡 router + Mock 兜底 + 视频预览(十收工前已完成)
- [x] **W5 P2 收尾**(L3 ADR / providerJobId unique / a11y / window.prompt→dialog)— 十收工前已完成
- [x] **W6.1 + W6.3 数据洞察 MVP**(十收工)— insightsRouter 3 procs + /insights 页(KPI / 日 cost 趋势 / kind 分布 / 模型分布 / Top10 group)+ 4 轮 audit P0 11 项修
- [x] **W7 后台三件套 MVP**(十收工)— admin/prompts(版本树 + 一键回滚)+ admin/styles(create/delete + kind 可选)+ admin/presets(4 类 + 默认值 fallback)
- [x] **10 轮全栈 audit + 24 项修**(十收工)— W7 内部 3 轮 / 跨模块 3 轮 / 底层优化 4 轮;详见 PROGRESS
- [x] **W1-W5 audit P1 followup 9 项**(十一收工)— publishEpisode TOCTOU + 4 mut 软锁守卫 + stale TTL 续约 + script.analyze binding + 3 条死配置 + VideoRef 7 槽位 fallback + propPrompt(verify) + shotId binding 查询 + Provider↔router ledger 双写补漏 — 2026-05-24
- [x] **W1-W5 audit P2 followup 6 项**(十一收工)— Scene/Episode 软删级联 + confirmCandidate candidateForSlot 校验 + ShotAssetRef 清理 + maxDurationS 双语义注释化 + 5 条 system.* setting 接通 + EventBus 注释 — 2026-05-24
- [x] **Shot schema 加 movement/lighting 字段**(十一收工)— schema + migration `20260524000000_w7_followup_shot_movement_lighting` apply + LLM 输出扩展 + storyboard router 落库 + edit-dialog 4 PresetField + shots-pane 显示 — 2026-05-24
- [x] **R9 Decimal.js 引入 cost ledger**(十一收工)— ledger.ts + insights.ts + aigc.ts + base.ts 用 Prisma.Decimal 累加替 Number 防 IEEE-754 漂移 — 2026-05-24
- [x] **R7 aigc-workspace memoization**(十一收工)— selectedGroupId useMemo + 8 个 GroupDetail handler useCallback,根除 parent re-render 时 inline arrow 重建 — 2026-05-24
- [x] **W1-W7 全栈深 audit + 7 项新 bug 修**(十一收工)— admin.style.delete 软删过滤 / project.get 多处 deletedAt / admin.binding.set 拒 inactive provider / auth.signup 软删邮箱永占 P0 / changePassword 强密度+ratelimit / minio.copyObject URL 编码 / styles-manager 重复 refetch — 2026-05-24
- [x] **改进意见 Step 1 + Phase 0 体检**(十二收工)— License 跟踪文档 + 3 ADR(Mastra/首尾帧/反向护城河)+ Shot startFrame/endFrame schema+migration + Mock 失败注入 + 14 仓库 license 实测纠正(huobao CC-BY-NC-SA / Toonflow Apache 不是 AGPL / mastra+langfuse 双轨制) — 2026-05-24
- [x] **仓库清理 33 文件 + tsconfig 防再生成**(十二收工)— git rm 28 个 adapters 源码同位 .d.ts/.js + 5 个 tsbuildinfo + .gitignore 加 *.tsbuildinfo + adapters tsconfig noEmit + 本地 .next/dist/.turbo 释放 106MB — 2026-05-24
- [x] **文档时效性 audit + 杨帆引用清理**(十二收工)— docs/03 进度速览刷新到 W5 90%/W6 ✅/W7 ✅ + docs/04 加 Shot movement/lighting/首尾帧 + docs/02 资产护城河更新 + 4 处杨帆引用全删 — 2026-05-24
- [x] **代码优化(安全前提)**(十二收工)— TRAINABLE_TEXT_FIELDS 抽 @ss/shared 单一真相源 + MAX_LENGTHS 常量集中(asset/storyboard router 同源) — 2026-05-24
- [x] **CLAUDE.md V2 强同步协议**(十二收工)— 开工加 Dirty Check + git fetch + reset --hard origin/main + 环境差异自动检测;收工 git add . → git add -A + 强制 verify(本地↔GitHub 真一致);跨设备衔接保证 — 2026-05-24
- [x] **`*.tsbuildinfo` 加到 `.gitignore`**(十二收工,原 TODO 待办)— 顺手清掉 — 2026-05-24
- [x] **7 轮深漏洞 audit + 修 7 项**(十三收工)— 认证/注入/并发/经济/泄漏/供应链/部署 7 维度,73 项 agent 报告筛 7 项真 vuln:aigc 占位 attempt + advisory_lock 修 / login dummy bcrypt 防时序 / changePassword deletedAt / setSetting isSecret 不进 OperationLog / Asset.update name TOCTOU / set-admin-password 强制传参 / db:reset NODE_ENV 守卫 — 2026-05-24
- [x] **第 13 轮系统层 audit + 修 5 项**(十三收工)— db:migrate (dev) 生产守卫 + clean script 跨平台 + Next.js security headers (X-Frame/Content-Type/Referrer/Permissions) + Prisma SIGTERM 优雅退出 + APP_MASTER_KEY 弱 key warn — 2026-05-24
- [x] **W5.5** BullMQ video-gen worker(异步队列 + SSE 进度 + providerJobId 轮询)— 完整交付,Mock 全链路跑通,14 项 audit 修(十四收工 · 2026-05-24)
- [x] **W5.5.1** 扩展参数 + 高级选项 UI(resolution/audio/watermark/webSearch/refVideo/refAudio + 'auto' aspectRatio,对照即梦/可灵 UI)— 十四收工
- [x] **W7 后台轻量四页**(audit/api-usage/settings/health)— adminRouter 加 3 sub-router + 4 页 UI — 十四收工
- [x] **W6 Collab Hub 三波**(成员/集数分配/工作报告)— /admin/users + /projects/[id]/team + /admin/reports + 13 procedure + 自锁防御 — 十五收工
- [x] **W5.6 Media Vault MVP**(/library)— mediaRouter 5 procedure + 上传/搜索/收藏/删/4 tabs + AIGC 自动沉淀 — 十五收工
- [x] **W5.5 第 3 轮 audit 5 项**(十五收工)— 双 worker cutoff 30min / SSE 空 media 兜底 / insights 公式 / SSE token 自动续期 / MediaItem partial unique migration
- [x] **6 项 UX 反馈修复**(十五收工)— nav team 入口 / scripts redirect / director home 合并
- [x] **DateTime locale polish**(十五收工)— 11 处 toLocaleString('zh-CN') → 浏览器 default
- [x] **W7 收尾 — Tauri 桌面端骨架**(十六收工)— apps/desktop + src-tauri 完整配置,Phase 1.5 真编译
- [x] **W7 收尾 — DB Explorer MVP**(十六收工)— /admin/db-explorer 白名单 21 表 + Prisma 动态反射 + JSON dump
- [x] **W7 收尾 — EN 文案 review**(十六收工)— zh ↔ en 4 json 全对齐 + characterRole enums 补
- [x] **README + CHANGELOG**(十六收工)— 完整重写 README(完成度徽章+模块全景+快速启动)+ CHANGELOG 16 次收工日志
- [x] **第 19-20 轮 audit 60 次 debug**(十八收工)— Sprint A/A2/B/C/D + R2 F/G/H · 修 15+ P0/P1 · 13 mutation .meta 100% · requestId 全链 · EventBus 4 publish 补 · Tauri capabilities DRAFT · 6 模块文档 · ADR-27 — 2026-05-24
- [x] **moyu 真接入 + 4 类 Provider 入口 + Phase 1.5 P0 规划**(十九收工)— OpenAICompatProvider × 2 + 8 个 moyu Provider + admin.testConnection 真实现 + admin.provider.create/delete + admin.dashboard.platformOverview + 7 项 P0/P1 修(SSRF/requestId 防伪造/zodIssues 脱敏/lowercase 标准化/双 toast/admin ¥0.00→真 data)+ moyu 浏览器深度学习(24 章 docs + 148 模型 + 设计要素归档)+ Phase 1.5 P0 plan v2(预扣退还/4 倍率/asset://) — 2026-05-24
- [x] **Phase 1.5 代码层 100% + moyu→relay 全面去特征化 + 真接入 verify**(二十收工)— Phase 1.5 主次重审 v2.1(6→5 P0 压简)/ P0-1 entryType+预扣退还(schema+migration+aigc.generateVideo+worker processor+failPlaceholder)/ P0-2 2 倍率(BaseProvider.calcCostCnyDecimal+OpenAICompatTextProvider 优先 modelRate+seed)/ P0-4 CSV 导出 13 字段(adminRouter.apiUsage.exportCsv+UTF-8 BOM+OperationLog)/ P0-5 RelayAssetProvider + mediaRouter.syncToRelay + aigc 优先 asset:// / moyu→relay 全代码层去特征(providerId×8+env+endpointStyle+文件名+类名+字段+SystemSetting key+meta key)/ DB seed 重建 15 provider + 26 setting / **真接中转站 verify(testConnection 14.9s + script.analyze 37s 真跑)+ smoke 19/19 + typecheck 15/15 + test 85/85** — 2026-05-24
- [x] **Binding 强制显式选(收工后补丁 #1)**— 用户反馈"测试调试可以,实际用必须后台设置"/ seed.ts 7 binding 默认值改 ''(留 docx.parser) / 5 业务 router fallback 改空时抛 PRECONDITION_FAILED + 引导 /admin/bindings / DB SQL UPDATE 修 8 行 / ADR-28 §F 落地 explicit-choice-only 原则 / smoke 19/19 保持过 — 2026-05-24
- [x] **Audit r21 深度审查 + 一键启动 pnpm start(收工后补丁 #2)**— 用户要求"深度检查 10 遍 + 全局检视 + 启动流程优化"/ 2 并行 audit agent / 修真 P0(aigc enqueue 失败 PREPAY 悬挂)+ 真 P1(worker REFUND 双写 race 用 advisory_xact_lock)+ 5 项 P1/P2 微优化 / 新建 `scripts/start.mjs` 跨平台一键启动(preflight + docker + migration + 检测端口 + turbo dev + wait + open browser + Ctrl+C 优雅停,verify 跑通)/ docs/03 + docs/04 更新 Phase 1.5 字段 / ADR-28 §G 落地 / typecheck 15/15 + test 85/85 — 2026-05-24
- [x] **文档全局总成 + 一键启动写进设备切换流程**(二十一收工)— README badge/累计/快速启动主推 pnpm start / CLAUDE.md 设备登记 + 切换设备流程加 7 步 + 4 flag + graceful 说明 / CHANGELOG 加 0.1.0 二十/二十一收工完整段 / W1-W7-followup P0 标"已完成 / 替换 Phase 1.5" / phase-1.5-plan 顶部完成戳 + verify checkmark / 0 代码改动 / 6 文档刷新 — 2026-05-25
- [x] **/admin/providers UI 重构 + 多中转站架构 Phase 1.5.1/1.5.2**(二十二收工)— admin.relay 子 router(get/set/clearCredential)+ 分类 Toggle 启停 + Phase 1.5.1 RelayProvider 表(多 token)+ 静态 catalog JSON + 数据迁移 SQL + Phase 1.5.2 catalog 扩到 142 完整 moyu 模型(95 TEXT + 12 IMAGE + 35 VIDEO)+ 删除按钮 + 简化直连为 4 字段 — 2026-05-25
- [x] **/admin/providers 双重深度 audit r22 / r22.1**(二十二收工)— r22:3 并行 agent 修真 P0 × 8 + P1 × 6 + 死代码清理(setActive ledger 跨度 / updateRelayProvider transaction 级联 / deleteRelayProvider 级联停用 / catalog 6 modelId 剥 ` L` 后缀 / IMAGE 4 模型补 unitPriceCny / RelayModelKind 扩) · r22.1:5 遍深审修 zod cuid 真 P0(migration 用 gen_random_uuid 不是 cuid,5 处 admin.relay.* .cuid() → .min(1))+ 4 流程改进(添加对话框保持开连续添加 / existingSuffixesByRelay → existingModelIdsByRelay 用 catalog.modelId 匹配 / 按 kind 价格智能显示 / saving state) — 2026-05-25
- [x] **relay-batch-test.mjs 批量测试脚本就绪**(二十二收工)— 107 非视频模型(95 TEXT + 12 IMAGE)· 直连 moyu HTTP 绕 admin 5/min rate limit · 并发 5 · TEXT 真调 max_tokens=1 总成本 < ¥0.01 · IMAGE 走 /models 探活不真生成 · 报告 ok/fail/latency p50/p90/p99 + 按 vendor 分组 + CSV 详单 · token 只读 env · tmp 加 .gitignore — **待用户给新 token** — 2026-05-25
- [ ] **W5.6 进阶**(留 Phase 2)— 音频波形(wavesurfer.js)/ AI 自动打标(BPM/时长)/ pgvector 向量搜索
- [ ] **Polish 剩余**(留 Phase 2)— 34 处硬编码颜色 / a11y / listBindings N+1 / OperationLog 命名规范
- [ ] **W8 团队实战**(下次启动)— 5 人冷启动 + 配 API Key 真接 Seedance + 1 集 7 镜头

- [ ] **跨设备协作工作流验证**(多端)
  - [x] 家里 Mac Studio `git pull` + 登录同一 Project + 说 `开工,在 mac-studio` 验证接续 — 2026-05-23
  - [x] 跨平台脚本验证:`mac-studio` 上 `pnpm setup:env`(幂等) + `pnpm preflight`(7 项全绿) — 2026-05-23
  - [ ] 出差 Win 笔记本照 [docs/SETUP-WINDOWS.md](docs/SETUP-WINDOWS.md) 首次拉起 → `开工,在 win-laptop` 验证接续 — 2026-05-24 起
  - [ ] GitHub 账户对齐(`user.name` / `user.email` 全局固化)+ `gh auth login` 一次性登录

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
- [x] **Episode 软锁覆盖到 script.upload/uploadFile**(W1-W5 audit C1)— 2026-05-23(八收工)
- [x] **W1-W5 audit P1 followup 9 项**(十一收工)— 详见上方"进行中" — 2026-05-24
- [x] **W1-W5 audit P2 followup 6 项**(十一收工)— 详见上方"进行中" — 2026-05-24
- [x] **W1-W7 全栈深 audit 7 项**(十一收工)— admin.style.delete / project.get / admin.binding.set / auth.signup P0 / changePassword / minio.copyObject / styles-manager — 2026-05-24
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
- [x] **W5.0.1** SystemSetting 加 4 条 video 配置(provider/maxDurationS/aspectRatio/dailyBudget)— 2026-05-22
- [x] **W5.0.2** packages/core/storyboard/video.ts compileShotVideoPrompt 8 段拼接 + 18 单测 — 2026-05-22
- [x] **W5.0.3** GenerationAttempt 加 providerJobId 字段 + migration — 2026-05-22
- [ ] **W5.1** 分镜级 4 列布局 UI 骨架(产品形态待决策)
- [ ] **W5.2** 自动 @ 资产匹配(复用 W1.6 auto-match 算法)
- [ ] **W5.3** Seedance 抽卡 router + 历史记录 + 重抽
- [ ] **W5.4** BullMQ video-gen worker(异步生成)+ 实时进度推送(SSE)+ providerJobId 轮询
- [ ] **W5.5** 素材库上传 / 搜索 / 收藏 / 批量

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
