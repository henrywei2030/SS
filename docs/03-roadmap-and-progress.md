# 03 · 路线图与进度

> 8 周原型 → Phase 2 SaaS 化 → Phase 3 全栈生产 OS

---

## 📊 当前进度速览(2026-05-24,十一收工后)

| Phase | 状态 | 完成度 |
|---|---|---|
| **W1 基础设施**(10 子任务) | ✅ 完成 | 10/10 |
| **W2 应用层**(7 子任务) | ✅ 完成 | 7/7 |
| **UI 系统升级** | ✅ 完成 | 双主题 + Logo + Cursor 风格 |
| **W3 分镜工坊** | ✅ 完成 | 100%(W3.0-W3.7 + 3 轮 audit + W3.1.followup 软锁) |
| **W4 美术工作台** | ✅ 完成 | 100%(W4-MM.0-W4-MM.9 + 6 轮 audit + mock ImageProvider) |
| **W5 抽卡引擎** | 🚧 90% | W5.0-W5.4 ✅(数据底座 + token 化 + AIGC 工作台 + Seedance Mock 抽卡 + 历史 + 集数总览);W5.5 BullMQ worker / W5.6 素材库 pending |
| **W6 数据洞察** | ✅ MVP 完成 | insightsRouter 3 procs + KPI/日趋势/kind 分布/模型分布/Top10 group |
| **W7 后台三件套** | ✅ MVP 完成 | admin/prompts(版本树+回滚)/ admin/styles(create+delete)/ admin/presets(4 类 framing+angle+movement+lighting)/ admin/bindings |
| **W8 团队实战** | 📋 待启动 | 等 W5.5 真接 Seedance + 配 API Key |
| **Phase 2** | 📋 待启动 | 数据模型 + 接口 + 15+ hook 字段已预留 |
| **Phase 3** | 🔮 远期 | Schema 字段已预留 |

**整体可升级性评级:A**(详见 `PROGRESS.md` 中 11 次收工 + 11 轮 audit 共 36 项 P0/P1/P2 修复记录)

### 收工 / audit 累计

- **11 次收工**,29+7 项 P1/P2 audit 全清(ADR-24 8 项护城河外部验证)
- **18 个 migration apply**(最新 ADR-23 Shot 首尾帧字段预留)
- **17 ADR 已落定**(ADR-22 Mastra over LangGraph 取代 ADR-01)
- **110 单测全过零回归**(60 core + 25 api + 14 episode-lock + 11 script-extract)

---

## 🗓 8 周原型节奏（Phase 1）

| 周 | 主题 | 状态 | 关键交付 |
|---|---|---|---|
| **W1** | 地基 | ✅ | Monorepo · Prisma 24 表 · 三大 Adapter · Cost Ledger · Docker · 核心算法 · API Key 加密 · i18n · 品牌 · DB 规划 |
| **W2** | Mission Control + Story Compass | ✅ | tRPC v11 · 6 路由 · Next.js 15 · 登录 · Mission Control · /admin/providers · Claude LLM · 8 维分析 |
| **W3** | Storyboard Studio | ✅ | 数据底座 + 11 procedures + 多格式上传 + 三栏 UI + 合并拆分 + 行内编辑入训练集 + 字号/进度/CSV |
| **W4** | Asset Forge | ✅ | 数据建模(archetypeKey+7 视角槽位+L0-L5 maturity)+ 20+ procedures + 三栏编辑弹窗 + mock ImageProvider + 缺口检测 + 审计页 + 6 轮 audit 修 28 项 P0/P1 |
| **W5** | Generation Engine + Media Vault | 🚧 | W5.0 ✅(SystemSetting + compileShotVideoPrompt + providerJobId)· W5.1+ 自动 @ 资产 · 单模型抽卡 · 历史采纳 · 素材库 |
| **W6** | Insight Cockpit + Collab Hub | 📋 | 数据总览 · 抽卡率 Top10 · 成员/集数/工作报告 |
| **W7** | 后台 + 国际化 + 打磨 | 📋 | Prompt/风格/预设/Provider · EN 文案 · Tauri 打包 |
| **W8** | 团队真实使用 + 紧急迭代 | 📋 | 5 人冷启动 · 完成 1 集 7 镜头实战 · P0/P1 修复 |

### 里程碑

- **M1（W4 末）**：演示给团队的 alpha（剧本+分镜+资产 demo flow）
- **M2（W6 末）**：内部 beta，全功能可联机
- **M3（W8 末）**：team-tested v0.9，进入"边用边迭代"周期

