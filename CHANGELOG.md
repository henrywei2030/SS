# Changelog

> 按时间倒序,最新在最上。版本号跟 `package.json`(`0.1.0` Phase 1 全程)。
> 仓库:https://github.com/henrywei2030/SS

---

## [Unreleased] · W8 实战准备

### 计划
- Tauri 桌面端真编译(需 Rust toolchain)
- DB Explorer 编辑模式(当前只读)
- 配 Claude API Key 真接 → 验证 requestId 真贯通日志
- 配 Seedance Key → 真出片 → W8 5 人冷启动

---

## 0.1.0 - 2026-05-24(W1-W7 + 19-20 轮 audit 加固 + W8 实战准备)

### 十八次收工 — 第 19-20 轮 audit 全栈加固(`573a659`)— **ADR-27**
- 🛡️ **60 次 debug 共 7 个 sprint**(Sprint A/A2/B/C/D + R2 F/G/H)
- 🔒 **5 项 P0/P1 修**(Sprint A):
  - auth email/username router `.transform` + adapter 双层 lowercase+trim(防绕过软删)
  - confirmCandidate / unconfirmSlot `advisory_xact_lock`(maturity race)
  - `sanitizeErrorMsg` helper (@ss/shared) + **5 处覆盖**(防真接 Provider 后 URL/token 泄漏)
  - media upload `ALLOWED_MIME_BY_KIND` 白名单(防 SVG XSS / PDF 假冒)
  - `.env.example` 补 7 个变量
- 🔗 **D-1 requestId 全链 7 节点贯通**:HTTP X-Request-Id / UUID → ctx → tRPC errorFormatter → 入队 Job → worker `[req=xxx]` 前缀 → response header → 前端 toast 后缀
- 🤖 **D-2 AgentTool meta 13/13 100% 覆盖**(ADR-27):asset.{create,generateImage,batchCreate,breakdown} / storyboard.{generateForEpisode,publishEpisode,mergeShots} / aigc.{generateVideo,bindAssetToGroup} / script.{upload,analyze} / project.{create,addMember} — Phase 2 Mastra 启动时扫 `.meta.agentTool` 自动注册零业务改动
- 📡 **D-3 EventBus dev trace + 4 publish 缺漏补**:STORYBOARD_GENERATED/PUBLISHED + ASSET_GENERATED/CONFIRMED 真触发订阅方(events.ts 不再死契约)
- 📚 **D-4 模块边界文档**:`docs/MODULES.md`(全景 + 依赖图 ASCII + 升级 hook 清单)+ 4 package README(api/core/queue/adapters)
- 🖥️ **R2 Tauri capabilities DRAFT**:`apps/desktop/src-tauri/capabilities/default.json`(Phase 1.5 启用)
- 💬 **R2 前端 trpc error-toast**:`apps/web/lib/trpc/error-toast.ts` showTrpcError 自动附 ` · req=xxxxxxxx` 后缀 + TrpcProvider 全局 mutationCache fallback
- 🔧 修 TS4023:TRPCMeta interface 加 export(build 失败但 typecheck 不报)
- 📝 **ADR-27** 第 19-20 轮 audit 全栈加固决议 → 推 ADR-30/31/32 占位
- 🧪 **W8 smoke**(`scripts/w8-smoke.mjs`)10/10 全过 — 真服务验证 admin 大写登录 / requestId UUID header / 自定义 X-Request-Id 优先 / error.data.requestId / zod issues / sanitize 错误 / cleanup
- ✅ typecheck 15/15 + test 25/25 + pnpm audit 无 vuln + DB 4 高频查询全 Index Scan
- 📊 改动:25 文件 +1164/-27 行(包含 ADR-27 + 6 文档)

### 十七次收工 — W1-W7 待完成事项盘点 + W8 启动 checklist(`20365ca`)
- 📝 新建 `docs/W1-W7-followup.md` 完整留尾清单(P0 实战阻塞 / Phase 1.5 / Phase 2 / Phase 3 四级 + 12 步 W8 checklist + 完成度精确盘点表)

