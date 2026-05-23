# 开发日志

> 按日期倒序，最新在最上方
> 仓库：https://github.com/henrywei2030/SS

---

## 2026-05-24(周日,win-laptop · 十四次收工)— W5.5 BullMQ 异步 + W7 后台 4 页 + 14 项 audit + ADR-25/26

**完成 — W5.5 全栈异步 + W7 后台 + 同行调研 + ADR 升级**

### W5.5 BullMQ video-gen worker 完整交付(异步链路打通)
- ✅ **packages/queue 新包**:BullMQ Queue + ioredis + HMAC SSE token + 4 subpath exports(@ss/queue/{redis,types,video-gen,sse-token})
- ✅ **apps/workers/video-gen 新独立进程**:bootstrap + waitUntilReady + autorun:false + 25s grace shutdown(health → worker → redis → prisma)+ workerId + /health HTTP endpoint(9200)
- ✅ **aigc.generateVideo 异步化**:handler 占位 attempt + 校验 + compile + 入队 + 立即 return `{attemptId, RUNNING}`;worker 跑 provider.generate + $transaction(MediaItem + attempt + ledger)+ EventBus + Redis publish + OperationLog
- ✅ **HMAC 5min token 鉴权 SSE**:`aigc.getStreamToken` 签发 + SSE route timingSafeEqual + token-attemptId 匹配 + 30min 硬超时 + DB 进入兜底
- ✅ **前端 useAigcProgress hook**:EventSource 状态机;workspace 接入显示蓝色进度条 + Provider 名 + MOCK 角标

### W5.5.1 扩展参数(对照即梦/可灵 UI)
- ✅ VideoGenJobData 加 6 字段(resolution/audio/watermark/webSearch/refVideo/refAudio,全 optional)
- ✅ getProviderCapabilities 加 8 能力标志(supportedResolutions + supports*),后台 ProviderConfig.defaultParams JSON 可配,**零 schema 改**
- ✅ aspectRatio 加 'auto'(router resolve 到 project 默认)
- ✅ 前端高级选项 details 折叠 + 分辨率下拉 + 3 toggle + 参考素材占位(视/音 Phase 2)+ ToggleRow 复用
- ✅ Mock provider 打日志确认 extra 透传链路:`[mock-video:xxx] extra params received: {...}`

### W7 后台轻量四页(adminRouter 加 3 sub-router)
- ✅ **/admin/audit**:OperationLog 分页 + 筛选 action/targetType + 展开 before/after JSON + contains 大小写不敏感
- ✅ **/admin/api-usage**:GenerationAttempt + CostLedger 全局聚合 — KPI 4 卡 + 30 天 SVG 趋势 + Provider 表 + Action 分布
- ✅ **/admin/settings**:按 6 category 分组 + 行内编辑 + SECRET 双层拒编辑 + 搜索过滤
- ✅ **/admin/health**:DB/Redis/MinIO 并行 ping + 10s refetchInterval + 错误展示

### 同行调研 2 轮(对照 fynt + langfuse)
- 第 1 轮 W5.5 实施前深读:fynt(queue/redis/executor/worker/index)+ langfuse(webhooks/workerManager/shutdown/app)→ 1200 字对照报告
- 第 2 轮 audit:Agent 跑 git diff HEAD 全栈审视 → P0/P1/P2 分级报告

### 14 项 audit 修复
- **第 1 轮 8 项(W5.5 实施时)**:lockDuration 5min / stale RUNNING 启动扫描 / processor idempotency check / 失败白名单 strict snake_case / removeOnFail age 维度 / Redis 错误 30s 节流 / unhandledRejection exitCode=1 / catch 内 DB 失败兜底
- **第 2 轮 6 项(W5.5.1 + audit)**:**P0** 入队失败 attempt 卡 RUNNING(addVideoGenJob 包 try/catch + 立即 FAILED)/ **P0** SSE 订阅 race 丢消息(subscribe 后 double-check DB)/ **P1** stale cutoff 5→10min(防慢 job 误标)/ **P1** ToggleRow Provider 切换 reset / **P2** audit contains insensitive / **P2** refVideo/refAudio Provider 守卫(防绕 UI 滥用)

### ADR 升级
- ✅ **ADR-25 v2**(W5.5 异步化决策)— 同行借鉴 12 项映射 + M1-M11 模块清单 + Phase 2 不在范围
- ✅ **ADR-25 v3 扩展段**(W5.5.1)— 字段透传模式 + 8 项 Phase 2 升级空间(L1-L8)
- ✅ **ADR-26 跨模块 Agent 联动预留**(SUPERSEDES 原占位)— 13 mutation 候选 + `.meta({ agentTool })` 接口预备 + 5 项已就位 Agent 友好基础设施

**进行中**
- 🚧 (W5.5 + W7 后台 4 页全部交付,无在途)

**问题 / 待决策**
- ❓ Phase 1.5 真接 Seedance(配 API Key + 火山合规) — Mock 全链路已跑通
- ❓ 跨设备实测 V2 协议(切 mac 后续验证)
- ❓ Phase 2 升级 8 项(L1-L8 ADR-25 v3 已记录)

**下次接着做**
- 📌 task #3 W6 Collab Hub(数据层就绪,纯 UI)
- 📌 task #4 W5.6 Media Vault MVP
- 📌 task #5 W3-W5 polish / task #6 W7 收尾(Tauri+EN+DB Explorer)/ task #7 README+CHANGELOG

