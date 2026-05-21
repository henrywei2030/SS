# 📚 StarsAlign Studio · 文档体系

> 这里是 SS 项目的**唯一规划真相源**。
> 所有架构、模块、路线图、决策都在这。
> 不要在项目外（`~/.claude/`、Downloads、聊天工具）维护"另一份规划"。

---

## 🗺 文档导航

### 📐 系统设计（核心规划）

| 文档 | 作用 | 阅读时机 |
|---|---|---|
| **[00-vision-and-positioning.md](./00-vision-and-positioning.md)** | 一句话定位、品牌、差异化对比、三大护城河 | 第一次接触项目时 |
| **[01-architecture.md](./01-architecture.md)** | 7 层架构 + Mermaid 图 + 三大 Adapter + 升级性基础设施 | 写跨模块代码前 |
| **[02-modules-design.md](./02-modules-design.md)** | 15+ 模块的详设（Phase 1 已完成 / Phase 2 / Phase 3） | 开发某模块前 |
| **[03-roadmap-and-progress.md](./03-roadmap-and-progress.md)** | 8 周节奏 + W1-W2 完成度 + Phase 2/3 解锁顺序 | 每周开工 / 季度复盘 |
| **[04-data-model.md](./04-data-model.md)** | Prisma 24 表 + 18 枚举 + Phase 2/3 升级预留字段 | 设计新功能涉及数据时 |
| **[05-tech-decisions.md](./05-tech-decisions.md)** | 关键架构决策记录（ADR） | 选型踩坑前查"为什么这么定" |

### 🛠 操作指南

| 文档 | 作用 |
|---|---|
| **[HOME-SETUP.md](./HOME-SETUP.md)** | 在家 Mac Studio 首次接续 + 日常开工流程 |
| **[THEMING.md](./THEMING.md)** | 主题系统使用与扩展（新增明亮/深夜/高对比） |
| **[W2-admin-module-spec.md](./W2-admin-module-spec.md)** | 自建数据库浏览器 / Admin 模块 W2 规划 |

### 📋 项目级状态（项目根，不在 docs/）

| 文档 | 位置 | 作用 |
|---|---|---|
| **[CLAUDE.md](../CLAUDE.md)** | 项目根 | Claude Code 协作协议（开工/收工） |
| **[TODO.md](../TODO.md)** | 项目根 | 任务清单（进行中/待办/已完成/想法池） |
| **[PROGRESS.md](../PROGRESS.md)** | 项目根 | 每日开发日志 |
| **[README.md](../README.md)** | 项目根 | 项目简介 |
| **[QUICKSTART.md](../QUICKSTART.md)** | 项目根 | 快速启动指南 |

---

## 🎯 不同角色的推荐阅读路径

### 🆕 新加入团队的人
1. `README.md`（根） → 知道这是啥
2. `docs/00-vision-and-positioning.md` → 为什么做这个
3. `docs/03-roadmap-and-progress.md` → 现在做到哪
4. `QUICKSTART.md`（根） → 把本地跑起来
5. `docs/02-modules-design.md` → 看分配给你的模块

### 🏠 在家继续做的你
1. `docs/HOME-SETUP.md` → 把家里 Mac 跑起来
2. `PROGRESS.md`（根） → 上次做到哪了
3. `TODO.md`（根） → 今天该做啥

### 🏗 准备做 Phase 2 / 3 模块
1. `docs/01-architecture.md` → 架构红线
2. `docs/02-modules-design.md` → 找到目标模块的"待做"清单
3. `docs/04-data-model.md` → 看 schema 是否需扩展
4. `docs/05-tech-decisions.md` → 看相关 ADR 有没有约束

### 💬 在 claude.ai Chat 讨论
建议上传到 Project 知识库的文档：
- ✅ 必传：`CLAUDE.md` / `TODO.md` / `PROGRESS.md` / `docs/README.md`
- ✅ 讨论架构时再传：`docs/00` / `docs/01` / `docs/03`
- ⚪ 偶尔用：`docs/02` / `docs/04` / `docs/05`

---

## 🔄 跨设备协同 SOP

### 协同的本质

**3 个层面**必须同步，**3 个层面**独立保留：

| 类型 | 同步方式 |
|---|---|
| ✅ 源代码 / 配置 / docs/ / 任务进度 | **`git pull` / `push`** |
| ✅ Claude Code 协作行为 | **`CLAUDE.md`**（已在 git） |
| ✅ Chat 模式上下文 | **claude.ai Project 知识库**（手动重传 TODO/PROGRESS） |
| ❌ 本地密钥 `.env.local` | 各机器自己生成（不进 git） |
| ❌ 本地数据库 | 各机器跑各自 Docker（互相独立） |
| ❌ 加密的 API Key | 各机器后台单独填（用本机 APP_MASTER_KEY） |

### 标准换设备 SOP（按 CLAUDE.md 协议）

```
═════════ 当前机器收工 ═════════
1. Code 终端说："收工"
2. 我会：更新 TODO/PROGRESS → review → 等你确认 → commit + push
3. push 完后我会提醒：重新上传 TODO/PROGRESS 到 claude.ai SS Project 知识库
4. 关机

═════════ 新机器开工 ═════════
1. cd ~/Project/starsalign-studio
2. git pull
3. Code 终端说："开工"
4. 我会：读最新 PROGRESS/TODO → git status → 给你 150 字简报
```

### ⚠️ 协同三大铁律

1. **规划文档只在 docs/ 里改** — 不要在 Downloads / 个人云盘 / 别的目录维护副本
2. **改完必 push** — 即使只是改个 typo，也要 push 让另一台机器同步
3. **每次"收工"重传 Project 知识库** — 这是 Chat 模式跨设备同步的唯一途径

---

## 📌 文档维护原则

1. **单一真相** — docs/ 内的内容**优先级最高**，与代码/Claude 记忆/Chat 历史不一致时以 docs/ 为准
2. **小步快迭代** — 不要等"一次写完美"，先有再优；改动小就直接 commit
3. **变更必记** — 重要决策变更后，更新对应 docs 文件 + 在 `PROGRESS.md` 记一条
4. **链接代替复制** — 跨文档引用用相对路径链接，不要复制段落
5. **去陈词滥调** — 删除"占位待补充"等无信息内容；写不出来就别留位

---

## 🆘 找不到东西？

| 想知道 | 看哪 |
|---|---|
| 这项目是干啥的 | `docs/00-vision-and-positioning.md` |
| 整体架构图 | `docs/01-architecture.md` |
| Storyboard Studio 怎么做 | `docs/02-modules-design.md` § Storyboard |
| 现在做到第几周 | `docs/03-roadmap-and-progress.md` |
| Prisma 某字段啥意思 | `docs/04-data-model.md` |
| 为啥用 Tauri 不用 Electron | `docs/05-tech-decisions.md` ADR-05 |
| 怎么在家电脑跑起来 | `docs/HOME-SETUP.md` |
| 怎么加新主题 | `docs/THEMING.md` |
| 今天开工有啥要接续 | `PROGRESS.md`（根） |
| 今天该做啥 | `TODO.md`（根） |

实在找不到 → 在 claude.ai Chat 直接问，它能搜整个 Project 知识库。
