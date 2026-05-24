# 在家 Mac Studio 接续开发 · macOS 完整流程

> 适用：① 首次在新 Mac 拉取 SS 项目 ② 每日开工前的环境准备
>
> 💻 **其他设备文档**:
> - Windows 笔记本(出差 / 备机)→ [SETUP-WINDOWS.md](SETUP-WINDOWS.md)
> - 跨设备协作规则 + 设备登记表 → [../CLAUDE.md](../CLAUDE.md)
>
> ⚡ **跨平台脚本**(macOS / Win 共用):
> - `pnpm setup:env` — 自动生成 .env.local + 密钥(替代 BSD `sed` 命令)
> - `pnpm preflight` — 30 秒环境自检

---

## ⚡ TL;DR — 30 秒版本

### 首次（一次性，约 15-25 分钟）

```bash
# 装好 Node.js + Docker Desktop（详见下方第一步）

cd ~/Project   # 或你喜欢的位置
git clone https://github.com/henrywei2030/SS.git starsalign-studio
cd starsalign-studio

# 跨平台一键: 复制 .env.example + 生成 JWT/APP key
node scripts/init-env.mjs

corepack enable
pnpm infra:up
corepack pnpm install
corepack pnpm db:generate
corepack pnpm db:migrate     # 输入 migration 名时直接回车跳过
corepack pnpm db:seed
corepack pnpm preflight      # 自检一遍全绿才往下走

# 设 admin 密码
PATH="$PATH:$PWD/packages/db/node_modules/.bin" \
DATABASE_URL=$(grep "^DATABASE_URL=" .env.local | sed 's/^DATABASE_URL=//') \
  tsx scripts/set-admin-password.ts admin@starsalign.local 你的密码
```

### 日常（30 秒）

```bash
cd ~/Project/starsalign-studio
git pull
pnpm infra:up                                  # 如果 Docker 关了
corepack pnpm --filter @ss/web dev             # 启 web 服务
# Code 里说："开工"
```

---

## 📋 首次完整步骤（按顺序）

### 第一步：装开发工具

#### 1️⃣ Node.js 24+
**A. 官方安装包**（最省心）
- 浏览器打开 <https://nodejs.org/zh-cn>
- 下载 **LTS 版（24.x）**
- 双击 `.pkg` 一路下一步

**B. Homebrew**
```bash
brew install node@24
```

验证：
```bash
node -v   # 应输出 v24.x.x
```

#### 2️⃣ 启用 pnpm（Node 24 内置 corepack）
```bash
corepack enable
corepack pnpm -v   # 应输出 9.x.x
```

如果 corepack 报权限错误（macOS 26 可能遇到）：
```bash
sudo npm install -g pnpm
```

#### 3️⃣ Docker Desktop
- 下载 <https://www.docker.com/products/docker-desktop>
- 安装并启动（首次启动会让你输密码授权）
- 等右上角菜单栏鲸鱼图标变绿色

验证：
```bash
docker --version          # Docker version 29.x
docker info | head -5     # 不报错即可
```

### 第二步：拉取代码

```bash
mkdir -p ~/Project
cd ~/Project
git clone https://github.com/henrywei2030/SS.git starsalign-studio
cd starsalign-studio
```

如果你之前在 GitHub 配过 SSH key，clone 可能用 `git@github.com:henrywei2030/SS.git` 更快。

### 第三步：本地 `.env.local`

**跨平台一键脚本**(macOS / Linux / Windows 通用):
```bash
node scripts/init-env.mjs
# 或装完依赖后:
# pnpm setup:env
```

脚本自动完成:
1. 从 `.env.example` 复制一份 `.env.local`(若不存在)
2. 用 Node 的 `crypto.randomBytes` 生成 `JWT_SECRET` + `APP_MASTER_KEY`(各 64 字符 hex)
3. 已有有效值的密钥**不会覆盖**(幂等)

验证（应输出各 64 字符）：
```bash
grep -E "^(JWT_SECRET|APP_MASTER_KEY)=" .env.local | sed 's/=.*/=...(64 chars)/'
```

**这两个密钥跟其他设备不一样没事** —— 各设备各跑各的本地数据库,见 [CLAUDE.md → 跨设备数据矩阵](../CLAUDE.md)。

### 第四步：启动本地基础设施

```bash
pnpm infra:up
```

会启动 3 个容器：
- `ss-postgres` :5432
- `ss-redis` :6379
- `ss-minio` :9000 + :9001

等 30 秒，所有容器变 `healthy`。

**如果端口被占用**：
```bash
lsof -ti :5432 -ti :6379 -ti :9000 | xargs -r kill -9
pnpm infra:up
```

### 第五步：装依赖 + 初始化数据库

```bash
corepack pnpm install
# 2-3 分钟，下载 540+ 依赖
```

```bash
corepack pnpm db:generate    # 生成 Prisma Client
corepack pnpm db:migrate     # 应用所有 migration
# 提示输入 migration 名时直接回车跳过即可（已有 migration 不会重跑）
corepack pnpm db:seed        # 灌入风格 / Provider / Prompt / admin
```