**质量**
- 15 包 typecheck 全过(新增 @ss/queue + @ss/worker-video-gen 两个 workspace 包)
- 零 schema 改 / 零 migration
- ADR-25 v2 + v3 + ADR-26 完整

**累计**
- 14 次收工 audit 累计:**55+ 项**(13 收工 41 + 本次 14)
- 18 ADR 已落定(本次新 ADR-26 / ADR-25 升 v3)
- 110+ 单测全过零回归
- 新增 2 monorepo workspace 包

---

## 2026-05-24(周日,win-laptop · 十三次收工)— 7+1 轮深漏洞 audit 修 12 项

**完成 — 8 轮深扫(7 漏洞 + 1 系统层)+ 12 项真 vuln 修复**

### 7 轮漏洞 audit + 修 7 项(认证/注入/并发/经济/泄漏/供应链/部署 各 1 角度)
73 项 agent 报告严格筛选(信噪比 ~10%)→ 7 项真 vuln:
- ✅ **A1 P0 aigc.generateVideo advisory_xact_lock 在事务外失效**:重构为 `$transaction` 内 锁 + inflight check + 占位 QUEUED attempt + failPlaceholder helper;前置 check 失败时 mark FAILED 释放占位
- ✅ **A2 P1 auth.changePassword 缺 deletedAt:null 过滤**:软删账号可改密复活 → findFirst 加过滤
- ✅ **A3 P1 auth.login 时序攻击**:用户不存在跳 bcrypt 立返 → 加 dummy bcrypt compare 等时长防 email enumeration
- ✅ **A4 P1 admin.system.setSetting isSecret 明文进 OperationLog.afterJson**:maskValue helper 屏蔽 isSecret 行 value
- ✅ **A5 P1 asset.update name 重复检测 TOCTOU**:dup check 移进 $transaction 内 fresh read 之前
- ✅ **A6 P1 set-admin-password.ts 默认 'admin123'**:强制传参 + 强度校验(8+字母+数字)+ 不再回显明文
- ✅ **A7 P1 db:reset 无 NODE_ENV 守卫**:新 scripts/db-reset-guard.mjs 检查 NODE_ENV/DATABASE_URL,生产/远端 DB 拒绝执行

### 第 13 轮系统层 audit + 修 5 项
- ✅ **db:migrate (dev) 加生产守卫**:新 scripts/db-migrate-dev-guard.mjs(同 db:reset 模式),防 prisma migrate dev 在生产触发自动 reset
- ✅ **clean script 跨平台**:`rm -rf node_modules .turbo` → Node ESM `fs.rmSync recursive:true`(Win + Mac 通用)
- ✅ **Next.js 基础 security headers**:apps/web/next.config.ts 加 X-Frame-Options:DENY + X-Content-Type-Options:nosniff + Referrer-Policy + Permissions-Policy(camera/mic/geolocation/payment 拒)
- ✅ **Prisma client SIGTERM/SIGINT 优雅退出**:packages/db/src/client.ts 注册 once SIGTERM/SIGINT → $disconnect 防 PG connection slot 残留;`__ssPrismaSignalsRegistered` 防 HMR 重复挂
- ✅ **APP_MASTER_KEY 弱 key warn**:packages/adapters/src/crypto.ts 非 64 字符 hex 时 SHA-256 派生 + console.warn 提示生产环境改用 `openssl rand -hex 32`

### Agent 信噪比观察
- 8 轮 agent 共 85 项原始报告,真 vuln 12 项,信噪比 ~14%
- 多数误判类型:① agent 没看到我前 11 轮修过的代码(过时认知)② 把 adminProcedure 设计本意当 IDOR ③ 把"防滥用"逻辑反着报成"被滥用" ④ 把 storage key 当 file path 报 path traversal ⑤ 把 `await x.catch(y)` 报"缺 await"
- 严格筛选 + 自己 verify(每条 P0/P1 都看代码再判)是必要的工程

**质量**
- 12 包 typecheck 全过 + 110 单测全过零回归
- DB schema up-to-date(18 migrations 全 apply)

**进行中**
- 🚧 W5.5 BullMQ video-gen worker(真接 Seedance 必修)
- 🚧 跨设备衔接实测 V2 协议(到 mac 端验证)

**问题 / 待决策**
- ❓ Phase 2 加固:Provider response zod 校验 / SSRF 内网 IP 白名单 / Pino structured logger / JWT revocation list / Per-username login rate limit / CSP/HSTS 完整 headers
- ❓ Agent audit 信噪比低,后续 audit 是否改成手动深扫为主、agent 辅助?

**下次接着做**
- 📌 跨设备实测 V2 协议(说 `开工,在 mac-mini`,预期 fetch + reset --hard + 环境差异自动提示)
- 📌 W5.5 BullMQ worker 或配 API Key 跑 e2e

**累计**
- 13 次收工累计 P0/P1/P2 audit 修复:**41 项**(W1-W7 P1 9 / P2 6 / R7+R9 / Shot schema / W1-W7 audit 7 / 改进意见 Step 1 4 / 7 轮深扫 7 / 系统层 5 + Decimal/memo + ledger 双写补漏)
- 18 migrations 已 apply,DB schema up-to-date
- **17 ADR + V2 协议**(ADR-22 Mastra / ADR-23 Shot 首尾帧 / ADR-24 反向护城河)

---

## 2026-05-24(周日,win-laptop · 十二次收工)— 改进意见 Step 1 + Phase 0 + 仓库清理 + V2 协议

