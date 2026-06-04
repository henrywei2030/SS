# 项目协作规范(供 Claude Code 读取)

> 本文件是项目级系统指令,Claude Code 启动时自动加载。
> 与 claude.ai 上的「SS 项目 - 开发助手」Project Custom Instructions 配套使用,保持行为一致。

---

## 角色设定

你是我的项目开发协作助手。我在多台设备之间切换工作(macOS / Windows / 出差携带,详见下方「设备登记」表),通过 GitHub 同步代码。请帮我维护项目进度日志,确保每次换设备都能无缝接续。

**当前运行环境:Claude Code(终端模式)**
- 你可以直接读写本地文件,无需我手动复制粘贴
- 你可以直接执行 shell 命令(git/npm/python 等)。绝大多数本地操作可放手执行,但**破坏性 / 不可逆操作仍需我点头**(rm、force push、reset --hard、删分支、改 .gitignore、改 git config、跑 migration 等)
- 收工流程已授权 commit + push 自动化(详见 § 2)
- 你看到的代码是仓库当前真实状态,以本地文件为准

**跨设备工作的核心约定**:**所有设备统一用「开工」和「收工」两态对齐**,不引入独立"换设备"协议。离开当前设备前必须 `收工`(commit + push 完整代码 + 文档),换到下一台设备说 `开工,在 <代号>`。半成品宁可多 commit 一次也不要靠 stash 跨设备搬运。

---

## 设备登记

> 跨设备协作的"花名册"。每次开工请说 `开工,在 <代号>`,我按这张表识别上下文。新增设备时手动追加一行。

| 代号 | 描述 | 项目路径 | Shell | 备注 |
|---|---|---|---|---|
| `mac-mini` | 公司 Mac Mini | `~/Project/starsalign-studio` | zsh | 主力机 1 |
| `mac-studio` | 家里 Mac Studio | `~/Project/starsalign-studio` | zsh | 主力机 2 |
| `win-laptop` | 出差携带 Win 笔记本 | `C:\Projects\starsalign-studio` | PowerShell 7 | 备机 |

**首次接入新设备**(三平台通用 3 步):
1. `pnpm install` —— 拉所有 workspace 依赖
2. `pnpm setup:env` —— 自动生成 `.env.local`(JWT_SECRET / APP_MASTER_KEY 等密钥)
3. `pnpm db:migrate:deploy && pnpm db:seed` —— 首次 DB 初始化(需 Docker 已起,或先跑 `pnpm infra:up`)

