# 05 · 关键架构决策 (ADR)

> 决策记录 = "为什么这么定" 的留痕。
> 改任何架构层面的事情前，先查这里，避免重复踩坑。

---

## 记录格式

```
## ADR-XX · 标题
日期: YYYY-MM-DD · 状态: ✅ 已采纳 / 🔄 待复审 / ❌ 已撤销
决策: 一句话
替代方案: ...
理由: ...
代价 / 风险: ...
```

---

## ADR-01 · LangGraph 做多 Agent 编排
**日期**:2026-05-21 · **状态**:❌ 已撤销(2026-05-24,见 ADR-22)

**决策**(原):Phase 2 引入多 Agent 时用 LangGraph,不用自研 / CrewAI / AutoGen。

**替代方案**:
- 自研 — 工作量大、缺成熟工具
- CrewAI — Python only、可观测弱
- AutoGen — Microsoft 系,节奏不稳

**理由**(原):
- 有状态图(State Graph)一等公民
- Human Gates 内置(关键节点必须人工确认)
- 可观测:每步推理链可追溯
- LangSmith 配套集成

**风险**:Python 服务额外部署成本,多 Agent token 用量需 Budget 控制。

**撤销原因**(2026-05-24):
- LangGraph 是 Python 一等公民,引入到我们 TS monorepo 是巨大工程负担(进程隔离 / 跨语言序列化 / 部署多一套)
- huobao-drama(12k star 同赛道生产实战)已用 Mastra,2026 TS 生态事实标准
- Mastra 2026-02 加入 supervisor 模式,多 agent 编排能力跟 LangGraph 几乎对齐
- 我们已有自己的 Cost Ledger,不需要付费 LangSmith observability
- 新决策见 **ADR-22**

---

## ADR-02 · Modular Monolith 起步
**日期**：2026-05-21 · **状态**：✅ 已采纳

**决策**：Phase 1 用模块化单体（Modular Monolith），不一开始就微服务。

**替代方案**：从 Day 1 就拆 microservice。

**理由**：
- 5 人团队 + 6-8 周交付时间
- 模块边界通过 monorepo packages 清晰
- 任何 package 都可在 Phase 3 按真实负载拆出去
- 避免早期过度工程化

**信号**：依赖方向严格单向（shared → db → ... → web），无循环。

---

## ADR-03 · CRDT 用 Y.js
**日期**：2026-05-21 · **状态**：📋 W3 开始

**决策**：实时协作用 Y.js + Hocuspocus，不用 OT / ShareDB / Liveblocks。

**替代方案**：
- OT — 历史方案，冲突合并复杂
- ShareDB — 老牌但生态萎缩
- Liveblocks — 商业托管，绑定供应商

**理由**：
- CRDT 自动冲突合并
- 离线可用
- 开源自托管（Hocuspocus）
- 同源数据模型 — Phase 3 Wireless Canvas 直接复用

**Phase 1 范围**：只在分镜表试点，验证后扩展。

---

## ADR-04 · LiteLLM 做模型适配
**日期**：2026-05-21 · **状态**：📋 Phase 2 启用

**决策**：Phase 2 接入更多模型时统一用 LiteLLM，不直连各模型 SDK。

**理由**：
- 一行代码切 Provider
- 内置 failover + retry
- Cost ledger 拦截统一
- 支持 OpenAI 兼容协议（豆包 / 通义 / 阿里云）

**Phase 1 暂未启用**：直接接 Seedance + Claude，因为接口稳定 + 调试简单。

---

## ADR-05 · Tauri > Electron
**日期**：2026-05-21 · **状态**：✅ W7 实施

**决策**：桌面端用 Tauri 2，不用 Electron。

**对比**：
| 维度 | Tauri | Electron |
|---|---|---|
| 包体积 | ~3-10 MB | ~100-200 MB |
| 内存 | ~80 MB | ~250 MB+ |
| 启动速度 | <1s | 3-5s |
| 安全 | Rust 后端 + capabilities 模型 | Node.js 全权 |
| 生态 | 较新但 v2 稳定 | 成熟广泛 |

**理由**：体积 10x 小、内存 3x 低、安全更好；macOS 用户对体积敏感。

**风险**：调试体验略差于 Electron。

---

## ADR-06 · pgvector + Meilisearch（不上 Pinecone）
**日期**：2026-05-21 · **状态**：📋 Phase 2 启用

**决策**：向量检索用 Postgres pgvector，全文搜用 Meilisearch；不引入 Pinecone / Weaviate。

**理由**：
- 一个 Postgres 实例搞定 OLTP + 向量
- 数据不出本地 DB（合规友好）
- 初期数据量小，pgvector 性能足够
- Pinecone 月费 $70+ 不划算

**升级路径**：数据量 > 1000 万向量时，再考虑迁移到专用向量库。

---

## ADR-07 · 长流程不用 Temporal（Phase 1）
**日期**：2026-05-21 · **状态**：✅ 已采纳

**决策**：Phase 1 用 BullMQ；Phase 2 视频生成→剪辑→审核这种"一周级"流程引入 Temporal。

**理由**：
- BullMQ 适合短任务（<10 分钟）
- Temporal 适合需要持久化、人工 gate、版本演进的工作流
- Phase 1 视频生成可用 BullMQ + 数据库状态机就够

---

## ADR-08 · 数据模型预留 Canvas / 3D / 多语言字段
**日期**：2026-05-21 · **状态**：✅ 已采纳

**决策**：Phase 1 schema 提前埋好 Phase 2/3 字段，不增加现期工作量。

**已埋钩子**：见 `docs/04-data-model.md § 4`，共 15 个升级字段。

**理由**：
- 字段空着不影响 Phase 1 业务
- 避免 Phase 2/3 大规模 migration
- 字段命名经过推敲，比 Phase 2 临时加字段更稳

**代价**：Schema 看起来"复杂"，但配套有 `docs/04-data-model.md` 文档解释。

---

## ADR-09 · API Key 后台加密入库（不依赖 .env）
**日期**：2026-05-21 · **状态**：✅ W1.7 已实施

**决策**：所有 AI Provider API Key 通过后台 UI 录入，AES-256-GCM 加密存数据库。

**替代方案**：仅用 .env 文件。

**理由**：
- 普通用户不需要编辑 .env
- 多人团队可分发 admin 权限
- 切换 Key 无需重启
- Phase 2 多租户时每个 tenant 独立配 Key

**保留兼容**：`.env.local` 仍可作 fallback（私有部署应急通道）。

**密钥管理**：`APP_MASTER_KEY` 由 .env 提供，64 字符随机串（`openssl rand -hex 32`）。

---

## ADR-10 · 双主题切换默认深夜模式
**日期**：2026-05-21 · **状态**：✅ 已实施

**决策**：明亮 + 深夜双主题，默认深夜（Cursor 同款）。

