# Windows 笔记本接续开发 · 完整流程

> 适用场景:出差携带的 Win 笔记本(主要工作机仍是公司 Mac Mini / 家里 Mac Studio)
> 推荐路径:**PowerShell 7 + Docker Desktop 原生**(跟 Mac 体验最一致,无 WSL2)
> WSL2 路径见文末附录

---

## ⚡ TL;DR — 离家前 / 离公司前的最后一步

**离开主力机时,务必先 `收工`** —— 这样 Win 笔记本一开机 `git pull` 就能看到最新进度。

```bash
# 在 Mac 这边
> 收工
```

---

## 📋 Win 首次环境准备(一次性,约 30-45 分钟)

### 第 1 步 · 装 PowerShell 7

Win 10/11 自带的 Windows PowerShell 5.1 太老,**改用 PowerShell 7**(微软官方现行版本)。

**A. 微软商店**(最省心)
- 打开 Microsoft Store,搜 `PowerShell` 安装

**B. winget**
```powershell
winget install --id Microsoft.PowerShell -e
```

装好后:**右键开始菜单 → 终端(管理员) → 顶部下拉默认配置文件改 `PowerShell`**(不是 Windows PowerShell)。

验证:
```powershell
$PSVersionTable.PSVersion   # Major 应为 7+
```

### 第 2 步 · 装 Git for Windows

下载 <https://git-scm.com/download/win> → 一路 Next,**勾选**:
- ✅ `Git from the command line and also from 3rd-party software`(默认)
- ✅ `Use bundled OpenSSH`
- ✅ `Checkout as-is, commit Unix-style line endings`(避免 CRLF 噪声)
- ✅ `Enable symbolic links`

验证:
```powershell
git --version
ssh -V          # 用 OpenSSH 连 GitHub
```

### 第 3 步 · 装 Node.js 24

下载 <https://nodejs.org/zh-cn> LTS 安装包 → 双击 Next。**勾选** `Automatically install the necessary tools`(顺带装 Python + VS Build Tools,某些 native 依赖需要)。

验证:
```powershell
node -v        # v24.x
```

启用 pnpm(Node 24 内置 corepack):
```powershell
corepack enable
corepack pnpm -v        # 9.x
```

如果 `corepack` 报权限错:
```powershell
# 以管理员身份打开 PowerShell 7 重试,或直接全局装
npm install -g pnpm@9
```

### 第 4 步 · 装 Docker Desktop

下载 <https://www.docker.com/products/docker-desktop> Windows 版 → 安装时:
- ✅ 勾选 `Use WSL 2 instead of Hyper-V`(即使你不直接用 WSL,Docker Desktop 也走 WSL2 后端,性能最好)
- ✅ 安装完重启电脑

启动 Docker Desktop,等右下角任务栏鲸鱼图标变绿色。

验证:
```powershell
docker --version       # Docker version 29.x
docker info            # 不报 Cannot connect to Docker daemon
```

如果第一次启动卡在 `WSL 2 installation is incomplete`,跑:
```powershell
wsl --install --no-distribution
# 重启电脑后再开 Docker Desktop
```

### 第 5 步 · 拉取代码