---

## ✅ W1 已完成（10 子任务详情）

### W1.1 Monorepo 根目录结构
- `pnpm-workspace.yaml` + `turbo.json` + `tsconfig.base.json`
- 6 packages 占位 + 2 apps 占位 + `infra/` + `docs/`

### W1.2 Prisma Schema 与 db 包
- 24 张表 · 18 枚举 · 完整 seed
- 含 Phase 2/3 预留字段（详见 `docs/04-data-model.md`）

### W1.3 三大 Adapter 接口
- Storage：MinIO + LocalFs
- Provider：types + base + Seedance + 注册中心
- EventBus：InProcess
- Auth：LocalAuth（JWT + bcrypt）

### W1.4 Cost Ledger 中间件
- `BaseProvider.recordLedger()` 自动记账
- 项目级预算护栏
- `getProjectCostBreakdown / getShotCost / getProjectGachaRatio` 便利函数

### W1.5 docker-compose
- PostgreSQL 16 + Redis 7 + MinIO 一键起
- 自动初始化 bucket + extensions
- Hocuspocus profile 占位

### W1.6 核心算法
- `storyboard/merge.ts` 向下合并（动态 maxDuration + S 级隔离 + 场景连续性）
- `generation/auto-match.ts` 资产自动 @（长名优先 + OS 检测）
- `generation/prompt-compiler.ts` Prompt 编译
- 17 个单元测试

### W1.7 API Key 后台加密存储
- AES-256-GCM 加密（`crypto.ts`）
- ProviderConfig 表新增 4 字段
- 业务调用：DB 优先 → env fallback
- 后台管理 API（list / setApiKey / clearApiKey / setActive）

### W1.8 i18n CN/EN 基础设施
- next-intl + ICU MessageFormat
- 8 个 locale 文件（CN/EN × common/modules/enums/auth）
- 9 个单元测试

### W1.9 品牌中文名「星垣工坊」
- 全仓库统一品牌
- 寓意：群星垒垣，万剧汇聚

### W1.10 自建 DB 浏览器规划
- `docs/W2-admin-module-spec.md` 300 行
- 替代 Prisma Studio 的完整功能规划

---

## ✅ W2 已完成（7 子任务详情）

### W2.1 tRPC v11 框架
- Context（auth/locale/audit）
- 3 种 procedure（public/protected/admin）
- 自动错误转换 + SsError 中间件

### W2.2 6 个子路由
| Router | 功能 |
|---|---|
| `auth` | login / signup / logout / changePassword |
| `me` | session / setLocale / projects |
| `project` | CRUD + clone |
| `script` | upload / list / analyze（同步 Claude）/ latestAnalysis |
| `admin` | provider / style / prompt / system 子路由 |
| `i18n` | messages / supported |

### W2.3 apps/web Next.js 15 + Tailwind v4 + shadcn
- Next.js 15 App Router
- Tailwind v4 (@theme)
- 8 个核心 UI 组件
- tRPC client + Provider
- 中间件 + 防 FOUC 主题脚本

### W2.4 登录页 + TopNav + 语言切换
- 极简登录卡 + dot grid 背景
- TopNav（Logo / 工作台 6 标签 / ⌘K 搜索 / 主题 / 语言 / 通知 / 用户菜单）
- 语言切换器（CN/EN）

### W2.5 Mission Control
- 项目列表（行式紧凑表格）
- 项目详情（KPI + 工作台入口 + 团队）
- 创建/克隆项目对话框

### W2.6 /admin/providers
- 表格化 Provider 列表（按 kind 分组）
- 设置 API Key 弹窗（脱敏显示 + 加密入库）
- 启停 / 单价 / 限流编辑

### W2.7 Claude + Story Compass
- ClaudeTextProvider 完整实现
- 同步调用模式（Phase 2 改异步 worker）
- Story Compass 8 维雷达 + 剧情曲线 UI

---

## ✅ UI 系统升级

经历 3 次完整迭代：

### v1 极光金风格
- Aurora 流动背景 + glow-pulse 呼吸 + 金渐变文字
- Logo「星」字闪烁
- ZCOOL XiaoWei 中文衬线

### v2 Cursor 极简风
- 去掉所有装饰渐变 / 光晕 / 装饰字体
- 中性灰 + 蓝色 accent
- 紧凑信息密度（13px 字 / 28px 按钮）