**深夜模式背景**：`#1F1F1F`（柔和暗色），不用 `#121212`（太暗刺眼）。

**理由**：
- 长时间使用更舒适
- 与 Cursor / VS Code 默认主题一致
- 用户可随时切换

**技术实现**：
- CSS 变量驱动（`@theme` + `:root.dark`）
- 防 FOUC 内联脚本
- localStorage 持久化

---

## ADR-11 · i18n 用 next-intl（不用 react-i18next）
**日期**：2026-05-21 · **状态**：✅ 已实施

**决策**：用 next-intl（Next.js 官方推荐），不用 react-i18next。

**理由**：
- Next.js 15 App Router 原生支持
- ICU MessageFormat（复数 / 性别 / 日期）
- 静态生成时正确 hydrate
- 服务端 / 客户端统一 API

**Phase 2 扩展**：JP/KR/TH/ES，加 locale JSON 即可。

---

## ADR-12 · 中性灰 + 蓝 accent（Cursor 风格）
**日期**：2026-05-21 · **状态**：✅ 已实施

**决策**：UI 风格全面采用 Cursor 极简风。

**替代尝试**：
- v1 极光金（aurora gold）— 装饰太重
- v2 Cursor 极简 — 信息密度高、不抢戏
- v3 双主题（明亮 + 深夜）— 当前

**理由**：
- 内容创作工具需"低噪音 UI"
- 用户从 IDE 切过来无门槛
- Logo / 模块色仍可点缀（不冲突）

---

## ADR-13 · 字号系统：前台 13px / 后台 14px
**日期**：2026-05-21 · **状态**：✅ 已实施

**决策**：默认 13px，admin 区域包 `.admin-pane` 类自动 +1px。

**理由**：
- 前台密集（Mission Control 列表 / 项目卡）需高密度
- 后台 admin 是"耐心查"的场景（看日志 / 改配置）需易读
- 一个类切换全 admin 区域，无侵入

---

## ADR-14 · ESM `.js` 扩展名 + Webpack extensionAlias
**日期**：2026-05-21 · **状态**：✅ 已实施

**决策**：所有 .ts 源文件互相 import 时写 `from './foo.js'`（NodeNext / ESM 规范），Next.js 配 webpack `extensionAlias` 把 .js 解析到 .ts。

**理由**：
- NodeNext / pure ESM 是 Node.js 现代标准
- monorepo TS 包能直接被 Node 跑（不需要先编译）
- Next.js 通过一行配置解决 webpack 兼容

**踩坑**：
- 不能写 `from './foo'`（缺扩展名）— ESM 严格模式会报错
- 不能写 `from './foo.ts'`（不规范）

---

## ADR-15 · 全 @theme 颜色用 var(--xxx)（不嵌套 hsl）
**日期**：2026-05-21 · **状态**：✅ 已实施

**决策**：Tailwind v4 `@theme` 中颜色 token 存 `var(--bg)` 不存 `hsl(var(--bg))`。

**踩坑历史**：
- 曾经写 `--color-background: hsl(var(--bg))`
- 业务代码 `bg-[hsl(var(--color-background))]`
- 浏览器解析为 `hsl(hsl(0 0% 12%))` — **嵌套 hsl 无效！**

**正确做法**：
```css
@theme {
  --color-background: var(--bg);  /* 不要 hsl() 包裹 */
}
:root.dark { --bg: 0 0% 12%; }
```

---

## ADR-16 · EventBus Topics 集中类型化定义
**日期**：2026-05-21 · **状态**：✅ 已实施

**决策**：所有 EventBus topic 在 `packages/shared/src/events.ts` 集中常量化 + 类型化 Payload。

**46 个 topic** 分 12 个领域（项目 / 剧本 / 分镜 / 资产 / AIGC / 媒体 / 剪辑 / 合规 / 配音 / 发行 / 成本 / 团队）。

**理由**：
- 跨包订阅时无 typo
- TS 自动推断 Payload 类型
- Phase 2/3 新模块直接找现成 topic 接

**使用模式**：
```typescript
import { EVENTS, EventOf } from '@ss/shared/events';
bus.publish<EventOf<typeof EVENTS.GENERATION_COMPLETED>>(EVENTS.GENERATION_COMPLETED, ...);
```

---

## ADR-17 · 不引入 ClickHouse（Phase 1）
**日期**：2026-05-21 · **状态**：✅ 已采纳

**决策**：Phase 1 数据分析直接查 Postgres，不引入 ClickHouse。

**触发升级条件**：CostLedgerEntry 表 > 1 亿行 OR Phase 3 接入 Distribution 数据后。

**理由**：
- 5 人团队 30 天内的数据量远低于 PG 极限
- ClickHouse 运维成本高
- 多写一次的同步逻辑容易出错

---

## ADR-18 · 模块化文档体系 + docs/ 单一真相源
**日期**：2026-05-21 · **状态**：✅ 已实施（本文档体系）

**决策**：所有规划文档放 `docs/` 内，**不依赖项目外文件**（`~/.claude/plans/`、Downloads、个人云盘等）。

**理由**：
- `git pull` 即同步规划
- 跨设备 / 团队接力无障碍
- 防止"两份规划不同步"

**包含**：
- `00-vision-and-positioning.md` — 愿景定位
- `01-architecture.md` — 架构
- `02-modules-design.md` — 模块设计
- `03-roadmap-and-progress.md` — 路线图与进度
- `04-data-model.md` — 数据模型
- `05-tech-decisions.md`（本文件）— 决策日志
- `HOME-SETUP.md` / `THEMING.md` / `W2-admin-module-spec.md` — 操作指南

---

## ADR-19 · Episode 软锁 = DB 列 + advisory_xact_lock(不用纯应用层)
**日期**：2026-05-22 · **状态**：✅ 已实施(W3.1.followup)

**决策**:防 `generateForEpisode` 重入双重扣费,用**两层锁**:
1. 业务层:Episode.status='GENERATING' + generatingStartedAt 软锁(可见、可审计、跨进程持久)
2. 抢锁原子性:Postgres `pg_advisory_xact_lock(hashtext('episode_lock:' || id))` 串行化同一 episode 的 CAS

**替代方案**:
- 纯进程内 Map / Mutex — 多 worker 部署无效
- Redis SETNX — 多一个依赖,且故障恢复语义复杂
- Postgres `SELECT ... FOR UPDATE` — 锁行长,事务大;只解决并发不解决"用户可见状态"
- DB unique 约束 — 不可表达"独占运行中"

**理由**:
- 软锁状态 UI 可见(用户能看到"正在生成中")
- advisory lock 是非阻塞、事务级、自动释放(crash 也释放)
- 15 分钟 stale TTL 自愈:进程崩溃后下次抢锁自动接管,不需要人工
- admin.episode.forceUnlock 提供逃生口,操作可审计(写 OperationLog)