**完成 — 同一天三件大事**

### 改进意见 Step 1(2026-05-23 研究规划改进意见 §9 落地)
- ✅ **docs/05a-third-party-licenses.md**:三方仓库 License 跟踪文档(风险分级 + 灵感来源记录机制 + Phase 0 实测数据回填)
- ✅ **3 条新 ADR**:
  - ADR-22 Phase 2 Agent 编排选 Mastra(SUPERSEDES ADR-01 LangGraph)— 完整决策表(TS 一等公民 / huobao 生产验证 / MCP 一等公民 / Vercel 原生)
  - ADR-23 Shot 加 startFrameMediaId/endFrameMediaId 预留 FLF2V(零成本字段,Phase 2 真接 Seedance 2.0/Veo 3.1/Wan 2.6 时启用)
  - ADR-24 反向护城河确认(外部验证 8 项独家设计,任何"简化重构"必须先看)
- ✅ **Shot schema 加 startFrame/endFrame**:migration `20260524100000_adr23_shot_first_last_frame` 已 apply + 18 migrations all green
- ✅ **Mock Provider 失败注入**:MockImageProvider + MockVideoProvider 加 failureRate / failureModes(timeout / censored / rate_limit / server_error / compliance_required),为 W5.5 BullMQ worker 重试逻辑准备验证基础

### Phase 0 14 仓库体检(改进意见 §5 Phase 0)
- ✅ **docs/research/00-license-audit.md + 00-overview-and-audit.md**:14 仓库 license + 存活实测,3 个关键事实纠错:
  - **huobao-drama**:改进意见说"无 LICENSE",实测**有 CC-BY-NC-SA-4.0 badge**(传染风险更准确)
  - **Toonflow-app**:改进意见说"AGPL-3.0",实测**Apache-2.0**(从 🟡 升 🟢 可深读)
  - **mastra / langfuse**:Apache/MIT + ee/ **双轨制**(主代码可借,严禁触碰 ee/ 目录)
  - **In-Context-LoRA**:521 天无 push,**已死**,降 Tier D
- ✅ **docs/05a 全表回填**:11 仓库 license + 借鉴方式 + 关联 ADR

### 仓库清理(33 文件 + tsconfig 防再生成)
- ✅ **git rm 28 个 adapters 源码同位 .d.ts/.js**:历史 `tsc`(非 noEmit)+ 平级 include 目录致编译产物撒在源码同位
- ✅ **git rm 5 个 tsconfig.tsbuildinfo**:污染 diff
- ✅ **adapters tsconfig.json noEmit: true + build script noEmit**:防再生成
- ✅ **.gitignore 加 *.tsbuildinfo**:TODO.md 原有待办顺手清
- ✅ **本地清理 106 MB**:rm .next 101M + 6 个 dist 2.5M + .turbo 2.6M(下次首启重建一次)

### 文档时效性 audit + 杨帆引用清理
- ✅ **docs/03 进度速览刷新**:头部从"2026-05-22 W5🚧/W6-W8 📋"→"2026-05-24 W5 90% / W6 ✅ MVP / W7 ✅ MVP"+ 11 次收工 + 18 migration + 17 ADR + 110 单测累计
- ✅ **docs/04 加 2026-05-24 timeline 段**:movement/lighting + 首尾帧 + Decimal + deletedAt + ShotAssetRef 类型导出删除
- ✅ **docs/04 Asset 字段示例更新**:旧 mainMediaId/threeViewIds/panorama360Id 标 @deprecated,补 7 视角槽位(portrait/threeView/sceneMain/Front/Left/Right/Back/panorama)
- ✅ **docs/02 资产模型亮点**:补 archetypeKey / 7 视角 / maturity(ADR-24 护城河)
- ✅ **杨帆引用全删 4 处**:docs/00 对比表(改成"内部工具 V2") + 阶段定位段 + auto-match.ts + merge.ts 注释

### 代码优化(安全前提下,P0 仅 1 项)
- Agent 报 25 项,**严格筛选只做 1 项真值得的**:
- ✅ **TRAINABLE_TEXT_FIELDS 抽 @ss/shared 单一真相源** + **MAX_LENGTHS 常量集中**
  - asset.ts + storyboard.ts 之前各自维护一份 set,改字段要改两处
  - 抽到 packages/shared/src/constants.ts,改字段只改一处
  - 副作用:**movement/lighting 自动也进资产训练集**(原 asset.ts 没采集是 bug)
- 其余 24 项 agent 报告**误判 / 风险大 / 跨包依赖增加**,审筛后**不做**(防过度工程化)

### CLAUDE.md V2 强同步协议 — 跨设备衔接保证
- ✅ **开工 V2**:Dirty Check(防覆盖未提交) + git fetch + 比较 ahead/behind + `git reset --hard origin/main`(远端删的文件本地自动消失) + 环境差异自动检测(package.json / migrations / .env.example) + untracked 清单只显示不删
- ✅ **收工 V2**:`git add -A`(显式包含删除) + 强制 verify(`git status` 必须 clean + up to date with origin/main)+ 删除文件清单展示
- ✅ **明确边界**:开工不无声覆盖 dirty / 不自动 clean / 不自动 install / 不自动 migrate;收工不 force push / 不改 .gitignore / 不跑 migration