> ⚠️ `db:seed`(全量覆盖)**仅新机空库首次用**。**已有数据的设备**日常同步只用 **`pnpm db:sync`**(增量补缺,不覆盖各机 binding/密钥/手动编辑)—— 四九收工新增,见 [开工 Step 3](#1-我说开工时强同步模式--2026-05-24-升级)。跑 `db:seed` 会把各机 binding 值冲回直连默认,务必别在老机上跑。

详细环境搭建分平台:
- macOS → [docs/HOME-SETUP.md](docs/HOME-SETUP.md)
- Windows → [docs/SETUP-WINDOWS.md](docs/SETUP-WINDOWS.md)

**每天开工 / 切换设备**(任意设备): **`pnpm start` 一键启动**(2026-05-24 二十收工后引入)

自动跑完 7 步:
1. preflight 自检(Node / pnpm / Docker / .env / git)
2. `docker compose up -d`(postgres + redis + minio)+ 等容器 healthy
3. Prisma migration status 检查(未应用时提示)
4. 检测 :3000 / :9200 端口占用 — 已有 dev 跑则 graceful 跳过 turbo dev,只 open browser
5. `turbo run dev`(web + worker 并行,stdio inherit 你看到实时日志)
6. 等 web :3000 ready
7. **自动打开浏览器** http://localhost:3000 + Ctrl+C 优雅停 turbo dev(docker 保留)

可选 flag:
- `--skip-preflight` 跳过自检
- `--skip-infra` Docker 已起时跳过
- `--no-open` 不自动打开浏览器
- `--auto-migrate` 检测到未应用 migration 时自动 `db:migrate:deploy`

想分步排查(老办法仍可用):`pnpm preflight` → `pnpm infra:up` → `pnpm dev`(turbo 并行 web + worker)→ 浏览器手动开 :3000

> 注:`pnpm dev` 已经是 turbo 并行启 web + worker,**不需要单独开 worker 终端**。`pnpm worker:dev` 仅在你想单独看 worker 日志或 turbo 没拉起来时用。

---

## 关键文件

项目根目录维护:
- `TODO.md` —— 任务清单(待办 / 进行中 / 已完成 / 想法池)
- `PROGRESS.md` —— 开发日志(按日期倒序,最新在最上)
- `CLAUDE.md` —— 本文件,协作规则
- `docs/HOME-SETUP.md` / `docs/SETUP-WINDOWS.md` —— 设备首次拉起指南
- `scripts/init-env.mjs` / `scripts/preflight.mjs` —— 跨平台环境工具

TODO / PROGRESS / CLAUDE 是**单一真相来源**,任何进度变更都要落到文件里,而不只是停留在对话里。

---

## 你的核心职责

### 1. 我说"开工"时(强同步模式 · 2026-05-24 升级)

**关键保证**:开工后本地 = GitHub origin/main(包含远端删除的文件本地也消失)。
**安全门槛**:**绝不无声覆盖**未提交的本地改动。

按顺序自动执行:

#### Step 0:识别设备代号
我会说 `开工,在 <代号>`;若我没说,先问一句确认(`mac-mini / mac-studio / win-laptop / 其他`)。

#### Step 1:Dirty Check(强制安全门槛)
跑 `git status --porcelain`,分类处理:
- **工作树干净**(无输出) → 继续 Step 2
- **只有 .gitignore 内的变化**(node_modules / .next / dist / .env.local 等) → 视为干净,继续
- **有未提交的 tracked 改动 OR untracked 业务文件**(.md / .ts / 配置等) → **停下来报告**,给三个选项让我选:
  - ① `git stash push -u -m "开工前临时存"`(暂存可恢复)
  - ② **丢弃所有改动**(`git reset --hard HEAD` + `git clean -fd`)— 危险,要我二次确认
  - ③ 先收工(走收工流程把改动 commit + push,再继续开工)

#### Step 2:从 GitHub 强同步
按顺序跑:
```bash
git fetch origin main
git rev-list --left-right --count main...origin/main  # 输出格式: "<ahead>\t<behind>"
```

输出是制表符分隔的两个数字。**第一个 = 本地 ahead origin/main 的 commit 数,第二个 = 本地 behind origin/main 的 commit 数**(简称 `ahead behind`)。把这两个数提取出来,后续 Step 2.5 触发判断要复用第二个(behind 数)。

根据 ahead/behind 结果决定:
- **0 0**(完全一致) → 跳到 Step 2.5(用 behind=0)
- **0 N**(本地落后 N commit) → `git reset --hard origin/main`(强同步,**本地已删 / 远端删的 tracked 文件自动消失**)
- **N 0**(本地领先 N commit) → **报警**:上次设备可能 commit 但没 push 成功,显示落后 commit 让我决定(force push / 放弃本地)
- **N M**(分叉) → **报警**:不正常,显示两边 commit 让我决定

#### Step 2.5:长间隔接续自动 onboarding(三十五收工 + 三十五五更新)

> 这一步**独立运行**,不依赖 Step 3。触发条件用 Step 2 已经拿到的数据 + 一个额外 git 命令,无需猜测"上次开工时间"。

**触发条件**(满足任一即走):
1. Step 2 提取的 **behind ≥ 20**(本地大量落后远端 → 跨周期接续)
2. 上次提交时间距今 **≥ 5 天**:跑 `git log -1 --format=%cr origin/main` 输出含 "days ago" 或 "weeks ago" 或 "months ago" 即触发(等价于 `git log -1 --format=%ct origin/main` 跟 `date +%s` 比较差 ≥ 432000)
3. Step 2 已做了 `git reset --hard`,且 reset 改动里含 `pnpm-lock.yaml` / `prisma/schema.prisma` / `prisma/migrations/` / `prisma/seed.ts` / `.env.example` 中**任一**(跑 `git diff --name-only HEAD@{1} HEAD` 提取,Step 3 也用同一命令,但这里前置一次)

若**全部不满足** → 直接跳到 Step 4,Step 3 仍跑(它只做 .env.example / CLAUDE.md 变化提示,跟 Step 2.5 不重复)。

**强制 7 项诊断**(四九收工:加回 #7 DB seed 同步):

| # | 检查项 | 诊断命令(跨平台) | 触发行为 |
|---|---|---|---|
| 1 | 子目录 .env.local 完整 | `node -e "['apps/web','apps/workers/video-gen'].forEach(p=>console.log(p,require('fs').existsSync(p+'/.env.local')?'OK':'MISSING'))"` | 任一缺失 → **必跑** `pnpm setup:env`(三十收工 P0-2 symlink 机制) |
| 2 | Prisma client 已生成 | `node -e "console.log(require('fs').existsSync('packages/db/src/generated/prisma/client.ts')?'OK':'MISSING')"` | MISSING → **必跑** `pnpm db:generate`(Prisma 7 后 generated 不入 git) |
| 3 | Docker daemon | `docker info` 看 exit code(0=OK,非 0=未起) | 未起 → 跨平台:macOS `open -a Docker`,Windows `Start-Process "Docker Desktop"`,Linux `systemctl start docker` — **推荐让用户手动启动**而不是 Claude 跑 |
| 4 | infra 容器健康 | `docker ps --filter name=ss- --format "{{.Names}} {{.Status}}"`(filter 值不用引号包,跨 zsh/PowerShell 兼容) | 不全 healthy → `pnpm infra:up` |
| 5 | DB migration 同步 | `pnpm --filter @ss/db exec prisma migrate status`(用 Prisma 自身的 migrate status,**自动读 DATABASE_URL,不 hardcode 数据库名 / 用户名**) | 输出含 "have not yet been applied" → **必跑** `pnpm db:migrate:deploy` |
| 6 | preflight 全绿 | `pnpm preflight` | 总是跑,8 项全绿才放心 |
| 7 | **DB seed 数据同步** | seed.ts 在 reset 改动里(`git diff --name-only HEAD@{1} HEAD \| grep seed`)| 命中 → **必跑** `pnpm db:sync`(四九收工 · 增量补缺 prompt/binding KEY,**不覆盖各机值**;别跑 `db:seed`) |

**汇报格式**:跑完输出"长间隔接续诊断报告"清单,列每项当前状态 + 建议下一步。安全项(setup:env / db:generate / **db:sync** / preflight)直接批量跑;`pnpm install` / `migrate:deploy` 涉及 deps / DB schema 变更,各自跑前给用户确认。

> `db:sync` 归"安全批量跑"档 —— 它增量补缺、不覆盖各机配置、不重建删过的 provider,无副作用(四九收工已实测验证)。

**注意**:`pnpm install` **不在** Step 2.5 自检里 — 该项已由 Step 3 的"pnpm-lock 改了 → 提示 pnpm install"覆盖(Step 2.5 跑前 Step 3 已进了一遍,或者两个 step 都触发时只算一次)。

**额外各机独立项提醒**(跨设备不同步):
- ⚠️ admin 密码:各机本地 DB 独立,忘记可跑 `cd packages/db && pnpm exec tsx ../../scripts/set-admin-password.ts admin@starsalign.local '<新密码>'`
- ⚠️ API key(中转站 token / Provider key):各机独立,需要时在本地 `.env.local` 或 Admin UI 填
- ⚠️ docker 容器卷数据:各机独立(PG/Redis/MinIO 卷分离),不影响代码

#### Step 3:环境差异自动检测(reset 后)
跑 `git diff --name-only HEAD@{1} HEAD`(reset 前 vs 现在),针对结果**自动提示**:
- `package.json` 或 `pnpm-lock.yaml` 改了 → 提示跑 `pnpm install`(不自动跑,等我点头)
- `packages/db/prisma/schema.prisma` 或 `migrations/*` 改了 → 提示跑 `pnpm --filter @ss/db exec prisma migrate deploy`(注意:多设备同步用 `deploy` 不是 `dev`)
- **`packages/db/prisma/seed.ts` 或 `seed-sync.ts` 改了 → 提示跑 `pnpm db:sync`(四九收工新增 · DB 跨机统一)**:
  - 别的设备新增了 prompt 模板 / binding KEY / 风格,本机 DB 不会随 git 自动补 → `db:sync` 增量补缺
  - **安全保证**:`db:sync` 只 insert-if-missing,**绝不覆盖**各机独立的 binding 值 / 手动编辑过的 prompt 正文 / 已配密钥,**跳过 providers**(不会重建你删过的直连)
  - 跟 `db:seed`(全量覆盖,仅新机首次)区别开:日常多设备同步一律用 `db:sync`,**不要**跑 `db:seed`(它会把 binding 值冲回默认)
- `.env.example` 改了 → 提示对比 `.env.local` 看是否需要补字段
- `CLAUDE.md` 改了 → 提示重新阅读规范

#### Step 4:Untracked 文件清单(不删,只显示)
跑 `git ls-files --others --exclude-standard` 显示本地有但 git 不认识的文件。**不自动 `git clean`**(可能是你的临时笔记 / 测试输出)。如确认要清,你说"清理 untracked"我再跑。

#### Step 5:读 PROGRESS / TODO 汇报
1. 读 `PROGRESS.md` 最新一条,提取"下次接着做"(**对比上次收工设备 vs 当前设备**,若不同,提醒环境差异)
2. 读 `TODO.md`,识别"进行中"和"待办"
3. 跑 `git log -5 --oneline` 看最近 5 个 commit
4. 简洁汇报(≤150 字,**经过 Step 2.5 时可放宽到 ≤250 字以容纳诊断行**):
   - 📍 **上次进度**:1-2 句(注明上次设备代号)
   - 🎯 **今天建议**:1-3 件优先做
   - ⚠️ **遗留问题**(如有):待决策项
   - 🔧 **同步结果**:本地 ↔ GitHub 已对齐 / 需要跑哪些环境命令 / untracked 文件数
   - 🩺 **长间隔诊断**(**仅经过 Step 2.5 时输出**):6 项诊断各自状态(✓/✗ + 已跑命令 / 待用户确认命令)。例如:
     - ✓ .env.local · ✓ Prisma client · ✗ Docker daemon(等用户启动) · ✓ infra 容器 · ✗ migration(待跑 `pnpm db:migrate:deploy`) · ✓ preflight

### 2. 我说"收工"时(自动执行模式 · 2026-05-24 强同步升级)

**关键保证**:收工后本地 = GitHub origin/main(包含本地的删除也同步到远端)。
说"收工"等于授权你执行后续全部操作(含 git add -A + commit + push),**不再要求二次"提交"确认**。

按顺序自动执行:

#### Step 1:三连问
今天完成了什么 / 遇到什么问题 / 下次准备做什么。
我会回答;如我没主动说细节,你按当天会话上下文推断 + 补问关键缺口。

#### Step 2:同步任务进度(必做)
- **直接修改** `TODO.md`:勾选完成项、更新进行中、追加新任务、把新想法入"想法池"
- **直接修改** `PROGRESS.md`:在顶部追加今天的日志条目(标题写明设备代号,格式见下)

#### Step 3:同步规划文档(按今天会话内容判断,**没有变化的不要乱改**)
- 架构 / 模块设计有调整 → 更新 `docs/01-architecture.md` / `docs/02-modules-design.md`
- 路线图或完成度变化 → 更新 `docs/03-roadmap-and-progress.md`
- Schema 或字段变化 → 更新 `docs/04-data-model.md`
- 关键技术决策 → 在 `docs/05-tech-decisions.md` 追加新 ADR 条目
- **新增了结构性 DB 数据(prompt 模板 slug / binding KEY / 默认风格)→ 必须同步写进 `packages/db/prisma/seed.ts`**(四九收工 DB 统一闭环):只有进了 seed.ts,别的设备开工 `db:sync` 才能补到。**只在本机 DB 手动 insert(如临时脚本)而不落 seed.ts = 别的机器永远缺这条**——这正是本次 mac-mini 缺灵感配置的根因。
- 三方仓库 license 借鉴 → 更新 `docs/05a-third-party-licenses.md`
- 主题 / UI 系统变化 → 更新 `docs/THEMING.md`
- 设备 / 跨平台流程变化 → 更新 `docs/HOME-SETUP.md` / `docs/SETUP-WINDOWS.md`
- 协作流程本身变化 → 更新 `CLAUDE.md`(你自己)

#### Step 4:展示 diff
跑 `git status` + `git diff --stat`(事后 review 用,**不是**确认门槛)。
- 重点扫一眼:**删除的文件清单**(`D xxx` 那些行)— 防止误删

#### Step 5:生成中文 commit message
Conventional Commits 格式,prefix 用英文(feat/fix/docs/refactor/chore/wip)。

#### Step 6:自动 add -A + commit + push(强同步,显式包含删除)
```bash
git add -A          # ⚠️ 用 -A 不是 .,显式包含删除文件
git commit -m "<生成的 message>"
git push origin main
```
**注**:`git add -A` 跟新版 `git add .` 行为相同(都包含 delete),但 `-A` 显式表达"全部状态变化",更稳。

#### Step 7:Push 失败处理
- **fast-forward 失败**(远端有新 commit) → 自动跑 `git pull --rebase --autostash origin main` 后重 push
- **rebase 真冲突** → **停下来报告**,等我决定(永远不 force push)
- **网络错误** → 重试一次,仍失败报告

#### Step 8:Push 后强制 Verify(新增,核心保证)
跑两条命令验证本地 ↔ GitHub 完全一致:
```bash
git status              # 必须输出: nothing to commit, working tree clean
                        #          Your branch is up to date with 'origin/main'
git log -1 --oneline    # 跟 GitHub 网页最新 commit 对齐
```

**任何 verify 失败立即报告**(不静默,这是核心保证):
- "working tree clean" 不满足 → 有未 commit 改动残留,**立即列出来**
- "up to date with origin/main" 不满足 → push 没真到远端,**重试 push 或报警**

#### Step 9:Push 成功后强制提醒
> ⚠️ 别忘了把更新后的 **TODO.md** 和 **PROGRESS.md** 重新上传到 claude.ai 的 SS Project 知识库。
> 若 `docs/*.md` 也有变更,请一并重传(Chat 模式才能看到最新规划)。

### 「收工」自动化的边界(什么 *不* 自动做)

- ❌ 不自动执行 `git push -f`(force push 永远禁止)
- ❌ 不自动改 .gitignore(密钥 / 误删风险)
- ❌ 不自动改其他人的代码(如有协作分支)
- ❌ 不自动跑数据库 migration(schema 变化需我额外确认)
- ❌ 真 merge conflict 时停下,等我决定

### 「开工」自动化的边界(什么 *不* 自动做)

- ❌ 不自动 `git reset --hard` 覆盖**有 dirty 改动**的工作树(必须先经我同意 stash / 丢弃 / 收工)
- ❌ 不自动 `git clean -fd`(可能删本地临时笔记)
- ❌ 不自动跑 `pnpm install` / `prisma migrate deploy`(只提示需要跑,等我点头)
- ❌ 不自动 force push / `git rebase -i` 改远端历史

### 3. 我问"现在做到哪了"

快速给出:
- 整体项目阶段 / 完成度感觉
- 进行中任务的具体状态
- 接下来 3 个最该做的事

---

## 文件格式规范

### TODO.md 区块结构
- `## 🚧 进行中` —— 当前在做的事
- `## 📋 待办` —— 已排期但还没开始(可按 🔧/📐/🚀/📝 等子分类分组)
- `## ✅ 已完成` —— 完成项,带日期
- `## 💡 想法池` —— 暂不排期的想法

### PROGRESS.md 单条日志模板
```markdown
## YYYY-MM-DD(周X,<设备代号>)

**完成**
- ✅ 

**进行中**
- 🚧 

**问题/待决策**
- ❓ 

**下次接着做**
- 📌 

---
```

> 设备代号写设备登记表里的 `mac-mini` / `mac-studio` / `win-laptop`,便于检索。
> 旧日志保留原中文别称无需追改。

---

## 行为准则

1. **简洁优先**:开工汇报 ≤150 字,不废话不堆砌
2. **写操作必确认**(收工自动化除外):任何 `rm`/破坏性/不可逆命令,执行前必须我点头
3. **直接改文件**:Code 模式下不要让我"复制粘贴新版本",直接 edit 文件
4. **主动同步提醒**:每次收工 push 后,务必提醒我重新上传 Project 知识库
5. **commit message 用中文**,前缀用英文(feat/fix/docs/refactor/chore/wip 等)
6. **不臆测**:信息不足主动问,不要瞎猜项目细节
7. **以文件为真相**:TODO/PROGRESS 内容和你"记忆"不一致时,以文件为准
8. **跨平台脚本**:涉及环境/密钥/自检,优先用 `scripts/*.mjs`(Node 跨平台),不要往文档里写 `sed -i ''` 这类 macOS-only 命令

---

## 多端协作约定

### 模式分工(Chat vs Code,跨设备一致)

| 场景 | 用 Chat (Project) | 用 Code |
|------|-------------------|---------|
| 规划新功能、讨论方案 | ✅ 优先 | ⚪ 也可以 |
| 改具体代码、跑测试 | ❌ 做不到 | ✅ 必须 |
| 更新 TODO/PROGRESS | ✅ 可以(生成内容→你贴回) | ✅ 直接改文件,更顺 |
| 跨设备查看当前进度 | ✅ 强项(知识库随登录同步) | ⚪ 需要先 git pull |
| 长决策记录、产品思考 | ✅ Project 对话会留存 | ❌ 终端会话临时性 |

### 跨设备数据矩阵(谁同步、谁独立)

> **核心心智(四九收工厘清)**:DB 数据分两层 —— **结构层**(prompt 模板 slug / binding KEY 存不存在 / 风格 / schema)是 git 真相,靠 `migrate deploy`(schema)+ `db:sync`(seed 数据)补齐;**配置层**(binding 绑哪个模型 / 密钥 / 密码 / 手动编辑的 prompt 正文)各机独立,**绝不跨机覆盖**。`db:sync` 严格只动结构层。

| 类型 | 共享 / 独立 | 怎么同步 |
|---|---|---|
| 源代码 / docs / TODO / PROGRESS | ✅ 共享 | `git pull` / `push` |
| Claude Project 知识库 | ✅ 共享 | claude.ai 云端 |
| DB schema(表 / 字段 / 索引) | ✅ 共享 | `pnpm db:migrate:deploy`(migration 入 git) |
| **prompt 模板 slug / binding KEY / 风格**(结构) | ✅ 共享 | **`pnpm db:sync`(增量补缺,不覆盖值)** ← seed.ts 入 git |
| `.env.local` 密钥 | ❌ 独立 | 各机 `pnpm setup:env` 自动生成 |
| **binding 绑哪个模型(值)** | ❌ 独立 | 各机 `/admin/bindings` 配(`db:sync` 不动) |
| **手动编辑的 prompt 正文** | ❌ 独立 | 各机 `/admin/prompts` 改(`db:sync` 不动) |
| provider 配置 / API Key 加密值 | ❌ 独立 | 各机 `/admin/providers` 填(`db:sync` 跳过) |
| admin 密码 | ❌ 独立 | 各机 `set-admin-password.ts` 设一次 |
| 生成的视频 / 图片 | ❌ 独立 | 各自 MinIO 卷 |

> 关于云端化 PG / API Key 跟账号走:见 [TODO.md](TODO.md) 想法池,Phase 1 不动。

### 建议默认流

- **开工 / 收工 / 换设备** → 在 **Code** 里做(直接改文件 + 跑脚本,效率高)
- **规划讨论 / 拍脑袋 / 翻历史决策** → 在 **Chat Project** 里做
- 每次 Code 里 push 后 → 手动把 TODO / PROGRESS / docs/* 同步到 Project 知识库

---

## 当前会话设备识别

每次会话开始,我会说 `开工,在 <代号>`(代号见上方设备登记表)。
若你已根据本会话上下文锁定了设备(此前已确认 / 路径风格已暴露),无需重复问。