### 十六次收工 — W7 收尾全交付 + 文档体系 + 全 7 task(`dbcdff7`)
- ✨ Tauri 桌面端骨架(`apps/desktop`)+ DB Explorer MVP + EN 文案 review + characterRole enums
- 📝 README + CHANGELOG 完整重写
- 📦 11 workspace 包:**2 apps + 1 desktop 骨架 + 1 worker + 7 packages**

---

## 0.1.0 - 2026-05-24(W6 + W5.6 + W7 收尾大批)

### 十五次收工 — W6 三波 + W5.6 + UX + audit + polish(`12e56a2`)
- ✨ **W6 Collab Hub 三波完整交付**
  - 波 1 `/admin/users` 全局用户管理(adminRouter.user list/setStatus/setAdmin/stats + 自锁防御)
  - 波 2 `/projects/[id]/team` 项目成员 + 集数分配(projectRouter 加 8 procedure + assertProjectAdmin helper)
  - 波 3 `/admin/reports` 工作报告(memberStats 跨 4 数据源聚合)
- ✨ **W5.6 Media Vault MVP** — mediaRouter 5 procedure + /library(4 tabs + 搜索 + 网格 + AIGC 角标)+ AIGC 自动沉淀
- 🐛 **6 项 UX 反馈修复** — nav team 入口 / scripts redirect / director home 合并 / 剧本整体显示
- 🐛 **第 3 轮 audit 5 项** — 双 worker stale cutoff / SSE 空 media 兜底 / insights successRate 公式 / SSE token 自动续期 / MediaItem partial unique migration
- 💄 **DateTime locale 11 处** — `toLocaleString('zh-CN')` → 浏览器自动 locale

### 十四次收工 — W5.5 BullMQ 异步全栈(`815eb97`)
- ✨ **W5.5 BullMQ video-gen worker 全栈交付**
  - `packages/queue` 新包(BullMQ + ioredis + HMAC SSE token)
  - `apps/workers/video-gen` 新独立进程(graceful shutdown + stale 扫描 + /health)
  - `aigc.generateVideo` 异步化(入队后立即返回 + worker 跑 provider + Redis pub/sub + SSE)
  - HMAC 5min token 鉴权 + 前端 `useAigcProgress` hook 实时进度
- ✨ **W5.5.1 扩展参数**(对照即梦/可灵 UI)— 分辨率/音频/水印/参考素材 + `'auto'` 比例
- ✨ **W7 后台轻量四页** — `/admin/{audit, api-usage, settings, health}`
- 🐛 **14 项 audit**(第 1 轮 8 + 第 2 轮 6)— lockDuration / stalled / idempotency / 失败白名单 / age 维度 / Redis 节流 / 入队失败兜底 / SSE race / 等
- 📝 **ADR-25 v2 + v3**(同行借鉴 12 项映射 + 8 项 Phase 2 升级空间 L1-L8)
- 📝 **ADR-26 跨模块 Agent 联动接口预留**(13 mutation 候选,Phase 2 Mastra 落地前置)

### 十三次收工 — 7+1 轮深漏洞 audit(`78a75a8`)
- 🔐 **12 项真 vuln 全修** — 认证/注入/并发/经济/泄漏/供应链/部署 7 维度 + 系统层 5 项
  - aigc advisory lock 在事务外失效 / auth.login 时序攻击 / setSetting isSecret 明文 / set-admin-password 弱默认 / db:reset 生产守卫 / 等

### 十二次收工 — Phase 0 体检 + 仓库清理 + V2 强同步(`3fd4f5c`)
- 📐 **改进意见 Step 1**(同行研究规划纠错)— ADR-22 Mastra over LangGraph / ADR-23 首尾帧 / ADR-24 反向护城河
- 🧹 **仓库清理 33 文件** — 删 .d.ts/.js 撒源码 + tsbuildinfo + 释放 106MB
- 📝 **CLAUDE.md V2 强同步协议** — 开工/收工自动化 Git 强对齐

### 十一次收工 — W1-W7 全栈 audit 29 项(`8a4b2d4`)
- 🐛 **P1/P2/P2 followup 30+ 项** — Episode 软锁覆盖 / mut 软锁守卫 / Decimal cost ledger / memoization / Shot schema movement/lighting