**进行中**
- 🚧 W5.5 BullMQ video-gen worker(真接 Seedance 必修)
- 🚧 W5.6 素材库 Media Vault
- 🚧 跨设备协作工作流验证(用新 V2 协议)

**问题 / 待决策**
- ❓ Auto Mode classifier 仍拦截 `prisma migrate dev`,只能用 `prisma db execute` + `migrate resolve --applied` 二段式 — 是否在 settings.json 加 prisma 命令允许列表?
- ❓ 同行研究 Phase 1(mastra/langfuse 主代码深读)是否启动 — 还是直接推 W5.5?

**下次接着做**
- 📌 **跨设备衔接实测**:换 mac 设备说 `开工,在 mac-mini`,验证新 V2 协议(预期:fetch 后 reset --hard,本地多余文件自动消失,删除清单干净)
- 📌 选择 W5.5 BullMQ worker 或同行研究 Phase 1
- 📌 重传 Project 知识库(TODO/PROGRESS/05/05a/02/03/04/00)

**质量**
- 12 包 typecheck 全过 + 110 单测全过零回归
- 18 migrations 已 apply,DB schema up-to-date
- 累计:**52 文件改动**(20 modified + 33 deleted + 4 untracked,+1407 / -1521 行,**净 -114 行**,因为删了 1394 行编译产物)

---

## 2026-05-24(周日,win-laptop · 十一次收工)— W1-W7 全栈深 audit 29 项 + Shot schema 联动 + Decimal/memo

**完成 — 三轮深 audit + 全链路同步**

### W1-W5 audit P1 followup 9 项(底子加固)
- ✅ **P1-1 publishEpisode TOCTOU 全事务化**:`advisory_xact_lock('episode_publish:')` 锁内做 lock check + status CAS,根除 read-then-act 窗口
- ✅ **P1-2 5 个 mutation 加 isEpisodeLockedNow 守卫**:mergeShots / splitGroup / updateShot / deleteShot / updateGroup 防 generateForEpisode 跑到一半被改字段
- ✅ **P1-3 stale TTL 动态续约**:`refreshEpisodeLock` helper + generateForEpisode 每 1/3 TTL(5min)续约一次,长剧本不再被自己判 stale
- ✅ **P1-4 script.analyze modelId 读 binding**:`binding.script.analysis.modelId` 真接通(input > binding > 'claude-sonnet-4-5')
- ✅ **P1-5 三条死配置全接通**:`asset.compliance.requireForVideo`(generateVideo 守卫)+ `binding.asset.compliance.providerId`(complianceCheck 真读)+ `binding.script.docx.parser`(extractScriptText.opts.docxParser)
- ✅ **P1-6 VideoRef 7 槽位 fallback 链**:CHARACTER → portrait → threeView → main;SCENE → sceneMain → Front/Left/Right/Back → panorama → main(getGroupDetail / previewCompiledPrompt / generateVideo 三处)
- ✅ **P1-7 propPrompt verified** — W7 audit R5 已修过,跨入口已传 propPrompt
- ✅ **P1-8 asset.listShotBindings 端点**:补齐 shotId → AssetUsageBinding 查询路径(W3 兼容)
- ✅ **P1 补漏:Provider ↔ router ledger 双写** — aigc.generateVideo / asset.generateImage 调 provider 时传 `skipLedger:true`,防真接 Seedance/Claude 时 SeedanceProvider 内 5 处 recordLedger + router 手动 ledger 双计费

### W1-W5 audit P2 followup 6 项(扫尾)
- ✅ **P2-1 Scene/Episode 软删级联**:新增 `storyboard.deleteScene` + `admin.episode.archive` 端点,事务级联清 shots / shotGroups / bindings,根除悬空 binding
- ✅ **P2-2 confirmCandidate 校验 candidateForSlot**:反查 attempt 校验 === input.slot,防 portrait 候选被塞 threeView 槽位
- ✅ **P2-3 ShotAssetRef deprecated 清理**:`db/src/index.ts` 移除类型导出 + 加 W6 schema drop 路线图注释(schema 改 + migration 仍 deferred,未真 drop)
- ✅ **P2-4 maxDurationS 双语义注释化**:`storyboard.maxDurationS`(mergeShots 合并组上限) vs `shot.video.maxDurationS`(Provider 单次硬上限)— seed.ts 清晰区分
- ✅ **P2-5 5 条 system.* setting 全接通**:新增 `me.systemBranding` endpoint(brand/locale/gacha/budget)+ aigc.generateVideo 内联 `system.gacha.max_attempts` 守卫 + insights.getProjectOverview 返 `budgetStatus + budgetWarnPct`
- ✅ **P2-6 EventBus 注释** — 已加 W1-W5 三轮 E2 注释(Phase 1 仅 GENERATION_COMPLETED 启用)

### 底层优化 3 项
- ✅ **R7 aigc-workspace memoization**(1235 行)— `selectedGroupId` 用 useMemo + `selectGroup` / `invalidateGroup` / 8 个 GroupDetail handler 全 useCallback,根除 parent re-render 时 inline arrow 重建破坏 React.memo
- ✅ **R9 Prisma.Decimal cost ledger 精度**:`packages/core/cost/ledger.ts`(4 helpers)+ `insights.ts`(getProjectOverview / getModelDistribution / Top10)+ `aigc.ts`(dailyBudget)+ `adapters/provider/base.ts`(recordLedger / checkBudget)— `db/src/index.ts` 加 `export { Prisma }` value-export 解 ts1362
- ✅ **Shot schema 加 movement/lighting** + **全链路联动**:schema + migration `20260524000000_w7_followup_shot_movement_lighting` 已 apply + LLM SYSTEM_PROMPT 扩 4 字段 + presets 灌给 LLM + storyboard router 落库 + edit-dialog 4 PresetField + shots-pane 二级显示