**代价 / 风险**:
- 多了一个枚举值(GENERATING)— UI 需要处理这个状态
- "previousStatus 恢复"在 stale 接管时只能退回 NOT_STARTED(真实历史已丢)— 接受,极少触发
- finally 内 release 失败不能掩盖原始错误,只 log → 极端情况下死锁需等 TTL 或人工解锁

**测试覆盖**:14 个并发场景单测(packages/api/src/utils/episode-lock.test.ts)

---

## ADR-20 · W1-W5 跨模块 audit P0 集中修(2026-05-23 八收工)
**日期**:2026-05-23 · **状态**:✅ 已实施

**背景**:4 个 parallel agent 跨模块 audit 共扫出 25 项(8 P0 / 10 P1 / 7 P2)。本 ADR 记录 8 项 P0 的设计决策依据 — 这些决策跨多个模块,影响 W5+ 的数据底座对齐。

### D1 · AssetUsageBinding 用 partial functional unique 取代复合 unique
**问题**:`@@unique([assetId, episodeId, sceneId, shotId, usageType])` 中 sceneId/shotId 是 nullable。PG 中 `NULL ≠ NULL`,并发两个 `(陆乘, 第14集, null, null, APPEAR)` 不会被唯一约束拦住,asset.ts 的 findFirst 防御也救不了(P2002 不触发)。
**决策**:用 partial functional unique index — `COALESCE(sceneId, '') / COALESCE(shotId, '')` 当 sentinel,`WHERE deletedAt IS NULL` 只对活跃行强制唯一。
**替代方案**:用 `''` 替换 null 数据(改 schema 类型,破坏性大);Prisma 中暂无原生支持 `@@unique WHERE` — 在 schema 注释化 `@@unique`,真索引手写在 migration。
**代价**:未来 `prisma migrate dev` 看不到约束在 schema,需在 schema 注释明确指出迁移文件位置。

### D2 · publishEpisode 加 status 白名单 + 事务内 CAS
**问题**:publishEpisode 无条件 `status: 'IN_PROGRESS'`,COMPLETED/ARCHIVED 终态会被 downgrade。
**决策**:守卫 + 事务内 prisma extended where unique(`where: { id, status: { in: [...] } }`)— P2025 错误化"被另一请求改成终态"的 TOCTOU 缝隙。

### A1 · setComplianceManually 强制重算 maturity
**问题**:complianceStatus 改 APPROVED 后,L4→L5 升级不触发,UI 显示永远 L4。
**决策**:同事务 findFirstOrThrow + 投影后 computeMaturity,与 confirmCandidate/unconfirmSlot 对齐 — 任意 maturity 关键字段变化必重算。

### A2 · archetypeKey 在 breakdown LLM 输出端必出
**问题**:LLM 不输出 archetypeKey → batchCreate 全为 null → listArchetypeVariants 永远空 → W4-MM.7 变体能力实质废掉。
**决策**:SYSTEM_PROMPT 加"第 8 条 archetypeKey"规则 + 3 个示例(陆乘/luchengjia_tuwu/guali_1983),AssetDraft 接口加字段,parseDraftArray 提取。**LLM 输出端是变体管理的唯一入口**,从源头修而不是 router 端补 — 后续手动 create 也走同 schema。

### C1 · Episode 软锁覆盖到 script.upload/uploadFile
**问题**:generateForEpisode 已用 ADR-19 软锁,但 script.upload 在 GENERATING 期间能换剧本 → 跨版本 shot。
**决策**:新 helper `assertEpisodeNotGenerating` 复用 `isEpisodeLockedNow`,两个 script 上传入口先调。**与 ADR-19 同一锁系统的覆盖扩展**,不引入新锁机制。
**P1 followup**:mergeShots/splitGroup/updateShot/deleteShot 也应该加,但属 P1 留下次。

### B1 · GenerationAttempt 三入口全量贯穿(action 枚举从此点亮)
**问题**:storyboard.generateForEpisode / script.analyze / asset.breakdown 三个 LLM 入口完全不写 GenerationAttempt → schema.prisma 加的 ANALYSIS/BATCH_ANALYSIS 枚举无人使用,Phase 2 ROI / PromptEdit 训练源头断。
**决策**:每入口 wrap 一段 `attempt = create(RUNNING) → call provider with ctx.attemptId → update(SUCCESS/FAILED)`。**attemptId 透传到 provider 的 CallContext,base.ts 的 recordLedger 自动写 CostLedgerEntry.attemptId**,统一计费链路完整性。
**代价**:每入口多 2 次 DB 写,但都很轻(单表 create/update),且这是 Phase 2 ROI 必需。
**Phase 2 注意**:真 ImageProvider 接入后,base.ts 自动写 CostLedger + router 显式写 CostLedger 会**双写** — 需在 ctx 加 `skipLedger: true` 或彻底删 router 端 ledger.create。P1 followup 记账。

### B2 · generateImage 失败路径补 attempt + ledger(成功率分母完整)
**问题**:catch 内只 logOperation,FAILED attempt 和 success=false ledger 都不写 → 抽卡率(SUCCESS / (SUCCESS+FAILED))分母永远缺,Phase 2 ROI 失真。
**决策**:catch 内 sequential 创建 FAILED attempt → attemptId 写 ledger(success=false)。**不和成功路径放同一事务**(provider 已抛错,事务回滚没意义)。

### B3 · generateImage 单价从 imageResult 反推,不硬编码 '0'
**问题**:Phase 1 mock 单价 0 OK,但代码里写死 `'0'` 会让 Phase 2 真接 NanoBananaProvider(0.04 CNY/图)后 attempt 和 ledger 全锁成 0,对账全错。
**决策**:`unitPriceCny = (costCny / count).toFixed(6)` 反推,任何 provider 都正确。

**整体测试覆盖**:7 包 typecheck 全过 / 36 core + 25 api 单测全过(无新单测,既有覆盖未破)。
**migration 状态**:`20260523103000_audit_p0_assetusage_partial_unique` 已写,待手动 `pnpm db:migrate` 应用。

---

## ADR-21 · W5 后期升级接口预留(Phase 2/3 接手指南)
**日期**:2026-05-23 · **状态**:📋 已规划

W5.0-W5.4 是 MVP,以下是 Phase 2+ 升级接口的设计预留 — 在不破坏现有 API 的前提下加新能力。

### 1. UsableRange:部分可用片段标记(原 04AIGC.md §11.4)
**场景**:一个 15s 抽卡视频里只有 5s-10s 可剪,其他是废片。
**升级接入**:
- 新表 `usable_ranges`:`id / takeId (→ generationAttempt.id) / startSec / endSec / linkedShotIds[] / note / score / createdBy`
- 新 mutation `aigc.markUsableRange(takeId, range)` / `aigc.listRanges(takeId)`
- UI:在视频预览下方加时间轴 + 框选保存可用区间
- **不动现有**:GenerationAttempt.adopted/rejected 单字段保留,新功能叠加

