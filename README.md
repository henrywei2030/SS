# StarsAlign Studio · 星垣工坊

> **AI 短剧 / 漫剧 / 真人剧生产平台** — 让一个人,导演一部世界级短剧。
>
> **垣** = 城墙、屏障。**群星垒垣** — 当剧本、美术、AI、团队这群"星"齐心垒起内容之"垣",万剧自然汇聚。

![Phase 1](https://img.shields.io/badge/Phase%201-W1--W6%20%E2%9C%85-success) ![W7](https://img.shields.io/badge/W7-%E6%94%B6%E5%B0%BE%E4%B8%AD-orange) ![W8](https://img.shields.io/badge/W8-%E5%AE%9E%E6%88%98%E5%BE%85%E5%90%AF-blue) ![License](https://img.shields.io/badge/License-Private-lightgrey)

---

## 一句话定位

围绕 **AI 短剧 / AI 漫剧 / AI 真人剧生产流程** 搭建的下一代制作平台,覆盖:

```
剧本上传 → 智能分析 → 分镜生成 → 数字资产 → AIGC 抽卡 → 团队协作 → 素材库 → 数据监控
```

全链路本地化,**Mock 全跑通**(零 API Key 即可演示),真接 Provider 时只换 switch。

---

## 路线图与完成度

| 阶段 | 状态 | 内容 |
|---|---|---|
| **W1** 地基(Monorepo + Prisma 24 表 + 3 Adapter + Cost Ledger + Docker) | ✅ 完成 | 10/10 子任务 |
| **W2** 应用层(tRPC + Mission Control + Story Compass + admin/providers) | ✅ 完成 | 7/7 |
| **W3** Storyboard Studio(三栏 + 多格式上传 + 合并拆分 + PromptEdit 训练) | ✅ 完成 | 100% |
| **W4** Asset Forge(7 视角 + L0-L5 maturity + archetypeKey 同人物多变体) | ✅ 完成 | 100% |
| **W5** Generation Engine(W5.0-W5.4 ✅ + **W5.5 BullMQ 异步** ✅ + **W5.5.1 扩展参数** ✅ + **W5.6 Media Vault** ✅) | ✅ 完成 | 100% |
| **W6** Insight Cockpit + Collab Hub(数据洞察 + 全局用户管理 + 项目成员/集分配 + 工作报告) | ✅ 完成 | 100% |
| **W7** 后台 + 国际化 + 打磨(audit/api-usage/settings/health/users/reports/db-explorer + Tauri 骨架 + EN 文案) | 🚧 收尾 | ~85% |
| **W8** 团队真实使用(配 API Key → 1 集 7 镜头实战) | 📋 待启动 | — |

**累计 19 ADR / 19 migrations / 15 次收工 / ~75 项 audit 修复**。

---

## 核心特性

| 模块 | 亮点 |
|---|---|
| 🎬 **Storyboard Studio** | 一站式剧本上传(docx/md/txt/rtf/html)+ LLM 自动分镜 + 合并拆分 + 行内编辑入训练集 |
| 🎨 **Asset Forge** | 7 视角图 + archetypeKey 同人物多变体(护城河)+ L0-L5 成熟度 + 缺口检测 + 审计页 |
| ✨ **AIGC 引擎** | BullMQ 异步抽卡(W5.5)+ HMAC 5min token SSE 实时进度 + 自动重连续期 + 失败白名单分类 |
| 📚 **Media Vault** | /library 全局素材库 + 上传/搜索/收藏/4 视图 tabs + AIGC 自动沉淀 |
| 👥 **Collab Hub** | 项目成员管理 + 集数分配看板(OWNER/COLLAB/REVIEWER)+ 工作报告(4 数据源聚合) |
| 📊 **Insight + Admin** | 数据洞察 KPI/趋势/分布 + audit/settings/health/api-usage/users/reports 7 后台页 |

---

## 快速启动

```powershell
# 1. 准备环境(首次)
pnpm install
pnpm setup:env       # 自动生成 .env.local(JWT_SECRET / APP_MASTER_KEY 等)
pnpm preflight       # 30s 环境自检(node/pnpm/docker/git/env)

# 2. 起基础设施(PostgreSQL + Redis + MinIO)
pnpm infra:up

# 3. 初始化数据库
pnpm db:generate
pnpm db:migrate:deploy   # 应用 19 个 migration
pnpm db:seed             # 初始数据(管理员 admin/admin123 + style + provider)

# 4. 启动 3 个进程
# 终端 1
pnpm dev                 # Next.js @ :3000
# 终端 2
pnpm worker:dev          # BullMQ video-gen worker(W5.5 异步)
# 终端 3(可选)
pnpm infra:logs          # 容器日志监控

# 5. 浏览器打开
# http://localhost:3000/zh-CN
# 登录 admin/admin123 → 创建项目 → 走全流程
```

详细环境搭建:
- macOS:[docs/HOME-SETUP.md](docs/HOME-SETUP.md)
- Windows:[docs/SETUP-WINDOWS.md](docs/SETUP-WINDOWS.md)

---

## 技术栈

| 层 | 选型 |
|---|---|
| **前端** | Next.js 15 + React 19 + Tailwind v4(双主题 Cursor 风)+ next-intl(zh/en) |
| **API** | tRPC v11 + Zod(13 router + ~150 procedure) |
| **DB** | PostgreSQL 16 + Prisma 5(24 表 + 19 migration) |
| **队列** | BullMQ 5 + ioredis(W5.5 video-gen 异步 worker)|
| **存储** | MinIO(本地)+ S3 兼容(Phase 2 切 R2/OSS) |
| **AI Provider** | Mock 全链路(picsum / w3.org 样片)+ Claude/Seedance 真接入预留 |
| **桌面** | Tauri 2(apps/desktop 骨架就绪,W7 收尾后真编译) |
| **Monorepo** | pnpm workspace + Turborepo(2 apps + 7 packages + 1 worker 进程) |

---

## 模块全景

```
                                  apps/web (Next.js)
                                       ↓ tRPC
   ┌────────┬────────┬────────┬────────┴────────┬────────┬────────┐
   │ 导演    │ 美术    │ AIGC    │     团队        │ 素材库  │ 后台    │
   │ Story   │ Asset  │ Engine  │  Collab Hub    │ Media  │ Admin  │
   │ Compass │ Forge  │ (W5.5) │ (W6 三波)       │ Vault  │ 7 页   │
   └────────┴────────┴────────┴────────┬────────┴────────┴────────┘
                                       ↓ EventBus + Redis pub/sub
                              ┌─────────────────────┐
                              │  apps/workers/      │
                              │  video-gen (W5.5)   │
                              │  graceful shutdown  │
                              │  + SSE pub          │
                              └─────────────────────┘
                                       ↓
                              PostgreSQL + Redis + MinIO
```

详见 [docs/02-modules-design.md](docs/02-modules-design.md)。

---

## 关键决策记录(ADR)

19 条核心 ADR,涉及:Modular Monolith / Cost Ledger 双写防御 / Mastra over LangGraph / **W5.5 BullMQ 异步化** / **Agent 联动接口预留** / 等。

详见 [docs/05-tech-decisions.md](docs/05-tech-decisions.md)。

---

## 协作流程

跨设备开发(macOS / Windows):

| 时机 | 命令 |
|---|---|
| 开工 | `开工,在 <代号>`(Claude Code 自动 git fetch + 强同步 + 环境差异提示) |
| 收工 | `收工`(Claude Code 自动更新 TODO/PROGRESS + commit -A + push + verify) |
| 切设备 | 上一台 `收工` → 下一台 `开工,在 <代号>` |

详见 [CLAUDE.md](CLAUDE.md)。

---

## License

Private / Internal(Phase 2 评估是否开源核心 / 双轨)
