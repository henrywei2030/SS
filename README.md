# StarsAlign Studio · 星垣工坊 (SS)

> AI 短剧生产平台 — 让一个人，导演一部世界级短剧。
>
> **垣** = 城墙、屏障。群星垒垣 — 当剧本、美术、AI、团队这群"星"齐心垒起内容之"垣"，万剧自然汇聚。

---

## 一句话定位

围绕 **AI 短剧 / AI 漫剧 / AI 真人剧生产流程** 搭建的下一代制作平台，覆盖：**剧本 → 分析 → 分镜 → 数字资产 → AIGC 抽卡 → 素材库 → 团队协作 → 数据监控** 全链路。

---

## 系统模块

### Phase 1（本仓库当前范围 · 8 周原型）

| 模块 | 代号 | 说明 |
|---|---|---|
| 项目首页 | Mission Control | 多项目入口、单项目工作台 |
| 剧本工作区 | Story Compass | 上传/分集/AI 分析/8 维评分/剧情曲线 |
| 分镜工坊 | Storyboard Studio | Linear 三栏、AI 分镜、向下合并、发布 |
| 美术工作台 | Asset Forge | 人物（三视图+合规）/场景（360°）/道具 |
| AIGC 抽卡引擎 | Generation Engine | 资产自动 @ / Seedance 单模型抽卡 / 历史采纳 |
| 素材库 | Media Vault | 上传/搜索/收藏/批量；波形预览；AI 打标 |
| 数据驾驶舱 | Insight Cockpit | 成本/抽卡率/模型分布/项目 Top |
| 团队协作 | Collab Hub | 成员/权限/集数分配/进度/工作报告 |
| 后台管理 | Admin | 提示词模板/风格/预设/Provider 配置 |

### Phase 2+（数据模型与接口已预留，不在 Phase 1 实现）
- 多模型 Race · Auto-Salvage · Voice Studio · 内置剪辑 · Compliance Sentinel 全模块 · 多 Agent 评审 · LangGraph · 支付 · 多语言扩 JP/KR/TH/ES

### Phase 3+（旗舰功能）
- Wireless Canvas（无线画布） · 3D 一致性（Gaussian Splatting） · Distribution Hub · Plugin SDK · Marketplace

---

## 技术栈速览

| 层 | 选型 |
|---|---|
| 桌面 | Tauri 2 |
| 前端 | Next.js 15 + React 19 + TypeScript + Tailwind v4 + shadcn/ui |
| API | tRPC v11 + Zod |
| DB | PostgreSQL 16 + Prisma |
| 队列 | BullMQ + Redis 7 |
| 存储 | MinIO（本地）/ R2/OSS（云端切换） |
| 协作 | Y.js + Hocuspocus（仅分镜表） |
| 国际化 | next-intl（CN/EN，Phase 1） |
| Monorepo | pnpm workspace + Turborepo |

---

## 仓库结构

```
apps/
├── desktop/      # Tauri 包装（主交付）
└── web/          # Next.js（同源代码，Web 备用）

packages/
├── ui/           # 设计系统（shadcn/ui + Tailwind）
├── db/           # Prisma schema + client
├── api/          # tRPC routers
├── core/         # 领域逻辑（pure functions）
├── workers/      # BullMQ 任务
├── adapters/     # ★ 云端切换关键 ★
│   ├── storage/  # local-fs / minio / r2 / oss
│   ├── provider/ # seedance / 豆包 / nano-banana / gpt-image / litellm
│   ├── auth/     # local / clerk / workos
│   └── eventbus/ # in-process / nats / kafka
├── i18n/         # 多语言文案
└── shared/       # types + zod schemas + constants

infra/
└── docker-compose.yml   # PG + Redis + MinIO（本地一键起）
```

---

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 启动本地依赖（PG + Redis + MinIO）
docker compose -f infra/docker-compose.yml up -d

# 3. 初始化数据库
pnpm db:migrate
pnpm db:seed

# 4. 启动开发
pnpm dev   # 同时启动 web + worker
```

---

## 关键文档

- 实施方案：`~/.claude/plans/dynamic-booping-cocoa.md`
- 设计资料：`../01-AI短剧系统/`（原 V2 截图与设计文档）

---

## 路线图

| 阶段 | 时间 | 内容 |
|---|---|---|
| **W1-W8** | 8 周 | Phase 1 原型 → 团队真实使用 |
| **Phase 2** | 2-4 月 | 多模型 / 内置剪辑 / 支付 / 云端化 |
| **Phase 3** | 4-9 月 | Canvas / 3D / Distribution / Plugin |

---

## License

Private / Internal (TBD)