### 2. EditDelivery:送剪辑模块(W6 启动时)
**场景**:用户在 AIGC 工作台选定可用片段,push 到 W6 剪辑模块时间轴。
**升级接入**:
- 新表 `edit_deliveries`:`id / episodeId / shotGroupId / takeId / rangeId? / usageType (main_shot/insert/b_roll/transition/backup) / editSlotId? / status (delivered/accepted/rejected) / deliveredBy / deliveredAt / note`
- 新 mutation `aigc.deliverToEdit({takeId, rangeId, usageType})` / `edit.acceptDelivery / rejectDelivery`
- EventBus topic `EDIT_DELIVERY_CREATED`(events.ts 顶部加,与 EDIT_TIMELINE_UPDATED 平级)
- **不动现有**:不修 GenerationAttempt,只新增表

### 3. 失败原因标签(GenerationAttempt.issueTags)
**场景**:用户审核标"人物串脸 + 手部错误",数据驱动优化。
**升级接入**:
- GenerationAttempt 加 `issueTags Json @default("[]")` 字段(migration 1 行 alter)
- 标签字典见 04AIGC.md §11.6(人物 / 场景 / 动作 / 情绪 / 道具 / 镜头 / 连续性 / 技术 / 台词 / 可剪性 等 10 类)
- UI:rejectVideoTake dialog 加 tag multiselect
- **不动现有**:errorMsg / rejected 单字段保留兼容

### 4. IVideoProvider capability flags
**场景**:不同厂商支持的功能不同(Seedance 支持 firstFrameImage,Kling 不支持),UI 应按 capability gate 功能。
**升级接入**:
- `ProviderInfo` 加 `capabilities?: { supportsFirstFrame?: boolean; supportsLastFrame?: boolean; supportsAudio?: boolean; supportsBatch?: boolean; maxRefImages?: number; supportedDurations?: number[] }`
- SeedanceProvider / KlingProvider 等在 constructor 内填充
- UI 在生成面板按 capabilities 显隐控件(如 "首帧图" 输入框)
- **不动现有**:ProviderInfo 顶层字段不动,只新增可选字段

### 5. W5.5 BullMQ 异步化(取代当前同步阻塞)
**场景**:Mock provider 200ms 返,真 provider(Seedance)5-60s — 同步阻塞 tRPC 会超时。
**升级接入**:
- 新 package `packages/workers/video-gen-worker`(BullMQ + Redis)
- `aigc.generateVideo` 拆两步:① 创建 attempt(status=QUEUED)+ enqueue → 立即返;② worker 拉队列调 provider → 更新 attempt(SUCCESS/FAILED)+ publish event
- 前端 `aigc.listVideoTakes` 已能展示 RUNNING/QUEUED 状态,UI 不动
- 客户端轮询 / SSE 接 EventBus 推 UI 实时更新
- `providerJobId` 字段已铺路(W5.0 加的),supports webhook 回调
- **不动现有**:Mock provider 同步路径保留(dev/测试用 W5.4 当前 mock-video.ts)

### 6. 复杂度评分 + 备用镜头建议(04AIGC.md §16.3 + §21.8)
**场景**:LLM 预估"这个生成段太复杂(人物多 + 动作复杂 + 文字多),建议拆分"。
**升级接入**:
- 纯函数 `packages/core/storyboard/complexity.ts(prompt, references) → { score: 1-10, factors: ['人物多','道具多',...], suggestions: ['拆成 X / Y'] }`
- aigc router 加 query `aigc.estimateComplexity(groupId)` 调上面函数
- UI 在生成按钮旁加"复杂度评分"小芯片
- **不动现有**:纯计算,不动 schema 也不动现有 router

### 7. shotGroup composition 灵活性(已部分预留)
**场景**:用户不只想要 W3 默认的连续 shot 合并,而是任意 shot 组合(shot 3 + shot 7 + shot 12)。
**当前状态**:
- ShotGroup.shots 已是多对多语义(Shot.groupId)— 一个 shot 属于一个 group,group 可挑任意 shot
- 缺的是 UI:跨 shot 拖拽到 group 的交互
- W5 已提供 createEmptyGroup + renameGroup + archiveGroup,基础够用
**升级接入**:
- 在 storyboardRouter 加 `moveShotsToGroup(shotIds[], groupId)` 已经存在(W3.5 split/merge 的能力)
- AIGC 工作台 UI 加"管理 shots"按钮,跳到 storyboard tab 完成 — 不在 AIGC 模块重做合并/拆分

### 8. 协作锁(多人编辑同 group 时)
**场景**:两个 AIGC 操作员同时改同 group 的 prompt 或 binding。
**升级接入**:
- ShotGroup 加 `lockedBy String?` + `lockedAt DateTime?`(已有类似 Asset 的 lockedAt 模式)
- mutation 之前 check `lockedBy === ctx.user.id || stale`,否则 CONFLICT
- 60s 心跳续约,断开自动释放
- **不动现有**:加字段而非新表

### 实施优先级
1. 立即可做(无新表):#3 issueTags / #4 capabilities / #6 复杂度
2. W5 收尾后第一波:#1 UsableRange / #8 协作锁
3. W6 启动联动:#2 EditDelivery / #5 BullMQ

---

## 撤销决策的流程

如果某个 ADR 被推翻：
1. **不要删除**它，保留历史
2. 把状态改为 ❌ 已撤销
3. 在末尾追加段落："撤销原因 / 新决策见 ADR-XX"
4. 在 `PROGRESS.md` 记一条

---

## ADR-22 · Phase 2 Agent 编排选 Mastra(取代 ADR-01 LangGraph)
**日期**:2026-05-24 · **状态**:✅ 已采纳(SUPERSEDES ADR-01)