**建议路径:`C:\Projects\` 而不是 `C:\Users\xxx\OneDrive\...`** —— OneDrive 会实时同步 `node_modules`,导致编译极慢 + 同步流量爆表。

```powershell
mkdir C:\Projects
cd C:\Projects
git clone https://github.com/henrywei2030/SS.git starsalign-studio
cd starsalign-studio
```

> 如果你在 GitHub 配过 SSH key,改用 `git@github.com:henrywei2030/SS.git` 更快。
> 没配过的话先去 <https://github.com/settings/keys> 配一个,或用 HTTPS + PAT。

### 第 6 步 · 生成 `.env.local` 与密钥

**用跨平台脚本一键生成**(替代 macOS 的 `sed` 命令):
```powershell
node scripts/init-env.mjs
# 或装完依赖后用:
# pnpm setup:env
```

脚本会:
1. 从 `.env.example` 复制一份 `.env.local`(若不存在)
2. 用 Node 自带的 `crypto.randomBytes` 生成 `JWT_SECRET` 和 `APP_MASTER_KEY`(各 64 字符 hex)
3. 已有有效值的密钥**不会覆盖**(安全幂等)
4. **给 `apps/web/.env.local` 和 `apps/workers/video-gen/.env.local` 各建 .env.local**(Windows 默认无 symlink 权限 → 自动退回 copy)
   - ⚠️ **Windows 注意**:用的是 copy 而非 symlink,改 root `.env.local` 后请**重跑** `pnpm setup:env` 同步到子目录(或开 dev 模式获取 symlink 权限)

验证:
```powershell
Select-String -Path .env.local -Pattern '^(JWT_SECRET|APP_MASTER_KEY)='
# 应输出两行 KEY=...64个十六进制字符...
```

> **这两个密钥不需要跟其他设备一致** —— 每台机器各自的本地数据库各跑各的。

### 第 7 步 · 启动 Docker 服务

```powershell
pnpm infra:up
```

启动 3 个容器:`ss-postgres` `ss-redis` `ss-minio`。等 30 秒,确认全部 `healthy`:
```powershell
docker compose -f infra/docker-compose.yml ps
```

**如果端口被占用**(Win 防火墙 / VPN / 其他服务):
```powershell
# 查谁占了 5432
Get-NetTCPConnection -LocalPort 5432 -ErrorAction SilentlyContinue
# 找到 PID 后:
Stop-Process -Id <PID> -Force
```

### 第 8 步 · 装依赖 + 初始化数据库

```powershell
corepack pnpm install
# 3-5 分钟,540+ 依赖
```

```powershell
corepack pnpm db:generate
corepack pnpm db:migrate     # 提示输入 migration 名时直接回车
corepack pnpm db:seed
```

### 第 9 步 · 设 admin 密码

PowerShell 版本(与 macOS 的 `sed` 命令不同):
```powershell
$env:DATABASE_URL = (Select-String -Path .env.local -Pattern '^DATABASE_URL=').Line -replace '^DATABASE_URL=', ''
$env:PATH = "$PWD\packages\db\node_modules\.bin;$env:PATH"
npx tsx scripts/set-admin-password.ts admin@starsalign.local 你的密码
```

或临时一次性脚本(更稳):
```powershell
$dbUrl = (Get-Content .env.local | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', ''
$env:DATABASE_URL = $dbUrl
corepack pnpm tsx scripts/set-admin-password.ts admin@starsalign.local 你的密码
```

### 第 10 步 · 跑起来

```powershell
corepack pnpm --filter @ss/web dev
```

浏览器打开 <http://localhost:3000> → 用 `admin@starsalign.local` + 刚设的密码登录。

🎉 看到 Mission Control 即首次成功。

### 第 11 步 · API Key 暂不录入(等系统构建完成)

Phase 1 阶段 Provider API Key **暂不需要**在每台设备录入,出差期间也无需配。

理由:
- 业务链路全部 Mock 跑通(MockImageProvider / 占位符 storageKey)
- 后台 `/admin/providers` 还在迭代,等系统构建完成(W7+)再统一录入一次
- 出差携带 API Key 反而增加密码管理负担与泄露风险

到时候按 [CLAUDE.md → 跨设备数据矩阵](../CLAUDE.md) 提示,每台设备登入后台填一次即可。

---

## 🌅 出差期间 · 每天的"开工"流程

**推荐(一键启动)** — 2026-05-25 后引入:

```powershell
cd C:\Projects\starsalign-studio
git pull                                  # 拉公司/家里最新代码 + TODO/PROGRESS
pnpm start                                # 一键:preflight + docker + migration + turbo dev + 自动开浏览器
```

`pnpm start` 自动跑完 7 步,Ctrl+C 优雅停 turbo dev。详见 [CLAUDE.md 设备登记](../CLAUDE.md#设备登记)。

可选 flag:`--skip-preflight` / `--skip-infra` / `--no-open` / `--auto-migrate`。

**旧分步模式**(仍可用,排查问题时):

```powershell
git pull
pnpm preflight                            # 30 秒自检
pnpm infra:up                             # 起 Docker
pnpm dev                                  # turbo 并行 web + worker
# 浏览器手动开 http://localhost:3000/zh-CN
```

然后在 Code 终端里:
> **开工,在 win-laptop**

我会照 CLAUDE.md 流程读 PROGRESS.md / TODO.md + 给你 ≤150 字简报。

---

## 🌙 出差期间 · 每天的"收工"流程

跟 Mac 完全一致:
> **收工**

我会自动:
1. 三连问(今天完成 / 问题 / 下次)
2. 更新 TODO.md + PROGRESS.md(日志标注 `win-laptop`)
3. `git add + commit + push origin main`
4. push 失败自动 `git pull --rebase --autostash` 重试
5. 真冲突停下来报告

---

## 📊 跨设备状态对照表

| 类型 | 共享 / 独立 | 怎么同步 |
|---|---|---|
| 源代码 | ✅ 共享 | `git pull` / `push` |
| TODO / PROGRESS / docs | ✅ 共享 | 同上 |
| Claude Project 知识库 | ✅ 共享 | claude.ai 云端,登录即可见 |
| `.env.local` 密钥 | ❌ 独立 | 各机器 `pnpm setup:env` 自动生成 |
| PostgreSQL 数据 | ❌ 独立 | 各跑本地 Docker(空库起步) |
| API Key 加密值 | ❌ 独立 | 各机器后台单独填 |
| admin 密码 | ❌ 独立 | 各自 `set-admin-password.ts` |
| 生成的视频 / 图片 | ❌ 独立 | 各自 MinIO 卷 |

⚠️ **千万别 push `.env.local`** —— `.gitignore` 已挡,但要警惕 IDE 误提交。

---

## 🆘 Win 专属常见问题

| 报错关键词 | 原因 | 修法 |
|---|---|---|
| `corepack: command not found` | Node 装得太老 / 没装 corepack | `npm install -g pnpm@9` 兜底 |
| `Cannot connect to Docker daemon` | Docker Desktop 没启动 / WSL2 未就绪 | 开 Docker Desktop;`wsl --update` |
| `port 5432 already in use` | 本地装过 PostgreSQL | `Get-Process -Name postgres \| Stop-Process` 或停服务 |
| `error EPERM` 装依赖时 | 杀软拦截 / OneDrive 同步 | 项目挪出 OneDrive,**临时**关 Defender 实时保护跑 install |
| `EACCES` / 长路径报错 | Win 路径长度上限 | 启用长路径:`git config --system core.longpaths true` + 注册表 `LongPathsEnabled=1` |
| `node-gyp` 编译失败 | 缺 VS Build Tools | 装 Node 时勾选 `Automatically install necessary tools`,或事后 `npm install --global windows-build-tools` |
| `'pnpm' is not recognized` | corepack 未启用 | `corepack enable` 后开新 PowerShell 窗口 |
| Prisma 生成卡住 | Win Defender 扫描 | 把 `C:\Projects\starsalign-studio` 加 Defender 排除列表 |
| 中文乱码(终端) | PowerShell 默认 GBK | 在 PowerShell 跑 `chcp 65001` 切 UTF-8,或写入 `$PROFILE` |

---

## 🎒 出差携带 Checklist(离家前 24 小时)

- [ ] 主力机已 `收工` + push,Win 笔记本能 `git pull` 到最新
- [ ] 笔记本已跑过一次 `pnpm preflight` 全绿(节省现场调试时间)
- [ ] **GitHub 账户已对齐**(`git config --global user.name / user.email` 跟主力机一致 — 详见下方附录 B)
- [ ] **GitHub PAT 或 SSH key 已在笔记本配好**(`git push` 时不会临时卡身份验证;推荐 `gh auth login` 一键搞定)
- [ ] admin 密码记得(Win 数据库独立,首次登录用 `set-admin-password.ts` 重设即可)
- [ ] Docker Desktop 开机自启已勾上(`Settings → General → Start Docker Desktop when you sign in`)
- [ ] (可选)装 VS Code / Cursor 同步设置(Settings Sync 用 GitHub 账号)

> 📝 API Key 不在 checklist 里 — 见第 11 步说明,Phase 1 不录入。

---

## 🔄 回主力机后 · 把出差成果"合并回家"

回到 Mac 后:
```bash
cd ~/Project/starsalign-studio
git pull        # 拿 Win 笔记本期间 push 的 commit
pnpm preflight  # 确认依赖 / migration 不需要补
# 如果 schema 有变:
pnpm db:migrate
```

然后照常 `开工`。

---

## 附录 A · WSL2 路径(高阶可选)

如果你嫌 PowerShell 命令写起来啰嗦,想直接复用 Mac 的 bash 命令:

```powershell
wsl --install -d Ubuntu
# 重启后,从开始菜单打开 Ubuntu,首次会让你设 Linux 账号密码
```

然后在 WSL 里照 [docs/HOME-SETUP.md](HOME-SETUP.md) 走 Linux/Mac 流程,但有 3 个 gotcha:
1. **项目必须放在 WSL 文件系统内**(`~/Project/...`),**不要**放 `/mnt/c/...`,否则文件 IO 慢 10 倍
2. Docker Desktop 需要在 `Settings → Resources → WSL Integration` 启用 Ubuntu
3. VS Code 用 `code .` 打开会自动用 Remote-WSL 模式(需装 `WSL` 扩展)

跨平台脚本 `pnpm setup:env` / `pnpm preflight` 在 WSL 内也直接用,无差别。

---

## 附录 B · GitHub 账户对齐(首次接入必做)

为保证 commit author 在所有设备上一致(否则 `git log` 会出现身份混乱),Win 笔记本首次拉起完代码后,务必跟主力机用**相同的 user.name / user.email** 设置 git 全局身份。

**步骤 1:固化 git 身份**(PowerShell)
```powershell
# 跟主力机一致 —— 当前项目的 commit author
git config --global user.name "henrywei2030"
git config --global user.email "henrywei1624@gmail.com"

# 验证
git config --global user.name
git config --global user.email
```

> ⚠️ 如果你的主力机 `henrywei2030 / henrywei1624@gmail.com` 已经换过,请用 `git log -1 --format='%an <%ae>'` 在主力机查最新值,Win 上对齐。

**步骤 2:登录 GitHub CLI**(推荐 — 一次性把 PAT 存进 Windows Credential Manager)
```powershell
# 装 gh (一次性)
winget install --id GitHub.cli -e

# 浏览器登录 (按提示选 HTTPS + 用浏览器)
gh auth login

# 验证
gh auth status
```

之后 `git push` 永远不再弹身份验证 — 凭证由 Credential Manager 自动注入。

**步骤 3:测试连通**
```powershell
git pull        # 应能直接拉,不弹任何登录窗
```

## 附录 C · 把笔记本注册到设备表

打开 [CLAUDE.md](../CLAUDE.md) 找到 `## 设备登记`,把 Win 笔记本加进去(若该行已存在则跳过):

```markdown
| win-laptop | 出差用 Win 笔记本 | C:\Projects\starsalign-studio | PowerShell 7 |
```

之后开工时说 `开工,在 win-laptop`,日志会自动标注。