### W1-W7 深 audit 第 11 轮 + 7 项新 bug 修
- ✅ **admin.style.delete 缺 deletedAt 过滤**:软删项目/资产仍占引用阻止风格删除(P1)
- ✅ **project.get 多处 deletedAt 漏过滤**:episodes / shotCount / completedShots 都没排除软删 episode 导致统计错乱(P1)
- ✅ **admin.binding.set 拒 isActive=false provider**:防 silent fail(P1)
- ✅ **auth.signup deletedAt 过滤** — **P0**:软删用户邮箱永久占用,管理员无法重建账号
- ✅ **changePassword 强密度 + rate-limit**:与 signup 对齐 + per-user 5次/min 防撞旧密码(P1)
- ✅ **minio.copyObject CopySource URL 编码**:AWS SDK v3 不自动编码,含空格/中文 key 让 S3 解析错(P2)
- ✅ **styles-manager 重复 refetch+invalidate**:update/del/create onSuccess 双触发查询,简化为单 invalidate(P2)

### 验证 & 文档
- ✅ 12 包 typecheck 全过(7 包 src + 5 cache)
- ✅ 110 单测全过零回归(60 core + 25 api + 14 episode-lock + 11 script-extract)
- ✅ DB schema up-to-date(17 migrations,与 schema.prisma 一致)
- ✅ TODO.md + PROGRESS.md(本条)
- ⚠️ docs/* 未改 — 本次修复都是 audit 收尾,无新架构 / 模块 / ADR 决策

**质量**
- 25 modified + 1 new migration 目录 + **+999 / -172 lines**
- 累计今日:29 项 bug 全清(P1 9 + P2 6 + R7/R9 + Shot schema + ledger 双写补漏 + W1-W7 7 项)
- Auto Mode classifier 拦截过 1 次 schema migration,经 AskUserQuestion 确认后用 `prisma db execute` + `prisma migrate resolve --applied` 二段式 apply 落地

**进行中**
- 🚧 W5.5 BullMQ video-gen worker(异步队列 + SSE 进度 + providerJobId 轮询)— 真接 Seedance 时必修
- 🚧 W5.6 素材库(Media Vault)— /media 上传/搜索/收藏,Phase 2

**问题 / 待决策**
- ❓ W8 实战准备(种子数据 + 操作日志页 + 5 人 onboarding SOP)是否启动
- ❓ 配真 API Key 跑 e2e 业务验证(Claude / Seedance)
- ❓ Tauri 桌面端打包是否仍排期(原 W7,目前 web 实战不需)
- ❓ EN 文案 review(i18n 大工程,Phase 2?)

**下次接着做**
- 📌 选择:① W5.5 BullMQ worker(真接 Seedance 必修)/ ② 配 API Key 跑 e2e(验证 W1-W7 链路真实运行)/ ③ W8 实战(种子 + onboarding)
- 📌 重传 Project 知识库 4 份(TODO / PROGRESS / docs 不动)

---

## 2026-05-23(周六,win-laptop · 十次收工)— W5/W6/W7 全交付 + 10 轮全栈 audit 24 项修

**完成 — 巨量产出**

### W5 收尾(P2 4 项)
- ✅ L3:refSlotIdx 跳号 ADR 注释(schema 字段注释解释"只增不复用"trade-off)
- ✅ providerJobId 加 partial unique 索引(防 webhook/poll retry 双写,migration `20260523180000_w5_p2_providerjob_unique`)
- ✅ a11y:hover-only 按钮改 opacity + focus-visible + aria-label
- ✅ window.prompt/confirm → PromptDialog/ConfirmDialog(role + aria + Enter/Escape + autoFocus)

### W6 数据洞察 MVP(W6.1 + W6.3 + 4 轮 audit)
- ✅ `insightsRouter`(3 procs):getProjectOverview / getModelDistribution / getTopShotGroupsByGachaRate
- ✅ `/projects/[id]/insights` 单页:4 KPI 卡 + 日 cost 趋势(CSS bar)+ kind 分布 + 模型分布 + Top10 group 表
- ✅ project-overview 加 nav 入口(`--color-mod-analytics`)
- ✅ **4 轮 audit 11 P0 + 5 P1 全修**:
  - Top10 加 rejected:false 过滤 + episode.deletedAt 过滤(防 NOT_FOUND)
  - days 默认对齐 30(原 Top10 全期错位)
  - 成本(¥)从 ledger,计数从 GenerationAttempt(单一来源跟 aigc 对齐,seedance 失败写多 ledger 不影响计数)
  - successCostCny 字段独立(KPI"成功 ¥"算法错修)
  - costByDay UTC 时区(跨设备分桶不偏)
  - costByKind whitelist(image/video/text/audio/compliance/analysis/other)+ 未知 prefix warn
  - Top10 attemptSuccessRate 命名消除跟 gachaRatio(时长口径)歧义
  - UI:3 useQuery error 状态 + 模型分布显 providerId/modelId + Top10 thead sticky + a11y(tab role + 色弱图标)+ formatCny 极小值 "<¥0.01"

### W7 后台三件套 MVP
- ✅ **admin/prompts** — 左:7 类分组列表 + 版本数 badge / 右:编辑器(描述 + 正文 textarea + 改动备注)+ 历史版本 dialog(版本列表 + 一键回滚 + diff)
- ✅ **admin/styles** — 内置 + 自定义卡片 / 编辑器(name + character/scene/prop 三段 + 禁用词)+ 新建 dialog;内置拒改名/拒删
- ✅ **admin/presets** — 4 tab(景别/机位/运镜/光线)+ 增删/上下移/序号重排/恢复默认
- ✅ Router 增强:`admin.prompt`(getById + listVersions + restoreVersion);`admin.style`(create + delete + name 校验);新 `admin.preset`(list + set + resetToDefault)

### 10 轮全栈 audit + 24 项修复
**Batch 1(R1-R6)W7 内部 + 跨模块**:
- R1 versionTag 用 UUID 取代 `${Date.now()}`(防并发撞 unique)
- R1 content + description + modelHint 加 maxLength
- R2 invalidate 覆盖草稿守卫(lastSyncedTemplateId/Kind ref + dirty 检测)
- R2 useQuery isError 处理(3 admin 页 + 重试)
- R2 3 处 window.confirm → ConfirmDialog
- R3 SystemSetting category 6 种文档化(general/security/branding/feature_flag/model_binding/preset)
- 🔥 **R4 prompt 模板 100% dead UI → DB-driven**:loadPromptTemplate helper(packages/core/shared)+ 3 LLM 入口(asset/breakdown / storyboard/generate / script/analyze)接 DB + hardcoded fallback;seed 补 script_analysis_main 模板
- 🔥 **R5 slug 硬编码 + kind=CUSTOM 强制**:slug 黑名单(ai_real/anim_3d/anim_2d)+ kind 可选(4 个 enum)+ 错误 meta.target 清晰
- 🔥 **R6 预设 100% dead UI → 半活**:抽 loadPresetValues helper + `me.presets` 公开 endpoint(普通用户可调)+ W3 edit-dialog `PresetField`(input + datalist 拉 presets,自定义值兼容)
- R5 W3 storyboard 给 LLM 加 propPrompt(W4/W5 之前修过 video.ts 同问题,W3 这次补)

**Batch 2(R7-R10)底层优化**:
- R7 asset.batchCreate → createManyAndReturn(~50× 加速)
- R7 性能 P0:aigc-workspace 1235 行 0 memoization / seedance 5min 同步阻塞 / 0 dynamic import — 已记 TODO,大改留下次
- R8 P0 **CSRF Origin 校验 middleware**(POST 校验,GET 放行,dev / NEXT_PUBLIC_APP_URL 白名单)
- R8 P0 **Rate limit middleware**:auth.login(5/min/IP)+ aigc.generateVideo(10/min/user)+ storyboard.generateForEpisode(5/min/user)
- R8 P0 **GenerationAttempt.inputJson 脱敏**:`sanitize-prompt` helper(preview 200 字 + sha256 hash 替明文 prompt;references strip name/mediaUrl 留 idx+kind+assetId)
- R8 P1 admin.system.listSettings 过滤 isSecret(value 脱敏成"••••(secret)")
- R9 TRPCError 加 cause(asset breakdown / asset generateImage / script analyze / aigc generateVideo)
- R9 `g.videoTakes!` 非空断言守卫(IIFE 解构)
- R10 抽 `assertProjectAccess` 公共 helper(5 router 字面相同复制 → 集中 middleware/access.ts)
- R10 抽 ConfirmDialog/PromptDialog 公共组件(components/ui/confirm-dialog.tsx)
- R10 formatCny 统一(insights 用 utils 而非自实现)
- R10 prompt-compiler.ts 死代码删

### 文档同步
- ✅ TODO.md:13 项已完成勾选 + 5 项剩余明确列出
- ✅ PROGRESS.md(本条)
- ✅ docs/05-tech-decisions.md:ADR-21 W5 升级接口已存 + 本次 schema/middleware 决策注释化在 admin.ts / events.ts / 各 helper

**质量**
- 7 包 typecheck 全绿
- 60 core + 25 api 单测全过(零回归)
- 工作区 28 modified + 17 new + 1 deleted + +2980 / -493 lines

**进行中**
- 🚧 W5.5 BullMQ 异步 worker(真接 Seedance 必修,Mock 阶段不阻塞)
- 🚧 R9 Decimal.js cost ledger 精度(大额累加 IEEE-754,涉及 4 文件)
- 🚧 R7 aigc-workspace memoization(1235 行,需拆 sub-component)
- 🚧 Shot schema 加 movement/lighting(W7 这 2 类预设没存的地方)

**问题 / 待决策**
- ❓ W6 是否要做"成员/工作报告"(原 W6.4),需新表 schema,W7 末或 Phase 2?
- ❓ Tauri 打包(原 W7)— web 实战不需要,延后?
- ❓ EN 文案 review(原 W7)— i18n 抽词大工程,Phase 2?

**下次接着做**
- 📌 选择:① W8 实战准备(种子数据 + 操作日志页 + 5 人 onboarding SOP)/ ② 继续修剩余 4 项 audit / ③ 配真 API Key 跑 e2e 业务验证
- 📌 重传 Project 知识库 4 份(TODO / PROGRESS / docs/04 / docs/05)

---

## 2026-05-23(周六,win-laptop · 九次收工)— W5.1 token 化重写 + W5.2 v0 AIGC 工作台

**完成**
- ✅ **migration 跑了两条**:
  - D1 `20260523103000_audit_p0_assetusage_partial_unique`(partial functional unique 真正生效,AssetUsageBinding 并发双插 bug 终结)
  - W5.1 `20260523113000_w5_1_assetusage_shotgroup_refslot`(加 shotGroupId + refSlotIdx + FK + 索引 + 重建 partial unique 含 shotGroupId 维度)
  - DB sanity 已 psql 校验:_prisma_migrations 4 条全在 / asset_usage_bindings 多 2 列
- ✅ **W5.1 schema + compileShotVideoPrompt token 化全重写**(对齐用户 04AIGC 模块文档 + 截图设计):
  - schema:`AssetUsageBinding` 加 `shotGroupId String?` + `refSlotIdx Int?` + `ShotGroup.bindings` 反向关系 + 2 个索引
  - `packages/core/storyboard/video.ts` 重写,4 个公开 API:
    - `tokenFor(kind, idx)` — 输出 `@图片N` / `@音频N`
    - `isAudioUsage / kindFromUsage` — 从 AssetUsageType 派生 IMAGE/AUDIO 分类(用 SOUND_BG/SOUND_VOICE/THEME 三个已有 enum,不加新值)
    - `autoTagPromptWithReferences(text, bindings)` — "自动 @"按钮的纯函数(找 name/alias 后插 token,首次出现 only,已标过的跳过)
    - `compileShotGroupVideoPrompt(input)` — 编译 Seedance 输入(positive 含 token 占位 + references[] 解析 mediaUrl + 双向 warnings)
  - 公式 4 段:风格 → 文本 → 时长比例 → 额外指令(W5.0 时是描述性 9 段,W5.1 改成 token 化 4 段)
  - 风格三段(character + scene + **prop** ✓ — 修 audit P1)
  - 39 个单测(原 19 → +105%):helpers / autoTag 11 case / compile happy / warnings 双向 / 风格 / negative / 时长比例 clamp / token 解析 edge case
- ✅ **W5.2 v0 AIGC 单集工作台**(对齐用户决策"详情面板"形态):
  - 新 `packages/api/src/routers/aigc.ts`,挂 `trpc.aigc.*`,7 个 procedure:
    - `listEpisodes(projectId)` — 集数总览(W5.3 用)
    - `listGroups(episodeId)` — 左侧 1-8/9-18 列表(含 shot/binding 计数)
    - `getGroupDetail(groupId)` — 右侧 4 区数据(含 mediaUrl 投影 character→portrait/scene→sceneMain/voice→voiceMedia)
    - `autoMatchAssets(groupId)` — 调 W1.6 autoMatchAssets,创建 binding 时 type=SCENE/CHARACTER/PROP 顺序续 refSlotIdx,跳过已 bound
    - `autoTagPrompt(groupId)` — autoTagPromptWithReferences 插 token 回 ShotGroup.prompt
    - `updateGroupPrompt(groupId, prompt, diffNote)` — 编辑同事务写 PromptEdit(targetType=SHOT_GROUP)训练集
    - `previewCompiledPrompt(groupId)` — 实时编译 + 警告
  - 新页面 `apps/web/app/[locale]/(workspace)/projects/[id]/aigc/[episodeId]/`:
    - `page.tsx` — server entry,SSR 注入 initialGroupId
    - `aigc-workspace.tsx` — client 主组件,grid `[280px_1fr]`,左 Group 列表 + 右详情
    - 右侧 4 个 section:资产关联(binding 卡片网格,token badge `@图片N` 角标)/ 原始剧本(只读 shots/scenes)/ 视频提示词(monospace 显示 + warning 提示)/ 视频预览(W5.4 占位)
    - 可工作按钮:**自动匹配**(toast 反馈新增/跳过数)、**自动 @**(检测 changed 状态)
    - 占位按钮:关联素材 / 上传素材 / 编辑 / 生成视频 — disabled 留 W5.2.1 / W5.4

**进行中**
- 🚧 W5.2.1 v1 4 按钮 — 关联素材 / 上传素材 / 编辑提示词 / 删除 binding
- 🚧 W5.3 集数总览页 — 5 集卡片网格 + 状态筛选

**问题 / 待决策**
- ❓ W5.2 v0 实际跑通需要先有 ShotGroup(导演工作台已生成分镜的 episode),没有真数据时 UI 显示"本集还没有生成段"
- ❓ W5.2.1 上传素材怎么处理 — 直接进项目素材库还是临时挂?(决策影响 MinIO bucket 命名)
- ❓ W5.3 5 集卡片"团队人数"统计指什么 — 项目成员 / 集 assignee 分配过的人数?

**下次接着做**
- 📌 W5.2.1 4 按钮补齐(1.5h)→ W5.3 集数总览(1h)→ W5.4 Seedance 接入(2h+)
- 📌 真实业务验证:配 Claude API Key → 跑剧本 + 拆解 + 分镜 + AIGC 工作台一条龙
- 📌 audit P1 followup:propPrompt 已在 W5.1 修 ✓ / VideoAssetRef 加 mediaUrl 已在 W5.1 修 ✓ / shotId→Binding 查询 W5.2 落到 group 级 ✓ — 3 项 P1 都顺手做了

---

## 2026-05-23(周六,win-laptop · 八次收工)— Win 首次拉起 + W5.0 跨平台修 + W1-W5 跨模块 audit P0 8 项

**完成**
- ✅ **Win 笔记本首次拉起验证**(出差携带机首战):
  - `pnpm preflight` 7/7 全绿(Node 24.16 / pnpm 9.12 / Docker / .env / node_modules / git 干净 / 远程同步)
  - 全仓 7 包 typecheck 全过 + 36 core + 25 api 单测全过
  - `开工,在 win-laptop` SOP 跑通
- ✅ **W5.0 跨平台 + 内部修补**(发现 W5.0 漏的小问题):
  - **B1 阻塞**:`packages/{core,api}/package.json` 写死 `--config=/dev/null`,Win 上解析成 `C:\dev\null` vitest 崩溃 → 改成 per-package vitest.config.ts(Node `os.devNull` 不能用在 JSON script)
  - **B2**:`compileShotVideoPrompt` aspectRatio 仅 trim,纯空白 `'   '` 会让"宽高比 "后面挂空 → fallback 改为「trim 后空也用默认 9:16」
  - **B3**:顶部公式注释列了 8 段实际拼 9 段(漏标"额外指令"),注释补齐
  - **B4/B5**:happy path 单测顺序断言只到 lines[3],没传 props,扩成 9 行完整顺序断言 + 加 props + 新增 whitespace fallback 单测(19→18+1)
- ✅ **W1-W5 4 个 parallel agent 跨模块全面 audit**(SystemSetting 消费链 / GenerationAttempt 写入链 / Asset-Shot-Binding 数据流 / 状态机+并发+EventBus)— 共扫出 **25 项问题**(8 P0 / 10 P1 / 7 P2):
- ✅ **P0 8 项全修**:
  - **D1** [`schema.prisma:461`](packages/db/prisma/schema.prisma#L461) — AssetUsageBinding 复合 unique 含 nullable 列,PG 中 NULL≠NULL 致并发双插。改 partial functional unique(`COALESCE(sceneId,'') + COALESCE(shotId,'') + WHERE deletedAt IS NULL`),schema 去 `@@unique` 注释化,新 migration `20260523103000_audit_p0_assetusage_partial_unique`(**未自动跑**)
  - **D2** [`storyboard.ts:953`](packages/api/src/routers/storyboard.ts) — publishEpisode 无条件设 `IN_PROGRESS` 会把 COMPLETED/ARCHIVED 集 downgrade。加 status 守卫(只允 NOT_STARTED/IN_PROGRESS)+ 事务内 CAS 防 TOCTOU
  - **A1** [`asset.ts:1629`](packages/api/src/routers/asset.ts) — setComplianceManually 通过合规后不重算 maturity,L4 人物永远卡 L4。改事务内 findFirstOrThrow + computeMaturity(projected) + maturity 字段同步写
  - **A2** [`breakdown.ts`](packages/core/asset/breakdown.ts) — LLM 输出无 archetypeKey,W4 变体能力(陆乘-重生初期 / 疗伤期)全链路断。AssetDraft 接口加字段 + SYSTEM_PROMPT 加"第 8 条 archetypeKey 规则"+ 3 个示例(陆乘/luchengjia_tuwu/guali_1983)+ parseDraftArray 提取
  - **C1** [`script.ts:23-44`](packages/api/src/routers/script.ts) — script.upload/uploadFile 在 GENERATING 期间能换剧本 → 跨版本 shot。新 helper `assertEpisodeNotGenerating` 复用 isEpisodeLockedNow,两入口都加守卫
  - **B1** 三个 LLM 入口完全不写 GenerationAttempt → ROI/PromptEdit 训练源头断:
    - storyboard.generateForEpisode 每场 attempt(action=TEXT,RUNNING→SUCCESS/FAILED)
    - script.analyze attempt(action=ANALYSIS)
    - asset.breakdown attempt(action=TEXT)
    - attemptId 都传给 provider 的 CallContext,让 base.ts 的 recordLedger 自动关联 CostLedgerEntry.attemptId
  - **B2** [`asset.ts:778`](packages/api/src/routers/asset.ts) — generateImage 失败路径既不写 attempt 也不写 ledger,抽卡率分母错。catch 内补写 FAILED attempt + success=false ledger,关联 attemptId
  - **B3** generateImage 硬编码 `unitPriceCny:'0'` → Phase 2 真 provider 接入对账全错。改成 `imageResult.costCny / count` 反推真单价
- ✅ **质量**:7 包 typecheck 全绿 / 36 core + 25 api 单测全过 / migration 已写未跑 / 工作区 10 modified + 3 untracked

**进行中**
- 🚧 D1 migration 待手动跑(`pnpm db:migrate`)
- 🚧 W5.1 UI 骨架 — 产品形态(详情面板 / 表格式 / 混合)等用户拍板

**问题 / 待决策**
- ❓ W5.1 产品形态(主交互节奏)— 之前 ask 被 dismiss,需要重新拍板
- ❓ D1 migration 跑的时机(收工 push 后立即跑?还是 W5.1 启动前跑?)
- ❓ P1/P2 共 17 项 audit followup 何时收(每周一波?还是 W5.2 启动前清?)

**下次接着做**
- 📌 跑 D1 migration → 验证 AssetUsageBinding 并发双插问题真修
- 📌 W5.1 启动:用户拍板形态后开干
- 📌 audit P1 部分集中跟(优先 VideoAssetRef 加 mediaUrl + propPrompt 接入 — W5.1 落地前刚需)

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