### 第六步：设置 admin 密码

```bash
PATH="$PATH:$PWD/packages/db/node_modules/.bin" \
DATABASE_URL=$(grep "^DATABASE_URL=" .env.local | sed 's/^DATABASE_URL=//') \
  tsx scripts/set-admin-password.ts admin@starsalign.local 你的密码
```

### 第七步：跑起来！

```bash
corepack pnpm --filter @ss/web dev
```

浏览器打开 <http://localhost:3000>
→ 自动跳到 `/zh-CN/login`
→ 用 `admin@starsalign.local` / 你刚设的密码登录

🎉 看到 Mission Control 即成功。

### 第八步：API Key 暂不录入(等系统构建完成)

Phase 1 阶段 Provider API Key **暂不需要**在每台设备录入。理由:
- 业务链路全部 Mock 跑通(MockImageProvider / 占位符 storageKey)
- 后台 `/admin/providers` 还在迭代,等系统构建完成(W7+)再统一录入一次

到时候按 [CLAUDE.md → 跨设备数据矩阵](../CLAUDE.md) 提示,每台设备登入后台填一次即可。

---

## 🌅 每天的"开工"流程(首次完成后)

**推荐(一键启动)** — 2026-05-25 后引入:

```bash
cd ~/Project/starsalign-studio
git pull                                       # 拉最新代码 + TODO/PROGRESS
pnpm start                                     # 一键:preflight + docker + migration + turbo dev + 自动开浏览器
```

`pnpm start` 自动跑完 7 步,Ctrl+C 优雅停 turbo dev。详见 [CLAUDE.md 设备登记](../CLAUDE.md#设备登记)。

可选 flag:`--skip-preflight` / `--skip-infra`(docker 已起)/ `--no-open`(不开浏览器)/ `--auto-migrate`(自动跑未应用 migration)。

**旧分步模式**(仍可用,排查问题时):

```bash
git pull
pnpm preflight                                 # 环境自检
pnpm infra:up                                  # 起 Docker
pnpm dev                                       # turbo 并行 web + worker
# 浏览器手动开 http://localhost:3000/zh-CN
```

然后在 Code 终端里:

> **开工**

我会自动:
- 读 PROGRESS.md 最新条目 → 找到"下次接着做"
- 读 TODO.md → 识别进行中
- 跑 `git status` + `git log -5`
- 给你 ≤150 字简报

---

## 🧐 跨设备状态对照表

| 类型 | 共享 / 独立 | 怎么同步 |
|---|---|---|
| **源代码** | ✅ 共享 | `git pull` / `push` |
| **TODO/PROGRESS** | ✅ 共享 | 同上 |
| **设计文档** | ✅ 共享 | 同上 |
| **Claude Project 知识库** | ✅ 共享 | claude.ai 云端 |
| **`.env.local` 密钥** | ❌ 独立 | 各机器自己生成 |
| **PostgreSQL 数据** | ❌ 独立 | 各跑本地 Docker |
| **API Key 加密值** | ❌ 独立 | 各机器后台单独填 |
| **admin 密码** | ❌ 独立 | 各自 set-admin-password |
| **生成的视频/图片** | ❌ 独立 | 各自 MinIO |

⚠️ **千万别**把 `.env.local` push 到 git！`.gitignore` 已挡，但要警惕。

---

## 🆘 常见问题速查

| 报错关键词 | 原因 | 修法 |
|---|---|---|
| `git pull` 冲突 | 两台机器都改了同文件 | `git status` 看冲突，手动解 |
| `command not found: pnpm` | corepack 没启用 | `corepack enable` |
| `Cannot connect to Docker daemon` | Docker Desktop 没启动 | 启动 Docker Desktop 应用 |
| `port 5432 already in use` | 旧 Postgres 占着 | `lsof -ti :5432 \| xargs kill -9` |
| `Error: ENOENT .env.local` | 没复制 env 模板 | `cp .env.example .env.local` |
| `Invalid credentials`（登录） | admin 密码没设 | 跑第六步的 set-admin-password |
| `APP_MASTER_KEY not set` | 没生成主密钥 | 用第三步的 openssl 命令补 |
| typecheck 报错 | 依赖过期 | `corepack pnpm install && pnpm db:generate` |
| 数据库说没有表 | schema 漂移 | `corepack pnpm db:reset && db:seed`（清空，慎用） |

---

## 🌙 在家收工流程

跟在公司一样，在 Code 终端里：

> **收工**

我会自动：
1. 问你今天完成了什么 / 遇到啥 / 下次做啥
2. 更新 TODO.md + PROGRESS.md
3. `git diff --stat` 让你 review
4. 生成中文 commit message
5. **等你确认**后 `git add + commit + push`
6. 提醒你重传 TODO/PROGRESS 到 claude.ai SS Project 知识库

---

## 📞 实在搞不定？

把报错原文截图发到 Claude Chat（claude.ai SS Project），它能看到完整项目背景帮你定位。

或者明早回公司，在 Code 这边帮你远程诊断。
