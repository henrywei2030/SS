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

## ADR-27 · 第 19-20 轮 audit 全栈加固决议(2026-05-24)

### 背景

W1-W7 MVP 100% 完成,实战前用户要求"60 轮 debug"加固(2×30 轮),核心三诉求:
1. 所有模块留升级接口(后期每步骤可让 agent 执行)
2. 模块独立升级不影响其他(功能/参数/UI 解耦)
3. 跨模块流程清晰可追溯(出错可 trace)

### 决议(本轮真落地)

**A. requestId 全链路贯通(可追溯 #3)**
- `route.ts` 生成 UUID(或读 X-Request-Id header)→ ctx.requestId
- tRPC errorFormatter 透传到 error.data.requestId
- aigc 入队 → VideoGenJobDataSchema.requestId → worker `[req=xxx]` 前缀
- 前端 `lib/trpc/error-toast.ts` showTrpcError 自动附 ` · req=xxxx` 后缀
- response header `x-request-id` 回吐供客户端读取
- 用户报 bug 附 requestId,运维 `grep "req=xxx"` 看全链路日志

**B. AgentTool meta 13 mutation 100% 覆盖(升级接口 #1)**
- `trpc.ts` `initTRPC.meta<TRPCMeta>()` + AgentToolMeta interface
- 13 个核心 mutation 全加 `.meta({ agentTool: { description, sideEffects, costEstimateCny, requireConfirm } })`:
  - asset.create / asset.generateImage / asset.batchCreate / asset.breakdown
  - storyboard.generateForEpisode / storyboard.publishEpisode / storyboard.mergeShots
  - aigc.generateVideo / aigc.bindAssetToGroup
  - script.upload / script.analyze
  - project.create / project.addMember
- Phase 2 Mastra 启动:写 `packages/agent/tools.ts` 扫所有 `.meta.agentTool` → Mastra tool registry,**零业务改动**

**C. EventBus 协作完整(模块解耦 #2)**
- `in-process.ts` 加 dev-mode trace log + subscriber count
- 4 个 router publish 缺漏补:STORYBOARD_GENERATED / STORYBOARD_PUBLISHED / ASSET_GENERATED / ASSET_CONFIRMED
- events.ts type contract 不再死契约,真触发订阅方
- 模块解耦:订阅方只看 topic + payload type,不直接 import 发布方

**D. 模块边界文档(独立升级 #2)**
- `docs/MODULES.md` 全景 + 依赖图 ASCII + 协作契约 + 升级 hook 清单
- 4 个 package README:api / core / queue / adapters
- Tauri capabilities 预设 `apps/desktop/src-tauri/capabilities/default.json`(DRAFT 状态,Phase 1.5 启用)

**E. 安全 + 性能修(沿带项)**
- auth email/username lowercase + trim(防绕过软删)
- confirmCandidate / unconfirmSlot advisory_xact_lock(并发 maturity race)
- errorMsg sanitize 5 处(防真接 Provider 后 URL/token 泄漏)
- media upload MIME ↔ kind 白名单(防 SVG XSS / PDF 假冒)
- aigc.getGroupDetail mediaIds size guard(防异常 1000+ 膨胀)
- changePassword 加 audit log(链路 10 verify 发现)
- .env.example 补 7 个变量(AUTH_DRIVER / AUTH_TOKEN_TTL_SEC / SSE_TOKEN_SECRET / STORAGE_LOCAL_*等)

### 影响

- **代码改动**:25 文件 +600/-30 行
- **新增文档**:6 个(MODULES.md / 4 README / capabilities/default.json)
- **零 schema 迁移**:刻意避免 migration 简化部署
- **零回归**:typecheck 15 task 全过 / test 25 测全过

### 留尾(明确转 Phase 2)

- React Error Boundary + 401 全局 redirect(本轮加了 mutationCache 全局 toast,但未做 redirect)
- Optimistic update + 客户端 zod 校验 + form reset 强制
- recharts lazy load(分析页 bundle)
- 公开注册指引 / cost pre-check / SSE polling fallback / 失败 errorCode 枚举
- 大文件 chunked upload / AIGC 来源 breadcrumb
- schema 加 `@@index([projectId, createdAt])` GenerationAttempt(留 Phase 2 跟其他 schema 改一起 migration)
- OperationLog action 渐进迁移到 `<module>.<entity>.<verb>` 三段式(无硬编码约束,新代码用三段式即可)
- Project owner 软删后 transfer ownership UI(当前 owner 唯一无法转,无人会软删自己 — 业务不阻塞)
- Tauri capabilities 真启用(Phase 1.5 Rust toolchain ready 后)

### 关联

- **ADR-22** Mastra 选型(本 ADR 段 B 是其执行预备的 100% 覆盖)
- **ADR-25** W5.5 异步生成(本 ADR 段 A requestId 贯通到 worker 的依据)
- **ADR-26** Agent 联动接口预留(本 ADR 段 B 落地)
- **本轮所有改动**:见 git log `feat(audit-r19+r20):` 这次 commit

---

## ADR-28 · Phase 1.5 完整决议(主次重审 v2.1 + 中转站抽象 + 预扣退还 + 真接入 verify)(2026-05-24)

### 背景

十九次收工真接 moyu.info 中转站学到 4 关键设计(预扣退还 / 4 倍率 / asset:// 引用 / CSV 导出),原计划照搬。用户明确反馈"moyu 只作参考不要照搬,注意主次",触发本轮主次重审 + 代码层去特征化 + 5 项 P0 落地。

### 决议(本轮真落地)

**A. moyu → "中转站(relay)" 抽象通用化(参考但不绑定)**
- 原则:moyu 是参考源不是设计模板,严格分"产品逻辑必需"(主)vs "UI 风格借鉴"(次)
- 代码层 identifier 全部去 moyu:providerId(moyu-* → relay-*)/ env(MOYU_API_KEY → RELAY_API_KEY)/ endpointStyle('moyu' → 'relay')/ 文件名(moyu-asset.ts → relay-asset.ts)/ 类名(MoyuAssetProvider → RelayAssetProvider)/ SystemSetting key(moyu.assets.* → relay.assets.*)/ aigc isMoyuProvider → isRelayProvider / media syncToMoyu → syncToRelay / meta.moyuAssetUrl → relayAssetUrl
- 数据字段 apiUrl 默认清空(用户后台必填,不绑定特定 URL)
- docs 保留参考来源叙述(如"moyu 实测公式"、"moyu 启发")+ 并列举例(OpenRouter / Poe / OneAPI / moyu.info 等中性列举)
- 适用范围:任意 OpenAI 兼容中转站(moyu / OpenRouter / Poe / OneAPI 自部署 / 火山引擎 / 阿里 / 腾讯)

**B. Cost Ledger 加 entryType + 预扣退还机制(P0-1)**
- 加 enum LedgerEntryType:NORMAL(LLM / image)/ PREPAY(视频 task 创建预扣)/ REFUND(完成时退多扣,costCny 负数)/ ADJUSTMENT(admin 手动调整)
- 字段:entryType / refundReason / parentEntryId(自引用形成账目链)
- attemptId 从 1:1(@unique)改 1:N(@@index):允许 1 attempt N 条 ledger entry
- aigc.generateVideo 创建 attempt 同事务写 PREPAY · failPlaceholder 任何前置失败同时写 REFUND 全退
- worker processor 成功:REFUND(-(prepaid-actual))退多扣 / 失败:REFUND(-prepaid)全退 — idempotent 防 retry 双写
- REFUND 永远 success=true(退还动作执行成功 ≠ task 成败);task 成败用 GenerationAttempt.status 表达
- dailyBudget query 加 `attemptId: { not: earlyAttempt.id }` 排除自己 PREPAY 防双计

**C. ProviderConfig 加 2 倍率(P0-2 · 压简 v2.1)**
- 加 modelRate(Decimal 10,6)/ outputRate(Decimal 10,4)— 都 nullable,fallback 旧 unitPriceCny
- BaseProvider.calcCostCnyDecimal 公共函数:modelRate 非空走 2 倍率(input/1M × modelRate + output/1M × modelRate × outputRate)
- **cacheRate / groupRate 推 Phase 2**:cache hit 单租户省钱有限 + 适配复杂度高 / group 是 SaaS 多租户产物,工作室自用全 1.0
- seed 给 3 个 LLM filler:claude-sonnet(22/4.9091)/ haiku(5/1)/ deepseek(1/2)
- OpenAICompatTextProvider 算 cost 后用 costCnyOverride 直传 BaseProvider 避免双重计算

**D. /admin/api-usage CSV 导出(P0-4)**
- adminRouter.apiUsage.exportCsv:输入时间范围 + filter(provider/user/project)+ includePrepayRefund + maxRows ≤10000
- 13 字段含 entryType / refundReason,RFC 4180 escape + UTF-8 BOM(Excel/WPS 正确识别中文)
- adminProcedure 守门 + logOperation 审计 + 前端 Blob 下载

**E. 中转站素材库 asset:// 引用机制(P0-5)**
- 新建 RelayAssetProvider(createAsset / getAsset / listAssets / deleteAsset)按典型中转站 API(POST /v1/assets)实现
- getRelayAssetProvider factory 从 ProviderConfig 找第一个 active relay-* 复用 token(1 token 共享素材库)
- mediaRouter.upload 加 syncToRelay 显式开启 + getSignedUrl(12h)拿公网 URL + 存 meta.relayAssetUrl / relayAssetId
- aigc.generateVideo refImageUrls:provider 是 relay-* 时优先用 asset://,免重传大文件
- SystemSetting `relay.assets.default_group_id` 默认 0(关闭),用户后台填具体 group_id 才启用

**F. Binding 强制显式选择(explicit-choice-only · 收工后补丁)**
- **原则**:不 hardcode 任何 provider id 作为默认值。Admin 必须在 /admin/bindings 显式选择,业务调用 binding 为空时拒绝。
- **背景**:二十收工后用户反馈"测试调试可以选择,实际去用的时候一定是在后台设置最终用哪一个"。原 seed 给所有 binding.*.modelId/providerId 填了 hardcode 默认值(claude-sonnet-4-5 / nano-banana-pro / gpt-image-2 / seedance-2.0 / volcengine-compliance),且 5 个业务 router fallback 也 hardcode 同样的 id,导致即使 admin 删了 binding 也会 silently 用 hardcode(可能指向未实装 / 无 key 的 provider,fallback 到 Mock,用户感知不到错配)。
- **改造**:
  - seed.ts:7 binding.*.{modelId|providerId} 默认值改 `''`(`binding.script.docx.parser` 留 `mammoth` — 库选择不是 provider)
  - 5 业务 router:fallback 改成空时抛 `PRECONDITION_FAILED`,错误信息明确引导 admin 去 /admin/bindings 选 + 指出对应 binding key
  - script.analyze 接受 input.modelId 优先(测试调试)/ asset.generateImage 接受 input.modelId / aigc.generateVideo 接受 input.providerOverride — 测试场景用 override 绕过 binding
  - storyboard.generateForEpisode + asset.breakdown 无 override 选项,binding 空必抛(业务流程刚性 binding 依赖)
  - DB SQL UPDATE 修复已 seed 的 8 行 binding 值清空(跟新 seed 对齐)
  - 测试脚本(relay-real-test.mjs / w8-smoke.mjs)hardcode provider id 保留 — 测试场景就该 explicit 测特定 provider
- **影响**:首次部署 admin 必须显式配 5 项核心 binding 才能业务跑;原 silently fallback 路径全部消除;测试调试不受影响(input override 仍可绕过 binding)

**G. Audit r21 后续修复 + 一键启动 `pnpm start`(2026-05-24 同日,binding 补丁后)**
- **背景**:二十次收工 + binding 补丁后 user 要求"深度检查 10 遍 + 全局检视 + 启动流程优化"。并行 2 个 audit agent 跑 Phase 1.5 + 全局文件,发现 1 个真 P0 + 1 个真 P1
- **真 P0 修(audit r21 P0-A)**:`aigc.generateVideo` enqueue 失败 catch 内只 update attempt FAILED **没写 REFUND** → PREPAY 永久悬挂(用户被扣但任务没跑)。此时 attempt 已 RUNNING,`failPlaceholder` 的 `updateMany where status='QUEUED'` 不命中,必须独立同事务写 REFUND + attempt FAILED。`refundReason: 'video_task_enqueue_failed'`
- **真 P1 修(audit r21 P1-3)**:worker `processor.ts` 失败/成功 REFUND 写入用 `findFirst → create` 模式,BullMQ stalled re-queue 时两 worker 同 attempt 并发可能双写。修复:transaction 内加 `pg_advisory_xact_lock(hashtext('attempt_refund:' || $1))` 锁住同 attempt 的 REFUND 写入。idempotent check 同时覆盖 REFUND + ADJUSTMENT entryType
- **其他修(P1/P2)**:
  - `base.ts:80` `as never` → `as Prisma.Decimal.Value`(类型安全)
  - `aigc.ts:1129` PREPAY 注释更正(REFUND 实际 success=true,task 成败用 attempt.status)
  - `aigc.ts:1165` failPlaceholder 字符串拼接 → `(-prepayEstimateCny).toFixed(4)` 数字 negation 更可读
  - `admin.ts:1365` CSV BOM 显式 U+FEFF 注释
  - `openai-compat.ts:5` 注释去 moyu.info 残留(已是中性列举,简化)
  - `seed.ts` `binding.storyboard.prompt.modelId` description 改为"预留 Phase 2"(实际代码不读)
  - `.env.example` 加 `SS_EVENTBUS_TRACE=1` 注释行(eventbus 调试开关)
- **一键启动 `pnpm start`**(audit r21 启动流程优化):
  - 新建 `scripts/start.mjs` 跨平台 Node 脚本(Win/Mac/Linux)
  - 7 步:preflight → docker compose up + 等 healthy → migration status check → 检测 :3000/:9200 占用 → 占用则 graceful skip startDev → spawn turbo dev (stdio inherit) → wait :3000 ready → open browser → Ctrl+C 优雅停 turbo
  - flag:`--skip-preflight` / `--skip-infra` / `--no-open` / `--auto-migrate`
  - 端口被占用(已有 dev 跑)时不报错,直接 open browser 退出
  - 解决 user pain:之前 3 个终端 + 浏览器手动开,现在 `pnpm start` 一条命令完成 — 已 verify 跑通(端口占用 graceful 模式)
- **文档同步**:docs/03-roadmap-and-progress.md(进度速览刷到 20 收工 + Phase 1.5 ✅)+ docs/04-data-model.md(CostLedgerEntry/ProviderConfig 加 P0-1/P0-2 新字段)

### 影响

- **正向**:Phase 1.5 上线 ready,真接中转站全链路通(testConnection 14.9s + script.analyze 37s)/ 计费精确度大幅提升(2 倍率 + 预扣退还)/ 运维有 CSV 对账 / 性能优化(asset:// 免重传)
- **风险**:旧 unitPriceCny 路径仍保留(兼容),但 cost 计算精度差;Phase 2 启用 cache+group 时还要新 migration
- **兼容性**:零 schema breaking(所有新字段 nullable + 默认值;costEntries 1:N 反向自动适应原 1:1 用例)

### 留尾(明确推 Phase 2)

- `cacheRate`(prompt caching hit 折扣) — 需解析 `usage.prompt_tokens_details.cached_tokens`,Provider 适配复杂
- `groupRate`(VIP/新客分组倍率) — SaaS 多租户才有意义
- maskSecret 前 5+后 4 风格 → 降级 P1-5(纯 UI polish,跟其他 polish 一起做)
- 中转站素材库 group_id 自动创建(目前用户手动)
- 中转站 /v1/models 自动同步可用模型范围 + token 限定模型白名单

### 关联

- **ADR-22** Mastra 选型(P0-4 CSV 导出对应未来 agent 调用记账)
- **ADR-25** W5.5 异步化(P0-1 预扣退还机制就在 worker processor 实施)
- **ADR-27** 第 19-20 轮 audit(本 ADR 是 19-20 轮加固后的 Phase 1.5 正式落地)
- **本轮 commit**:`feat(phase15): P0-1/2/4/5 全落地 + moyu→relay 全面去特征化 + 真接入 verify 19/19`
- **plan v2.1 全文**:[docs/integrations/phase-1.5-plan.md](../integrations/phase-1.5-plan.md)

---

## ADR-29 · AIGC 真接通 Seedance 2.0(2026-05-27 二十五收工)

### 背景
Phase 1.5.3 后 AIGC 工坊 UI 完整但 video 生成链路从未真打通过 — 用户每次点"生成视频"要么 fallback MockVideoProvider 返 sintel 样片,要么真打 moyu 但 attempt 卡 RUNNING 等 30min 后被 worker boot stale sweep 标 FAILED。用户在 moyu 后台能看到任务真生成了 + 真有 video_url,但前端永远拿不到。本 ADR 记录二十五收工修复 4 大 P0 + 14 项 UX 反馈 + 3 路 audit 16 项 P0/P1 的设计落地。

### 4 大 P0 根因(对照 moyu docs §15)

**P0-A · Adapter 路由 fallback Mock(每次都没真打 Seedance)**
- `constructVideoProvider` 老白名单 `startsWith('seedance'|'doubao-seedance'|'relay-doubao-seedance')` — admin 添加 relay 模型时 `providerId = ${relayName}-${suffix}` = `moyu-doubao-seedance-2-0-fast`,**不命中任何前缀** → fallback MockVideoProvider
- 修复:改基于 `defaultModel.includes('seedance')`(catalog 规范化 modelId 字段始终含 seedance,覆盖任意中转站前缀)+ `adapterHint = cfg.defaultParams.adapter` 双重保险

**P0-B · Seedance 2.0 协议完全不对(API 调用即 422)**
- 当前 buildCreateBody relay 用 Seedance 1.x 简化结构 `{model, prompt, duration, ratio, image}`,2.0 不支持
- 修复:按 `modelId.includes('seedance-2-')` 分支:
  - 2.x:嵌套 `{ model, prompt:'占位', metadata: { content:[{type:'text',text},{type:'image_url',image_url:{url},role:'first_frame'|'last_frame'|'reference_image'}], duration:4-15, resolution:'480p'|'720p', ratio, generate_audio, tools? } }`
  - 1.x:旧简化结构(顶层 prompt + duration + ratio + images 数组)
  - role 三种互斥 + audio_url 必须跟 image_url/video_url 同时出现(`content.some(...)` 守卫)

**P0-C · Seedance 2.0 query response 解析(嵌套两层 + 大写状态)**
- 老代码假设 ARK 1.x 平铺 + 小写 `status:'succeeded'`,但 2.0 是 `{code, data:{task_id, status:'SUCCESS'|'IN_PROGRESS'|'FAILURE', data:{content:{video_url}}}}` 嵌套两层 + 大写
- `lastQuery.status === 'succeeded'` 永远 false → 5min 超时 → mark FAILED 但 moyu 端真生成完了
- 修复:`parseQueryResponse` helper 智能识别 v2 嵌套 + v1 平铺,规范化 `NormalizedQuery {kind, videoUrl, durationS, errorMsg}`;pollTimeoutMs 5min→15min

**P0-D · undici connect timeout 10s 过短(task_id 丢失)**
- 用户截图证据:moyu 后台 13:08:55→13:11:54 SUCCESS task `cgt-...r5kjq`,但 DB 同 attemptId 是 `Connect Timeout Error (timeout: 10000ms)` → mark FAILED
- moyu 端真收到 POST + 生成完成,worker 因 undici 默认 connectTimeout 10s 切断响应链 → task_id 永久丢失
- 修复:`packages/adapters/provider/seedance.ts` 加 Seedance 专属 undici Agent:
  - `connect: { timeout: 60_000 }` / `keepAliveTimeout: 30s` / `bodyTimeout: 180s` / `headersTimeout: 180s`
  - 所有 `request()` 调用传 `dispatcher: seedanceDispatcher`,不依赖 openai-compat.ts global dispatcher

### 衍生 P0(CostLedger unique 老索引)
- schema.prisma CostLedgerEntry.attemptId 注释 `// Phase 1.5 P0-1:去掉 @unique 改 @@index,允许同 attempt 多条 entry(PREPAY + REFUND)` 但 **prisma migration 没生成 → DB 上同时有 unique + 非 unique 两个索引**
- migration `20260527120000_drop_ledger_attempt_unique` 加 `DROP INDEX IF EXISTS "cost_ledger_entries_attemptId_key"` 修复
- 之前所有 worker 写第二条 REFUND 都 P2002 unique violation → catch 静默 → attempt 卡 RUNNING + 视频丢失。**这是 r12-r14 反复出现"attempt stuck RUNNING"的真根因**

### 14 项 UX 反馈连续修(详见 PROGRESS 二十五收工)
原始剧本紧凑 / 视频提示词 normalizePrompt 抽 `@ss/shared/prompt-utils.ts` 共用 / 全集 group 同页堆叠 / 视频预览简化删 dialog + 历史常驻 + 自动播 / placeholder 区分 4 状态 + 完整 errorMsg / 动态进度条 / RUNNING 自动 polling 5s / 删除 take 软删 / 画面比例 6 选项全栈 / 最长 15s 全栈 / RelayCatalogModel 扩 supportedResolutions+supportsAudio + admin.createFromCatalog 透传 / BullMQ attempts:5→1 / 视频模型下拉 listVideoProviders / capabilities.fallbackReason 4 种 / 高级选项展平 toolbar / admin /api-usage 加 videoAttempts 复盘 section

### 3 路 audit r12-r15 16 项 P0/P1 修(去重去误报)
- rejectVideoTake/unbindAsset server return shotGroupId 定向 invalidate(防同页 group cache 污染)
- isMock 检测 `/\(Mock\b/.test()` 严格匹配 + capabilities `fallbackReason` 显式
- refAudioUrl input + binding 统一 silent drop
- stale RUNNING 自愈 generateVideo entry 10min cutoff + 标 FAILED + 退 PREPAY
- aspectRatio race 用 `useRef.current` 替代 useState flag
- 自动播 onLoadedMetadata + pendingPlayId 替代 requestAnimationFrame
- capabilities `maxDurationS→maxDuration` 字段名对齐 catalog/seed
- r15 死代码 audit:`story-compass.tsx` 死 prop `locale` 删 + page.tsx caller 同步

### 工具留档
- `scripts/fix-seedance-provider-config.mjs` — catalog 重建 ProviderConfig.defaultParams + 同步 binding
- `packages/queue/monitor-12-14.mjs` — 监控某 group 全链路
- `packages/queue/sync-orphan-attempts.mjs` — BullMQ failed 但 DB RUNNING 孤儿同步 + 退 PREPAY
- `packages/queue/recover-lost-video.mjs` — connect timeout / 任何原因 task_id 丢失时,用 (attemptId + moyu task_id) 找回视频

### 影响
- **正向**:AIGC 全链路真接通 moyu/Seedance 2.0 ✓(用户截图证据 13:08:55→13:11:54 SUCCESS · recovery script 拿回 video_url) · W8 团队实战已具备所有底层条件
- **风险**:Seedance 2.0 metadata 结构按 docs §15 实现,若 moyu 中转站接口微调可能需要再修
- **兼容性**:1.x 仍走旧 buildCreateBody 分支;parseQueryResponse 兼容 v1 平铺响应

### 留尾(明确推 Phase 2)
- worker boot stale sweep 加退 PREPAY(目前只标 FAILED 没退)
- admin UI 换 token 跟 toggle isActive 视觉区分
- 进度条接真 SSE percent(目前时间估算)— 需 SeedanceProvider 接 progress callback
- moyu task_id 丢失时自动 recovery(目前需手动跑 recover script)

### 关联
- **ADR-25** W5.5 异步化(processor.ts 在此 ADR 消费 NormalizedQuery)
- **ADR-28** Phase 1.5 全 ADR §A-§G(本 ADR 是真接 API 的下一步)
- **本轮 commit**:`feat(aigc): 真接通 Seedance 2.0 · 14 项 UX 反馈 + 3 路 audit P0/P1 + connect timeout + ledger unique drop`

---

## ADR-29 · 剧本拆解模块 = LLM 从完整剧本拆「文字设定」(2026-06-07 · 五七收工)

### 背景
五五/五六把剧本拆解做成了"手动新建资产壳"(大弹窗)。用户澄清真实定位:**剧本拆解 = 由后端 LLM 从「关联的完整剧本」自动拆解 + 打磨 人物/场景/道具 的文字设定**(人物要形象设定 + 人物小传、场景利于生图、道具细节),人工微调后可选同步美术工坊。

### 决策(plan mode 拍板)
1. **人物小传存储** → Asset 新增 `bio @db.Text` 列(additive migration),一等公民、便于展示查询(不塞 profileJson)。
2. **重新拆解覆盖** → **草稿审阅再应用**:`breakdownProject` 只产草稿不写库,用户审阅(勾选/内联编辑)后 `applyBreakdown` 才落库(create 新 / update 匹配,跳重名跳锁定);**LLM 产出永远先过人眼**。
3. **拆解输入范围** → **整部剧本一次拆**:聚合项目所有集 isCurrent 剧本拼完整剧本作上下文(小传/弧光需全局视角)。
4. **设定 prompt** → 新 slug `script_breakdown_full`(角色圣经三段式 形象/小传/心理 + 生图 spec-sheet),入 seed.ts + /admin/prompts 可编辑 + 代码 fallback;旧轻量 `asset_step_base`(美术工坊快速建)保留不动。

### 超时与延迟(同轮处理)
- **根因**:整本 + maxTokens 16000 + 三类全拆 = 单请求生成超 300s(moyu 非流式,全生成完才返 headers)→ Headers Timeout。
- **修法**:core 加 `focusType`,**分类型拆**(每次仍喂整本剧本作上下文、只产一类);前端审阅对话框 **Promise.all 并行** 3 类(墙钟 ~3×→≈最慢一类)+ 增量显示 + 部分失败容错。
- **链路巡检**(3 agent)落地:图像 `headersTimeout` 60→180s(非流式图像 2-3min 必撞);小字段 `maxTokens` 1000/2000→4000(防 thinking 模型如 gemini-3-flash 被推理 token 耗尽返空)。
- **Phase 2 留尾**:流式 LLM(首 token <1s)/ Redis 分布式缓存(prompt+binding)/ Seedance 自适应轮询 + webhook / 长调用 SSE 进度 / provider config TTL 缓存 / GenerationAttempt 统一框架。

### 影响
- 新增 endpoint:`asset.breakdownProject` / `applyBreakdown` / `generateAssetText`(+ 五六 `listImageProviders`)。
- Asset schema:+`bio`(migration `20260606150159_asset_bio`)。
- 前端:`script-breakdown-pane.tsx` 三板块重写 + 新 `breakdown-review-dialog.tsx` + script-pane「拆解来源」视图。
- 6 个 active provider 经生产 adapter 实测:TEXT×3 真调可用(gemini 为 thinking 模型需大 maxTokens),IMAGE×2 + VIDEO×1 配置验证 OK(未真生成)。

### 关联
- **ADR-28** Phase 1.5 真接 API(本 ADR 在其上做导演侧文字设定链路)
- **同步闸**(五五):syncToArt 只翻转 syncedToArtAt 不复制,最终以美术工坊微调为准

---

## ADR-30 · 图生图 adapter + 参考音频自动同步 + 出场集(2026-06-07 · 五八收工)

### 背景
五八真打迭代中,用户对美术/拆解链路提多项增强,其中三项涉及架构决策。

### 决策
1. **图生图走 `/images/edits`**:当前 image adapter(`openai-compat-image`)只走 `/images/generations`(纯文生图,JSON body)。图生图(参考图)= OpenAI 兼容的 **`/images/edits`**(multipart/form-data,image[] 最多 16)。adapter `generate()` 在 `req.refImageUrls` 非空时 fetch 参考图 bytes → multipart POST /images/edits;响应统一 `extractImageUrls`(兼容 `url` 直链与 `b64_json`)。**无参考图保持文生图不变**。
   - ⚠️ 各中转站(moyu)对 Seedream/GPT-Image 的 edits 入参可能不同(`image` vs `image[]`、是否支持 strength)→ 先实现标准 OpenAI 兼容路径,**真打读日志迭代**。strength 经 `req.extra` 透传(视模型支持)。
   - `asset.generateImage` 加 `refImageIds/strength/extraNegative`;refImageIds → 签名 URL(`getStorageAdapter`)传 adapter;extraNegative → `compileAssetPrompt`。
2. **参考音频自动同步**:`Asset.voiceMediaId` 已存在。视频生成 `compileVideoPromptForGroup`(`core/video-generation/compile.ts`)refs 由 map → flatMap:**绑定 CHARACTER 形象时,若该角色有 voiceMediaId,自动追加一条 AUDIO ref** → aigc refAudioUrls(去重)→ 关联图即关联声。无需额外 SOUND_VOICE 绑定。
3. **出场集 episodes**:`Asset + episodes Int[]`(migration `20260606173856_asset_episodes`)。拆解 prompt 产 episodes(据 `===第N集===`)+ 排序规则(人物按重要性 主演>配角>群演 再首集;场景/道具按首集)。前端按规则排序 + 标注出场集 + 可编辑。**重新拆解默认全选覆盖**(审阅对话框 `selected:true`)—— 否则旧资产(匹配到的)默认不勾,出场集永远填不上。

### 影响
- 新增/改:`openai-compat-image`(edits 分支)、`asset.generateImage`(参数)、`compile.ts`(voice ref)、`aigc.ts`(refAudio 去重)、schema(episodes)、`script_breakdown_full` prompt。
- 前端:人物编辑 VoiceField(语音上传/试听)+ GenerationPanel(参考图/强度/负面词)+ 共享 `AutoGrowTextarea`(useLayoutEffect+rAF)。
- 留尾:#3 edits 真打格式迭代;#2 视频带语音端到端需 worker + seedance;出场集需重跑拆解覆盖。

### 关联
- **ADR-29** 剧本拆解模块(本 ADR 在其上做美术侧生图 + 角色语音/出场集增强)

---

## ADR-31 · 代码健康审计与渐进优化路线(2026-06-07 · 五八)

### 背景
用户问"能否全面优化成更有逻辑的形式而非屎山"。3 个 agent(后端/前端/架构)独立审计 47.7k 行源码。

### 结论:**不是屎山,是"骨架优秀、局部有债、已救一半"的工程**
硬指标:分层依赖**零违规**(web→api→core→adapters→db/shared 单向无环)· 业务代码 `any` ≈1-2 处 · `tsconfig` strict+noUncheckedIndexedAccess · 35 migration 全对齐 · 62 ADR · 死代码 0 · 真 TODO/FIXME 1 个 · 横切骨架统一(errorFormatter/sanitizeErrorMsg/三档 procedure/logOperation)。`core/video-generation/*` 与 `aigc-workspace` 已是教科书级范本 —— **优化 = 把这套已验证模式回填到老模块,非重写**。

### 债集中三处
1. **God 文件**(内聚但大,非纠缠):路由 asset.ts(2636)/aigc.ts(1847)/storyboard.ts(1846)/script.ts(1145);组件 asset-edit-dialog(1791)/providers-table(1349)/top-bar(1312)。
2. **样板未抽干净**:GenerationAttempt+CostLedger 状态机手写 ~13 遍;media→URL 解析 ×3;refund 幂等 ×3;项目鉴权 OR ×10;两套 modal;window.confirm/alert ×11。
3. **关键路径缺测试**:worker/processor.ts(扣费/退款)0 测试;adapters 1/24。

### 安全原则(本轮执行准则)
**每步纯重构 + typecheck/test 护栏 + 阶段提交回滚点;不在 live app 上单次手工重排 2600 行(类型检查盖不住"运行时漏 procedure"这类回归)。** 大拆分留作有界、逐块验证的独立改动。

### 已落地(本轮,均 typecheck 16/16 + test 全过)
- ✅ `3a001f0` fileToBase64 统一到共享模块 + 修 library 上传返 dataURL 潜伏 bug(P0-1)
- ✅ `031314d` 抽 `pricing.ts` 集中计费公式(computeTextCostCny/computeImageCostCny)+ 12 单测锁 moyu 实收口径 —— 根除"sonnet 倍率漂移"那类 bug 的土壤(P1)
- ✅ `c129192` sanitizeErrorMsg 安全脱敏 12 单测锁规则(P1)
- ✅ **P2 全量拆 god 文件**(7 个,均 byte-identical 纯搬运 + 名集合不变 + typecheck/test 全绿):
  - 路由:asset.ts 2636→35(5 sibling)· aigc.ts 1847→33(6)· storyboard.ts 1846→35(6)· script.ts 1145→28(4)
  - 组件:asset-edit-dialog 1791→294(8)· providers-table 1349→225(7)· top-bar 1287→175(3,含纯函数 shots-export)
  - 手法:helper/schema → `*-shared`;procedure/子组件按组 → sibling;主文件只 `router({...})` / 入口组装,**对外签名/导出名/路径全不变**(root.ts、调用方 import 零改)。每文件均 <800 行
- ✅ **P3 收编排(全跑完)** `3bf7816`/`76ac3ed`/`f76c382`:抽 `runTextGenerationAttempt`(状态机 + durationMs + 软失败 warning 通道 + wrapError,**7 单测**)→ 收敛 **inspiration 3 + asset 4 处**样板;`billingCycle()` 收敛 6 处裸写。
  - **对抗复核后明确安全保留**(碰钱/seam,合并会引入回归):worker refund(全退合并会改零成本行 ledger 行数;部分退需让 core 加 6 可选参数迁就)、`writeLedgerEntry`(各站点列集不同 → 抽象把显式漏列变静默漏列)、generateImage($transaction + MediaItem)、**EventBus + compliance provider(ADR-16/22 Phase-2 seam,同 EventBus 教训不删)**、storyboard-generate(create/update 跨并发池阶段)。
- ✅ **全盘 7 遍检查** `be8c416`(3 agent 多角度):连通性全绿(12 router 注册 / 4 拆分路由 procedure 守恒 32·19·18·18 / worker 生产-消费闭环 / 前端 P2 子组件全渲染 / typecheck 16·16);死代码清除 ~280 行(7 废弃 schema + mergeRouters + 3 未用 import);core/adapters/shared/app 本就 0 未用 import(健康)。

### 待续路线(按性价比 · 工作量 S/M/L · 风险)
| 项 | 量 | 险 | 方式 |
|---|---|---|---|
| **P2 拆 god 文件**:asset.ts 等先抽 `*-shared.ts`(helper/schema)→ 再按分区线把 procedure 组移到 `asset/{crud,generate,breakdown,candidates,bindings}.ts`(命名 const 导出,index 组装,**逐组 typecheck+test+procedure 计数校验**);top-bar 导出器→`lib/shots-export.ts` + 批量池→`useBatchGeneration`;asset-edit-dialog 抽 `useAssetEditForm` + `useMediaUpload` | L | 中 | 逐块独立改动,每块单独验证提交 |
| **P3 收编排**:抽 `runGenerationAttempt()` 收敛 13 处样板(先 inspiration 3 处最规整)+ `writeLedgerEntry()`(顺带集中 billingCycle)+ worker refund 改调 core/refund(已测)| M | 中 | 需 P1 测试网先行(部分已具备) |
| **P0-2** adminMutationHandlers:**仅** prompts/users 若匹配 toast+invalidate 模式才铺;providers-table 是 callback 模式,**不强改**(会改行为) | S | 低 | 可选 |
| **删死 EventBus**:全仓确认 0 外部 subscribe(通知走 Redis pub/sub),publish→void。删 12 publish + 模块 | S | 低 | 专项 PR(无害死码,非紧急) |
| **media→URL helper** `resolveMediaFetchUrl`:收敛 media.ts×2 + asset.ts×1 | S | 中 | 含 signed-url 异步 |
| 跳过项 | — | — | maxTokens(按动作语义值非重复);850 历史注释(金噪交织,半自动需人工 review) |

### 关联
ADR-29(剧本拆解)· ADR-30(图生图/参考音频/出场集)· 范本 `core/video-generation/*`

---

## ADR-35 · 桌面化打包:Tauri 自包含 + 驱动档 + 嵌入式 postgres(2026-06-09)

**背景**:把现有服务端应用(Next standalone + worker + pg/redis/minio,Docker)做成 Mac/Win 可安装的**单机离线**独立程序。约束(用户):**不能干扰现系统持续开发**。

**决策**:
1. **形态**:单人多设备 · 各机独立 · 离线。复用现有 `apps/desktop/` Tauri 2 骨架。
2. **驱动档**(非分叉):一组 env 开关,默认档(pg+redis+minio)**完全不变**;桌面档 = 一套 env。同代码两用,新功能自动进桌面版。`STORAGE_DRIVER=local-fs` · `CACHE_DRIVER=l1-only` · `PROGRESS_BUS_DRIVER=in-process`(EventEmitter) · `QUEUE_DRIVER=in-process`(worker 合进 web 进程,processor 移 `@ss/core/video-generation/process-job` 解耦 BullMQ)。
3. **数据库 = 嵌入式 postgres(零侵入),不用 SQLite**:承「不干扰现系统」—— 现有 schema / 计费(Decimal)/ `pg_advisory_xact_lock` / 裸 SQL **一行不改**。SQLite 需改 Decimal→String + 去 DB 聚合 + 重建迁移 + 锁换进程内(动计费核心),**弃为本期方案,留未来可选瘦身**。
4. **打包**:Tauri Rust 主进程 spawn Node sidecar 跑 standalone `server.js`(含进程内 worker)+ 内嵌 pg;数据目录经 `SS_DATA_DIR` 下发;首跑 bootstrap 生成密钥 + initdb + **复用现有 `migrate deploy` + `db:sync`** + seed。**更新**:新版 app 启动自动增量 migrate + db:sync,数据不丢。
5. **分发**:GitHub Actions matrix(Tauri 不能交叉编译)+ 签名/公证(mac Apple Developer / win 证书)。
6. **Phase 1(后端去 infra)已完成 + 集成验证**(2026-06-09);Phase 2(Tauri 打包 + 内嵌 pg)待做。坑:instrumentation 动态 import 须用 Next node-only 模式(`NEXT_RUNTIME` 守卫 + 单独文件)+ `serverExternalPackages`,否则 pg 进 edge bundle 致 500。

**关联**:占位 ADR-32(桌面/移动代码共享)更上位;本 ADR 聚焦打包/运行时架构。

---

## ADR-36 · 桌面打包实现(Step C/D/E):Tauri sidecar + esbuild 外置 @ss/db 根治 Prisma(2026-06-09)

ADR-35 定方向,本 ADR 记 Phase 2 落地的关键实现决策与踩坑(详见 PROGRESS 2026-06-09 通宵条)。

**结论**:Mac `.app`(576M)+ `.dmg`(300M)出包,实测内嵌 pg 引导 + 登录鉴权全通、自包含离线;Windows 走 CI。

1. **内嵌 pg 版本对齐**:`embedded-postgres@16.11.0-beta.15`(匹配 docker pg16)。坑:主包与 `@embedded-postgres/<platform>` 二进制包 beta 版号不同步 → 选「主包 + 4 平台二进制都存在」的版本。
2. **打包态无工具链**:打包后无 pnpm/prisma CLI/tsx。自写 SQL migration runner(读 `migration.sql` + prisma 兼容 `_prisma_migrations` 记账)+ esbuild 把 `seed.ts` 打成自包含 bundle;首跑全量 / 后续增量。
3. **★esbuild 外置 @ss/db 根治 Prisma**:打包态 prisma 查询报空 detail `Invalid invocation` = **Next/SWC 编译生成的 Prisma client 会搞坏查询构建器**(同款 client 经 esbuild 编译则正常)。解:`SS_DESKTOP_BUILD` 开关 —— 桌面构建时 @ss/db 移出 `transpilePackages`、进 `serverExternalPackages`;desktop-pack 用 esbuild 预编译 @ss/db(含生成 client)放进 standalone `node_modules`。**默认档(dev/docker)不开,零变化。**
4. **自包含 node_modules**:Next standalone 在 pnpm monorepo 需 `outputFileTracingRoot=仓库根`;`.pnpm` 扁平化 hoist(补 styled-jsx/@swc/helpers)+ 补 Next 漏 trace 的 @prisma/client·adapter-pg;**embedded-pg 的 dylib 是指向安装目录的绝对符号链接 → 必须 flatten 成真文件**(否则拷走/打包后断链 initdb 崩)。
5. **Tauri 壳**:`main.rs` spawn node sidecar + TCP 健康轮询 + 整组 SIGTERM 优雅退出;dev/打包双模(`cfg!(debug_assertions)`)。standalone host 用 `localhost`(修 next-intl rewrite 的 IPv4/IPv6 自代理 ECONNREFUSED)。
6. **CI**:macOS(aarch64)+ Windows(x64)双 runner(Tauri 不能交叉编译,Win 包只能 CI/Win 机出)。坑:全新 checkout 无 `packages/db/.env` → prisma generate 需占位 DATABASE_URL;desktop-pack 在 Windows 调 npm/rustc 需 `shell:true`。
7. **签名**:当前未签名/未公证 → 新机首次打开需绕 Gatekeeper(右键打开 / `xattr -cr "<app>"`);纯双击需 Apple Developer($99/yr)+ Win 代码签名证书(行政待办)。

**关联**:承 ADR-35(桌面化方向 + 驱动档 + 嵌入式 pg)。

---

## ADR-37 · Win 安装包"全新机一步到位"+ 卡 splash 双根因修复(2026-06-14)

**状态**:✅ 已采纳。承 ADR-36。背景:之前打包的 Win 安装包在全新机上"打开永久卡 splash 初始界面、无任何信息"。全盘排查定位为**两个独立 bug 叠加**(都让 bootstrap 在 web 绑 :47900 前崩溃 → splash 永不跳转),另带一个 MSI 构建期硬限制。

**决策**:
1. **VC++ CRT 走 app-local 部署(非装 redistributable)**。根因:内嵌 `@embedded-postgres/windows-x64` 的 `postgres.exe`/`initdb`/`libpq`/wx* 全部 import `vcruntime140.dll`/`msvcp140.dll`/`vcruntime140_1.dll`,这 3 个 CRT 既不在包里、全新 Win10/11 也不保证有(只随 VC++ 2015-2022 Redist 装)→ PG 起不来 → 卡死。构建机有 VS BuildTools 自带这些 DLL,**恰好长期掩盖**。**采纳**:`desktop-pack.mjs` 把 3 个 CRT DLL 拷进 PG `native/bin`(Windows DLL 搜索顺序里 exe 自身目录优先 System32 → 就地解析,微软官方支持的 app-local 部署)。**替代方案**:NSIS 钩子静默装 redist(只对 NSIS 生效,MSI 走 WiX 不行)/ WiX 自定义动作(更繁)/ 装时下载(违背离线一步到位)→ app-local 最轻(~2MB)、打包器无关、无 UAC。
2. **`run()` 绝对路径 exe 不走 shell**。根因:`desktop-bootstrap.mjs` 的 `run()` 一律 `shell:true`(因 pnpm 是 .cmd),但跑含空格的 `process.execPath`(`C:\Program Files\...\node.exe`)时 shell 不加引号 → 被 cmd 拆成 `C:\Program` → 打包态 seed 必挂、**所有 Win 机都中招**(既有 bug,本次冒烟测试当场抓到)。**采纳**:`shell: win32 && !/[\\/]/.test(cmd)`(裸命令 pnpm 仍走 shell,绝对路径直跑)。
3. **删 standalone 冗余 `.pnpm` 修 MSI MAX_PATH**。`next@16.2.9` 的 `.pnpm` 目录名带 peer 哈希(`next@16.2.9_@babel+core@7.29.7_react-dom...`)使文件路径超 Windows 260 字符 → WiX `light.exe` LGHT0103 打不开 → MSI 构建挂。`hoistPnpmFlat` 已把真包提到 node_modules 顶层(npm 式可解析),`.pnpm` 是死重量。**采纳**:pack 删 `.pnpm`(实测 standalone 去掉后 Next 正常 Ready + worker 注册 + Prisma 加载,不依赖它)→ 消灭超长路径 + 瘦身 45MB。
4. **打包目标 MSI + WebView2 offlineInstaller**。`tauri.conf.json` `targets:["msi"]` + `bundle.windows.webviewInstallMode:{type:"offlineInstaller"}` → 完整 WebView2 运行时安装器内嵌 MSI Binary 表,装时静默装(已装跳过,`NOT INSTALLED_WEBVIEW2_VERSION` 守卫)→ **真离线、不联网**。代价:MSI ~240→~430MB(+WebView2 ~150MB)。
5. **诊断兜底**:`desktop-server.mjs` 从进程第一行 tee 全部输出到 `%APPDATA%\StarsAlign Studio\logs\desktop.log`(旧版日志在 bootstrap 返回后才开 → bootstrap 崩溃阶段全丢),失败写 `last-error.txt`,`main.rs` 超时把真实错误回显到 splash。把"无声卡死"变"自报错"。

**验收(本机,2026-06-14)**:① 依赖齐全(CRT/node/PG/4 外置包/prisma/seed/44 迁移 + WebView2 离线内嵌)② `msiexec /a` 管理式解包 exit 0 ③ 完整链端到端跑通 web 返回激活页 200 + 28KB HTML(非 splash)。回归工具 `scripts/verify-desktop-flow.mjs`。**唯一未本地验证**:CRT 修复在真·无 VC++ 机上的效果(本机自带系统 CRT)→ 待干净机实装确认。

**代价/风险**:MSI 体积大(~430MB);未签名(SmartScreen 拦);app-local CRT 源依赖构建机有 VS Redist 文件夹(回退 System32),换 CI 机需确保其一存在。

**关联**:承 ADR-36(桌面打包实现);依赖矩阵见 [[win-laptop-desktop-build]] 记忆。

---

## 待补充的决策(占位)

📋 ADR-32 · 桌面端 vs 移动端的代码共享策略(Phase 2 拆分时)
📋 ADR-33 · 私有部署 vs SaaS 双轨的数据隔离策略(Phase 2)
📋 ADR-34 · 海外多区域部署(Phase 3 国际化时)