### 十次收工 — W5 收尾 + W6 数据洞察 + W7 后台三件套(`315ecd7`)
- ✨ **W5 完整收尾** — SystemSetting 数据底座 + token 化 prompt + AIGC 工作台 + Seedance Mock 抽卡
- ✨ **W6 数据洞察 MVP** — insightsRouter 3 procs + KPI/趋势/分布/Top10
- ✨ **W7 后台三件套** — admin/prompts(版本树)+ admin/styles + admin/presets(4 类预设)

### 八/九次收工 — W5.0/W5.1/W5.2(`cff42b5` / `a56e352`)
- ✨ **W5.0 视频生成数据底座** — SystemSetting + compileShotVideoPrompt + providerJobId
- ✨ **W5.1+ AssetUsageBinding shotGroup 维度** — refSlotIdx + compileShotGroupVideoPrompt token 化
- 🐛 **W1-W5 跨模块 audit P0 8 项**(D1 partial unique / D2 publish 状态守卫 / A1 maturity 重算 / 等)

### 七次收工 — Win 跨平台接入(`d6fee81`)
- 📐 **跨设备协作工作流升级** — Win 笔记本接入方案 + scripts/init-env.mjs + preflight 跨平台

### 六次收工 — W3.1.followup + W5.0 数据底座(`d661f43` / `72cb995` / `5356a27`)

### 五次收工 — W4 完整交付 + 6 轮 audit(`7d4c13a` + 之前 commits)
- ✨ **W4 Asset Forge 完整交付** — 数据建模 + 编辑弹窗三栏 + Mock ImageProvider + 缺口检测 + 审计页
- 🐛 **6 轮 audit 修 70+ 项** P0/P1

### 三/四次收工 — W3 分镜工坊全交付(`eea3556` / `cf21b58` / `ff872b3`)
- ✨ **W3 Storyboard Studio** — 数据底座 + 11 procedures + 多格式上传(docx/md/txt/rtf/html)+ 三栏 UI + 合并拆分 + 行内编辑入训练集 + 字号/进度/CSV
- 🐛 **3 轮 audit**(P0 19 项 + P1 9 项)

### 二次收工 — 文档体系 + 协作工作流(`7bc8722` ~ `e6e3382`)
- 📝 **docs/ 完整规划文档体系** — 8 份共 2086 行(愿景/架构/模块/路线图/数据/ADR/指南)
- 📝 **TODO/PROGRESS 文档体系建立**
- 📝 **CLAUDE.md 项目级协作规范**
- 📝 **"收工"协议升级为自动执行模式**

### 一次收工 — W1 + W2 + UI 系统(`225692c` + `1fa4435`)
- ✨ **W1 基础设施** — Monorepo + Prisma 24 表 + 3 Adapter + Cost Ledger + Docker + 核心算法
- ✨ **W2 应用层** — tRPC v11 + 6 子路由 + Next.js 15 + Mission Control + Story Compass
- ✨ **UI 系统** — Cursor 风格 + 双主题(明亮/深夜)+ Logo 系统 + 后台字号 + Sonner Toast

---

## 累计指标(Phase 1)

| 维度 | 数值 |
|---|---|
| 收工次数 | 15 次 |
| Git commits | 30 个 |
| 文件数 | 230+ |
| 代码行数 | ~42,000+ |
| Migration | 19 个 |
| ADR | 27 条(ADR-27 第 19-20 轮全栈加固) |
| Audit 修复 | ~95 项(P0/P1/P2)— 含 60 次 debug 第 19-20 轮 |
| Tests | 110+ 单测 + W8 smoke 10/10 全过零回归 |
| Workspace 包 | **11 个**:2 apps + 1 desktop 骨架 + 1 worker + 7 packages |
| AI Provider | Mock 全链路 + Claude/Seedance 真接入预留 |
| Agent 接入 | 13/13 核心 mutation `.meta(agentTool)` 100% 覆盖(Phase 2 Mastra) |

---

## 版本规范

- Phase 1 全程使用 `0.1.0`,通过 commit + tag 区分迭代
- Phase 2 升级 `0.2.0` 起 — 多模型 Race + 内置剪辑 + Stripe + 云端化
- Phase 3 升级 `0.3.0` 起 — Canvas / 3D / Distribution / Plugin SDK
