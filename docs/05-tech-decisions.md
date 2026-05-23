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
**日期**：2026-05-21 · **状态**：📋 Phase 2 启用

**决策**：Phase 2 引入多 Agent 时用 LangGraph，不用自研 / CrewAI / AutoGen。

**替代方案**：
- 自研 — 工作量大、缺成熟工具
- CrewAI — Python only、可观测弱
- AutoGen — Microsoft 系，节奏不稳

**理由**：
- 有状态图（State Graph）一等公民
- Human Gates 内置（关键节点必须人工确认）
- 可观测：每步推理链可追溯
- LangSmith 配套集成

**风险**：Python 服务额外部署成本，多 Agent token 用量需 Budget 控制。

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

## 待补充的决策（占位）

📋 ADR-19 · 桌面端 vs 移动端的代码共享策略（Phase 2 拆分时）
📋 ADR-20 · 私有部署 vs SaaS 双轨的数据隔离策略（Phase 2）
📋 ADR-21 · 海外多区域部署（Phase 3 国际化时）