**决策**:Phase 2 P2.4 多 Agent 评审用 [Mastra](https://github.com/mastra-ai/mastra)(TS 全栈 agent 编排框架),不用 LangGraph(Python)。

**替代方案对比**:

| 维度 | Mastra | LangGraph |
|---|---|---|
| 语言 | TS 一等公民 ✅ | Python 一等公民,JS bindings 二等 |
| Star | 22.3k | 30k+ |
| 生态 | 30 万周下载,Replit/PayPal/Adobe 生产化 | 论文引用最多 |
| MCP 支持 | 一等公民 | 二等 |
| 多 agent | 2026-02 加入 supervisor 模式 | 成熟 |
| 中断恢复 | suspend & resume | checkpoint + resume |
| 部署 | Vercel 原生 | 需要 LangServe(Python 服务) |
| 跟我们 BullMQ 共存 | 完全兼容(同 TS 进程) | Python 进程隔离 |
| 跟我们 Cost Ledger 集成 | 自己写(简单) | LangSmith 付费 |

**理由**:
1. **栈一致性 P0**:我们整个 monorepo 是 TS(packages/api / core / web / adapters / workers 全 TS),引入 Python 进程是巨大负担(进程隔离 / 跨语言 RPC / 部署多一套 / 监控多一套)
2. **生产验证**:huobao-drama(12k star 同赛道 AI 短剧产品)已用 Mastra,业务可行性已验证
3. **MCP 一等公民**:对未来 Skill 化设计(把工坊拆成 Skill)有用
4. **可观测**:我们有自己的 CostLedgerEntry + GenerationAttempt + OperationLog,不需要付费 LangSmith
5. **Vercel 原生**:我们 web 在 Next.js 15,Mastra 跟同栈无缝

**Trade-offs**:
- supervisor 模式 2026-02 才加,比 LangGraph 成熟度差;但我们 Phase 2 P2.4 才用,2026 下半年时差距应已消除
- LangGraph 的 checkpoint 持久化能力略强;我们如果 Phase 3 真做"长篇剧本一次拆 60 集 LLM"再评估切换

**Inspiration**:[chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama)(无 LICENSE,🔴 仅对照观察)
**Implementation**:我们独立写自己的 Mastra workflow,不复制 huobao 代码,仅参考"Mastra 在短剧场景可行"这个结论

**关联**:撤销 ADR-01 / 跟 docs/05a-third-party-licenses.md 链接

---

## ADR-23 · Shot 加 startFrameMediaId / endFrameMediaId 预留首尾帧
**日期**:2026-05-24 · **状态**:✅ 已采纳

**决策**:`Shot` 表加 `startFrameMediaId String?` + `endFrameMediaId String?` 两个 nullable 字段,跟 MediaItem 建关系,**不立即在业务中使用**,Phase 2 真接 first/last frame 模式时启用。

**背景**:
- Seedance 2.0 / Veo 3.1 / Wan 2.6 / Pika 2.0 等主流视频模型 2025-2026 已全部支持 first/last frame(FLF2V)输入
- 业务流:用户先用 ImageProvider 出关键帧 → 选作 startFrame / endFrame → VideoProvider 用首尾帧 + prompt 生成
- 我们 Phase 1 直接 text-to-video,Phase 2 升级 I2V/FLF2V 时若不预留字段,要改 schema + worker + UI 三层

**替代方案**:
- 用 GenerationAttempt 的 inputJson 存(× 不可索引、不便于按帧重抽)
- Phase 2 才加(× migration 增量改 worker / Provider adapter 三处,工作量翻倍)

**理由**:**零成本预留**(2 个 nullable 字段,migration 1 行 ALTER TABLE),Phase 2 真用时只改业务代码不改 schema。

**Trade-offs**:无。nullable 字段对 Phase 1 完全透明。

**Inspiration**:改进意见 §9 P0-2 / [Wan-Video/Wan2.2](https://github.com/Wan-Video/Wan2.2) 原生 FLF2V 实现
**关联**:跟 ADR-21 §4 IVideoProvider capability flags 协同(capabilities.supportsFirstFrame / supportsLastFrame)

---

## ADR-24 · 反向护城河确认(已有 8 项独家设计不轻易砍)
**日期**:2026-05-24 · **状态**:✅ 已采纳

**决策**:以下 8 项设计经外部独立审视(2026-05-24 研究规划改进意见 §10)确认是**护城河**,任何"简化重构"提议必须先看本 ADR。

**护城河清单**:

| # | 设计 | 同行普遍状态 | 砍掉的后果 |
|---|---|---|---|
| 1 | `Asset.archetypeKey` 同人物多变体(陆乘-重生初期/疗伤期) | 同行 1 char = 1 row | 长剧本(50+ 集)角色情绪/造型阶段无法精确控制 |
| 2 | `AssetMaturity L0-L5` 升级路径 | OnlyShot 接近但无 maturity 字段 | 团队协作无法约定"这个 asset 还能不能用" |
| 3 | `PromptEdit` 训练集回流(4 类 targetType) | **完全独家** | 数据飞轮断裂,长期落后于自训 LoRA 同行 |
| 4 | `CostLedgerEntry` 不可篡改流水 | langfuse 有 trace 无 ledger | 商业 SaaS 出账纠纷无证可查 |
| 5 | 三大 Adapter 接口(Storage/Provider/EventBus 解耦) | fynt 部分,langfuse 全有 | 换 storage/provider 时(必然发生)伤筋动骨 |
| 6 | API Key AES-256-GCM 后台加密 + apiKeyMasked + apiKeyRef fallback | fynt AES-256-GCM,其他普遍明文 | 安全合规事件(GDPR / 等保) |
| 7 | Phase 2/3 升级 hook 字段预留(15+ 处) | 同行普遍"先用后改" | 表结构后期改不动 |
| 8 | Mock Provider 全链路兜底(picsum 占位) | LocalMiniDrama 离线模式 | 新人开发要等 API Key,2-3 周走不动 |

**砍除前的强制审视**:任何 PR 想简化掉上述任一设计,必须:
1. 写"砍除收益"(为什么觉得没用)
2. 写"对应风险"(从上面表对应行抄过来)
3. 找一个产品负责人 review

**关联**:[docs/04-data-model.md](04-data-model.md) 多处字段对应 / [docs/05a-third-party-licenses.md](05a-third-party-licenses.md) §4

---

## ADR-25 · W5.5 视频生成异步化(BullMQ worker + SSE 进度推送)
**日期**:2026-05-24 · **状态**:✅ 已采纳(W5.5 实施前敲定)

**决策**:视频生成从 tRPC handler 同步阻塞调用,改为 `apps/workers/video-gen` 独立 BullMQ worker 进程 + Redis pub/sub 推进度 + SSE endpoint 订阅推前端;handler 入队后立即返回 attemptId(QUEUED/RUNNING)。

### 背景

W5.0-W5.4 MVP 已完成,但 `aigc.generateVideo` 当前同步调 `provider.generate()`。真接 Seedance 时 createTask + 5-15 次 poll(每次 3s)= **30-60s 阻塞 tRPC handler**,导致:① HTTP 默认 30s 超时风险;② 前端转圈 1 分钟无反馈;③ W6 失败 Auto-Salvage / Phase 2 多模型 Race 都需要异步基础设施。

### 调研依据(2026-05-24)

对照同栈生产仓库实战代码,整合 12 项修订到设计:
- **[fynt](https://github.com/abhinavkale-dev/fynt)** (MIT, 364★, Next.js + tRPC + BullMQ + WS 同栈) — monorepo 三层 / queue 共享包 / HMAC 鉴权 / worker 模板
- **[langfuse](https://github.com/langfuse/langfuse)** (MIT, 27k★, 生产级 BullMQ worker 事实标准) — retry 5 次 / 白名单失败 / 25s grace shutdown / failed listener → DB

### 替代方案对比

| 方案 | 决策 |
|---|---|
| A. 维持同步 + 加超时 | ❌ 解决不了 HTTP 超时根本问题 |
| B. tRPC subscription (WebSocket) | ❌ 单向推送过度设计;Next.js App Router 对 WS 支持弱(fynt 因此拆独立 realtime app) |
| **C. BullMQ + SSE**(本 ADR) | ✅ TS 一等公民 / Redis 已有 / Next.js stream 原生 / 单向推送够用 |
| D. AWS SQS / Cloudflare Queues | ❌ Phase 1 本地 Docker,Phase 2 云端化时再评估 |

### 架构

```
[Browser]                  [tRPC handler]                  [BullMQ Queue]
  │  ① generateVideo          │                                  │
  │ ─────────────────────▶    │  ② 占位 attempt + 校验 + compile  │
  │                           │  ③ add job ──────────────────▶  │
  │  ④ { attemptId, RUNNING } │                                  │
  │ ◀─────────────────────    │                                  │
  │  ⑤ getStreamToken         │                                  │
  │ ─────────────────────▶    │                                  ▼
  │  ⑥ HMAC token (5min TTL)  │                          [apps/workers/
  │ ◀─────────────────────    │                           video-gen]
  │  ⑦ EventSource(token)     │                                  │
  │ ─────────────────────▶ [SSE /api/sse/aigc/[id]]              │
  │                           │ ⑧ Redis SUBSCRIBE               │
  │  ⑨ progress / success    │ ◀──────────────────── PUBLISH ──┤
  │ ◀─────────────────────    │           videogen:attempt:{id}  │
                                                                  │
                                                  ⑩ 落库 / ledger / event bus
```

### 模块清单

**M1 · `packages/queue` 新包**(队列声明跨 web+worker 共享)
- 暴露 `getVideoGenQueue()` + `VideoGenJobData` zod schema + `VIDEO_GEN_QUEUE_NAME = 'video-gen'` 常量
- 子路径 exports `./video-gen-queue` 让 web 入队和 worker 消费用同一份(防漂移)
- **不放 worker 内**:fynt 的明确教训,worker 反向被 web import 会破坏 monorepo 单向依赖

**M2 · `apps/workers/video-gen` 新独立进程**
- `apps/` 而非 `packages/`:这是部署单元不是 import 库
- 命名复数 `workers/` 留扩展空间(后续 `apps/workers/image-gen` / `apps/workers/audio-gen`)
- package `@ss/worker-video-gen`,scripts `dev: tsx watch src/index.ts` / `start: tsx src/index.ts`
- 入口:`bootstrap()` → loadEnv → validate → `new Worker(..., { autorun: false })` → `await worker.waitUntilReady()` → `worker.run()`
- `workerId = "videogen-${pid}-${Date.now()}"` 打日志追溯
- `concurrency: 1`(视频生成 GPU 重,fynt 是 5 因为它是 workflow 节点轻量)

**M3 · defaultJobOptions(集中,不在 add() 处散写)**
```ts
{
  attempts: 5,                                  // langfuse 全部 ≥ 5(草稿 3 太低)
  backoff: { type: 'exponential', delay: 5000 }, // 实际:5/10/20/40/80s
  removeOnComplete: { count: 100 },              // 调试足够
  removeOnFail: { count: 1000 },                 // W7 后台审计页拉历史
}
// jobId = `videogen:attempt:${attemptId}` → BullMQ 内建去重(替代 Redis SETNX)
```

**M4 · 失败重试策略(白名单制,langfuse 关键发现)**
- 默认行为:processor `try/catch` 后 **return**(标 FAILED **不重试**)
- 只对临时性错误抛错触发 retry:`timeout` / `429 rate_limit` / `5xx server_error` / `network reset`
- 业务硬错(censored / compliance_required / quota_exceeded):`throw new UnrecoverableError(reason)` (BullMQ **内置**,不要自定义 — langfuse 自定义那版是绕了一圈)
- mock provider 的 `failureModes` 已分清:`timeout/rate_limit/server_error` → retryable;`censored/compliance_required` → unrecoverable

**M5 · SSE 鉴权(HMAC 短 TTL 票据,fynt 模式)**
- tRPC: `aigc.getStreamToken(attemptId)` → 内部校 attempt.shotGroup.episode.projectId 的用户访问权 → 签 HMAC-SHA256({attemptId, userId, iat, exp}, secret) → 返 `{ token, expiresInSeconds: 300 }`
- SSE route `/api/sse/aigc/[attemptId]?token=xxx` → 校 token(timingSafeEqual 防时序)→ 校 attemptId 匹配 → 订阅 Redis
- **理由**:EventSource 不能塞自定义 header(只能 query),session cookie 走 query 会泄给日志;HMAC 票据干净

**M6 · Redis pub/sub channel**
- 命名:`videogen:attempt:{attemptId}`(domain:resource 风格,fynt 对齐)
- 事件:`queued / running / progress / success / failed`(SSE event 类型)
- worker 进度回调 → `redis.publish(channel, JSON.stringify({type, ...payload}))`
- SSE 订阅 → 收到 `success/failed` 后 `controller.close()`

**M7 · 改造 `aigc.generateVideo` router**
- **保留在 handler 内**(同步):rateLimit / loadGroupOrThrow / 事务内占位 attempt + advisory lock / gachaMax/dailyBudget/compliance 三道校验 / compile prompt + missingMedia/unknownTokens 校验 / 升级占位到 RUNNING
- **抽出到 worker**:`provider.generate()` 调用 / 写 MediaItem / 升级 attempt SUCCESS|FAILED / costLedgerEntry / publish `EVENTS.GENERATION_COMPLETED`
- **返回值变化**:`{ attemptId, mediaId, videoUrl, ...}` → `{ attemptId, status: 'RUNNING' }`

**M8 · Worker listener → Postgres `job_logs`(langfuse 5 行代码模式)**
- `worker.on('failed', (job, err) => prisma.jobLog.create({ data: { jobId, queueName, error, stack, ...}}))`
- `worker.on('completed', (job) => prisma.jobLog.create({...}))`
- **W7 后台审计页直接读 `job_logs` 表**,不上 OTel collector(langfuse 是分布式才需要)

**M9 · 前端 hook `useAigcProgress(attemptId)`**
- 内部先调 `aigc.getStreamToken(attemptId)` → 拿 token → `new EventSource('/api/sse/aigc/{id}?token=xxx')`
- 状态机 `IDLE → QUEUED → RUNNING → SUCCESS|FAILED`
- 关闭后 invalidate `aigc.getGroupDetail` query

**M10 · 优雅退出(langfuse 严格顺序 + 25s 硬 timeout 兜底)**
```ts
const gracefulShutdown = async () => {
  await healthServer.close();          // 1. health 先停(K8s 不再发流量)
  await worker.close();                 // 2. 等当前 job 跑完
  await redis.disconnect();             // 3. Redis
  await prisma.$disconnect();           // 4. Prisma
};
process.on('SIGTERM', () => 
  Promise.race([gracefulShutdown(), sleep(25_000).then(() => process.exit(1))])
);
```

**M11 · Worker 健康检查**
- 开 `http.createServer` 监听 `/health` 返回 `{ ok, queueDepth, lastJobAt, workerId }`
- Docker healthcheck / K8s readinessProbe 用
- fynt realtime 有,worker 没有 — 我们补上

### 同行借鉴 12 项映射

| # | 修订项 | 来源 | 说明 |
|---|---|---|---|
| 1 | `apps/workers/video-gen` 非 `packages/workers` | fynt | worker 是部署单元不是 import 库 |
| 2 | queue 抽 `packages/queue` 共享包 | fynt+langfuse | 防 web/worker job schema 漂移 |
| 3 | `attempts: 5` 非 `3` | langfuse | LLM API 抖动要余量 |
| 4 | retry 白名单制(default return,临时错才 throw) | langfuse | 黑名单容易漏判 |
| 5 | BullMQ 内置 `UnrecoverableError` 非自定义 | langfuse 反向教训 | 别绕一圈 |
| 6 | `removeOnFail: 1000` 留长 | langfuse | W7 后台审计要 |
| 7 | HMAC 短 TTL 票据鉴权 | fynt | EventSource 不能带 header |
| 8 | Redis channel `videogen:attempt:{id}` | fynt | domain:resource 风格 |
| 9 | jobId 用 BullMQ 内建去重 | fynt | 替代 Redis SETNX |
| 10 | 25s 硬 timeout + SIGKILL 兜底 | langfuse 反向教训 | 防 K8s 强杀丢状态 |
| 11 | failed listener → Postgres job_logs | langfuse | 5 行代码,Phase 1 够 |
| 12 | `/health` HTTP endpoint | fynt 反向(它 worker 缺) | Docker/K8s readiness |

### 关键决策点(为什么这么定)

**1. 占位 attempt 留 handler 内,只抽 `provider.generate()` 到 worker**
- 占位 attempt 是"防重入"核心(7 轮 audit A1 的设计),必须在 handler commit 后让其他并发请求看见
- 如果占位放 worker,handler 返回后还没占位,用户连点 3 次会全部入队

**2. SSE 而非 WebSocket**
- 单向推送够用,Next.js App Router 原生支持 `Response(ReadableStream)`
- fynt 拆独立 realtime app 是因为 Next.js route handler **不支持 WS upgrade**,我们没这个限制
- 用 SSE 不开第 4 个 app,部署更简单

**3. Worker 独立进程而非嵌 Next.js**
- Next.js dev HMR 频繁重启,worker 跟着重启会丢任务
- 生产可水平扩(多 worker 实例消费同队列)
- 与 web 解耦后未来可独立缩容

**4. Mock provider 也走 worker**
- 统一异步链路,UX 一致(队列中 → 生成中 → 完成)
- Mock 内 1-3s sleep 模拟真实生成

### 风险与缓解

| 风险 | 严重度 | 缓解 |
|---|---|---|
| Worker 崩溃 → job 卡住 | 中 | BullMQ stalled job 自动 reclaim;dev 用 tsx watch 自动重启 |
| Redis 挂掉 | 高 | docker-compose healthcheck;Phase 1 接受本地单点 |
| SSE 被代理切断 | 中 | EventSource 自动重连;SSE 进入时先查 DB 兜底 |
| Browser 关 → SSE 断 | 低(预期) | worker 不依赖 client;用户重开页面查 attempt status |
| 多 worker 实例重复消费 | 低 | BullMQ 内置原子 pop |
| 测试时 Redis 依赖 | 中 | `ioredis-mock` 或 testcontainers |

### 不在范围(Phase 2 留)

- ❌ 多模型 Race(同 group 同时抽 Seedance + Veo + Kling)— ADR-21 §6 已规划
- ❌ Auto-Salvage 失败片段扫描 — Phase 2
- ❌ Worker 跨机水平扩(Redis 集群)— Phase 2 云端化
- ❌ 任务取消(用户点"取消" → 通知 worker 中断 poll)— W5.5.1 followup
- ❌ OTel 全链路 / ClickHouse / 独立 DLQ 队列(langfuse 过度工程化,Phase 1 用不上)

### 关联

- **关联**:[ADR-19](#) Episode 软锁(本 ADR 不动 Episode,只动 GenerationAttempt)/ [ADR-21 §1](#adr-21--w5-后期升级接口预留phase-23-接手指南) UsableRange(挂 GENERATION_COMPLETED 下游)/ [ADR-21 §4](#) IVideoProvider capability flags / 7 轮 audit A1 占位 attempt(完全兼容)
- **Inspiration**:
  - [abhinavkale-dev/fynt](https://github.com/abhinavkale-dev/fynt) (MIT,可借鉴):monorepo 拆分 + queue 共享包 + HMAC 鉴权 + worker 模板
  - [langfuse/langfuse](https://github.com/langfuse/langfuse) (MIT,可借鉴):retry 5 + 白名单失败 + 25s grace shutdown + failed listener
- **License 跟踪**:见 [docs/05a-third-party-licenses.md](05a-third-party-licenses.md)

### 🆕 v3 扩展(W5.5.1,2026-05-24)— 视频生成参数集

**背景**:对照同行(即梦 / 可灵)UI 加视频生成扩展参数。Mock 阶段仅透传打日志,真接 Provider 时 Adapter 内消费 extra。

**新增 `VideoGenJobData` 字段**(全部 optional,Phase 1 透传):
- `resolution`: `'480p' | '720p' | '1080p'`
- `generateAudio`: boolean(Seedance / Veo 2 已支持同步音频生成)
- `addWatermark`: boolean(Phase 2 可改 ffmpeg 后处理 worker)
- `webSearchEnabled`: boolean(Phase 2 真接 web search Provider 增强 prompt)
- `refVideoUrl` / `refAudioUrl`: 多模态参考(Phase 2 启用)

**新增 `Provider Capabilities` 能力标志**(后台 `ProviderConfig.defaultParams` JSON 可配):
- `supportedResolutions: ('480p'|'720p'|'1080p')[]`
- `supportsAudio` / `supportsWatermark` / `supportsWebSearch`
- `supportsRefImage`(默认 true)/ `supportsRefVideo` / `supportsRefAudio`

**`aspectRatio` 加 'auto'**:router 内 resolve 到项目默认(短剧默认 9:16),worker payload 仍是 3 个标准值。

**前端 UI**:selector row 加 `<details>` 折叠"高级选项"区,不支持的选项 toggle 灰显 + 标"Phase 2"/"W5.6"。`ToggleRow` 子组件复用。

### 留 Phase 2 的 8 项漏洞 / 升级点

| # | 限制 | 升级路径 |
|---|---|---|
| L1 | HMAC token 5min TTL,30min+ 断线重连过期 | hook 检测 401 → 自动重签 |
| L2 | `MediaItem.sourceRef` 无 schema unique 约束(仅 processor 层 idempotency) | 加 partial unique 索引 |
| L3 | worker `concurrency: 1` 硬编码 | 从 `ProviderConfig.maxConcurrent` 动态读 |
| L4 | 没有 cancel 机制 | `aigc.cancelGeneration` + worker 检查 cancel flag(Redis key) |
| L5 | Seedance Provider 内部同步 poll | worker poll 持久化 providerJobId 断点续跑 |
| L6 | 失败关键词分类 strict snake_case | Provider 抛 typed Error class(`instanceof ProviderUnrecoverableError`) |
| L7 | 没有"批量重抽" | batch retry mutation + worker 队列扇出 |
| L8 | OperationLog worker 端 fire-and-forget | 接受(BullMQ failed listener 兜底,Phase 2 接 OTel 再加严) |

---

## ADR-26 · 跨模块 Agent 联动接口预留(Phase 2 Mastra 落地前置)
**日期**:2026-05-24 · **状态**:📋 已规划(Phase 2 P2.4 启动时实施)

**决策**:Phase 1 各 router 的核心 mutation 已天然适合作为 **Agent tool**,Phase 2 启动 Mastra Agent 编排时直接复用,无需重写业务逻辑。本 ADR 仅**列接口预备**,不实施代码。

**关联**:[ADR-22](#adr-22--phase-2-agent-编排选-mastra取代-adr-01-langgraph) Mastra 选型(本 ADR 是 ADR-22 的执行预备)

### 候选 tool 清单(13 个核心 mutation,按模块)

| 模块 | tRPC mutation | Agent 用法举例 |
|---|---|---|
| **Director** | `script.upload` | Agent 上传剧本文件 |
| | `script.analyze` | Agent 跑 8 维 Story Compass 分析 |
| | `storyboard.generateForEpisode` | Agent 自动生成分镜(LLM 一次性) |
| | `storyboard.publishEpisode` | Agent 把分镜推到 AIGC |
| **Asset** | `asset.create` / `asset.update` | Agent 创建/改资产 |
| | `asset.generateImage` | Agent 出图 |
| | `asset.batchBreakdown` | Agent 拆解剧本到资产草稿 |
| | `asset.confirmCandidate` | Agent 选最佳候选图 |
| **AIGC** | `aigc.autoMatchAssets` | Agent 自动 @ 资产 |
| | `aigc.autoTagPrompt` | Agent 自动在 prompt 里插 @token |
| | **`aigc.generateVideo`** | Agent 抽卡(W5.5 异步,完美适合 Agent 长跑) |
| | `aigc.rejectVideoTake` | Agent 自动废片(Critic Agent) |
| **Admin** | `admin.system.setSetting` | Agent 调系统参数 |
| | `admin.binding.set` | Agent 切模型绑定 |

### 接口预留方案

**1. tRPC procedure 加 `.meta({ agentTool })` 元数据**(Phase 2 实施时一次性补):

```ts
storyboard.generateForEpisode = protectedProcedure
  .meta({
    agentTool: {
      name: 'storyboard_generate',
      description: '为指定剧本集生成分镜,返回 group + shot 列表',
      sideEffects: 'creates Scene/ShotGroup/Shot rows + writes PromptEdit + writes GenerationAttempt',
      examples: [{ input: { episodeId: 'cuid_xxx' }, output: { count: 12 } }],
      costEstimate: 'LLM call ~3000 tokens',
    },
  })
  .input(z.object({ episodeId: z.string().cuid() }))
  .mutation(async ({ ctx, input }) => { /* 现有业务逻辑 */ });
```

**2. Mastra adapter 自动收集**(Phase 2 新建 `packages/agent/tools.ts`):

```ts
import { appRouter } from '@ss/api';
import { createTool } from '@mastra/core';

// 扫所有 procedure 的 .meta.agentTool,自动注册成 Mastra tool
export const tools = collectAgentTools(appRouter);
```

### Phase 1 不做的

- ❌ 实际接入 Mastra(留 Phase 2 P2.4 多 Agent 评审启动)
- ❌ tool registry 实现(只列候选,不改 procedure)
- ❌ Agent UI(留 Phase 2 多 Agent 评审 UI)

### 已就位的 Agent 友好基础设施(无需额外开发)

| 基础设施 | 用途 | ADR |
|---|---|---|
| **Cost Ledger** | Agent 调用自动纳入预算护栏,失控有 BudgetExceededError | ADR-04(W1.4) |
| **W5.5 异步 worker** | Agent 长跑任务可入队,不阻塞 Agent 推理 | **ADR-25** |
| **EventBus** | Agent 步骤间用 EVENTS 协调,不直接调 RPC | ADR(W1.3) |
| **OperationLog** | Agent 操作全部可审计 + 可回滚 | ADR(W1.4) |
| **GenerationAttempt** | Agent 每次模型调用有 attempt 记录,失败可重试 | ADR(W1.2) |
| **PromptEdit 训练集** | Agent 决策可反馈到训练数据 | 护城河 #3(ADR-24) |

### 风险与缓解

| 风险 | 严重度 | 缓解 |
|---|---|---|
| tool 描述质量影响 Agent 决策 | 中 | Phase 2 启动时一次性写好,设计 review |
| sideEffects 描述不全致 Agent 误触发 | 高 | 必填 sideEffects + costEstimate 字段;Cost Ledger 兜底 |
| Agent 失控烧钱 | 极高 | 项目级预算护栏 + per-user rate limit + admin 可一键禁 Agent provider |
| Agent 误 reject 用户资产 | 中 | 所有 reject 类 mutation 加 `agentTool.requireConfirm: true`,Mastra 调用前 human-in-loop |

### 关联

- **ADR-22** Mastra 选型(本 ADR 执行预备)
- **ADR-25** W5.5 异步生成(`aigc.generateVideo` 是 AIGC 模块第一个 Agent tool 候选)
- **ADR-24** 反向护城河 #3 PromptEdit 训练集(Agent 决策反馈源)
- 当前 13 个核心 mutation 已天然适合作 Agent tool,无需重写业务

---

## 待补充的决策(占位)

📋 ADR-27 · 桌面端 vs 移动端的代码共享策略(Phase 2 拆分时)
📋 ADR-28 · 私有部署 vs SaaS 双轨的数据隔离策略(Phase 2)
📋 ADR-29 · 海外多区域部署(Phase 3 国际化时)