### v3 双主题切换 + Logo + 后台字号
- 明亮模式 (#FFFFFF) ↔ 深夜模式 (#1F1F1F)
- 防 FOUC 内联脚本
- Logo 系统（LogoMark + Wordmark + LogoLockup + favicon）
- admin-pane 字号 +1px

---

## 📋 W3 详细规划（下一阶段）

### W3.1 三栏 Linear 布局
- 集列表（左）
- 剧本（中）
- 分镜（右）

### W3.2 storyboardRouter
- `generate` — 调 Claude 把剧本拆成分镜
- `list / update` — 分镜 CRUD
- `mergeDown` — 调用 W1.6 `mergeShots` 算法
- `publish` — 触发 `EVENTS.STORYBOARD_PUBLISHED`
- `rollback` — 回滚到上一版本

### W3.3 关键交互
- 行级 hover 显示「重抽 / 重写 / 锁定」
- 顶部价值带 Sparkline
- 批量操作浮动工具条
- 快捷键全覆盖（Cmd+K palette / J/K 上下 / Shift+M 合并）

### W3.4 Y.js + Hocuspocus 试点
- 仅分镜表启用 CRDT
- 多光标 + Presence
- 单点 Hocuspocus（Phase 2 多实例时切 NATS-backed）

### W3.5 草图低成本预览
- 接 Nano Banana Fast / Lucid-Origin
- 每张 ¥0.01
- 帮助导演快速 review 分镜

### W3 验收
- 一集 7 镜头能完整生成、编辑、合并、发布到 AIGC

---

## 🔮 Phase 2（2-4 个月）

按重要度排序的解锁顺序：

### P2.1 多模型 Race + Auto-Salvage
- 同镜头 Seedance + Veo + Kling 并行抽卡
- 失败片段自动扫描可用 2-3s

### P2.2 Voice Studio + 内置剪辑
- 声音克隆 + 情感化配音
- Web 时间线 + AI 粗剪 + 多平台导出

### P2.3 Compliance Sentinel
- 三阶段合规
- 多平台规则库

### P2.4 多 Agent 评审 + Mastra（ADR-22 撤销原 LangGraph）
- Critic + Defender + Judge 对抗评分
- 用 Mastra workflow + supervisor 编排（TS 全栈,跟 BullMQ/Cost Ledger 同进程）
- 可观测推理链（GenerationAttempt + OperationLog 已有,无需 LangSmith）

### P2.5 Stripe + 支付宝
- 订阅 + 按量计费
- Cost Ledger → 月度账单

### P2.6 云端切换
- 同一份代码部署到云
- StorageAdapter → R2/OSS
- EventBus → NATS

### P2.7 多语言扩展
- 加 JP / KR 词条
- AI 自动翻译流（DeepL + Claude 校对）

---

## 🔮 Phase 3（4-9 个月）

### P3.1 Wireless Canvas 无线画布 ⭐ 旗舰
- 三种 Canvas 模式
- AI 副驾驶
- 与 Linear 同源数据

### P3.2 3D 一致性
- Gaussian Splatting 数字分身
- 任意角度参考图

### P3.3 Distribution Hub
- 多平台发布
- 数据回流 + ROI

### P3.4 Plugin SDK + Marketplace
- 第三方插件
- 模板市场

### P3.5 海外平台合规网关
- TikTok / YouTube / Sora 适配
- 国别敏感词库

---

## 🚨 风险与已知遗留

| 风险 | 影响 | 缓解 |
|---|---|---|
| 多 Agent token 爆炸 | 高 | Mastra workflow 显式 step + Token Budget(Cost Ledger 守门) + Critic 早停 |
| Provider API 涨价 / 不可用 | 高 | LiteLLM Adapter + 3 Provider 备份 + 本地开源托底 |
| 3D 一致性效果不达标 | 中 | 先 LoRA + 三视图保底，3D 为加分项 |
| 真人脸 / IP 侵权 | 极高 | Compliance Sentinel + 数据水印 + 法律险 |
| GPU / API 失控 | 高 | Cost Guardian 三级硬护栏 + 异常告警 |

---

## 📌 当前 TODO 速查

详细任务清单见项目根 `TODO.md`：
- 🚧 进行中：W3 Storyboard Studio
- 📋 待办：W3-W8 完整拆分（共 30+ 子任务）
- ✅ 已完成：W1 + W2 + UI 升级 + 升级性基础设施（共 30 项）
- 💡 想法池：10+ 个 Phase 2/3 idea
