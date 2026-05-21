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
