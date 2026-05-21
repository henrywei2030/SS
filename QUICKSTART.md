# StarsAlign Studio · 星垣工坊 — 快速开始

> 假设：你刚 `git clone` 了仓库，机器已装 Docker + Node 20+ + pnpm 9。

---

## 一、首次环境准备

### 1. 安装 pnpm 与 Node
```bash
# Node 20+
node -v          # 应 >= v20.18.0

# pnpm 9（首次）
npm i -g pnpm@9
pnpm -v          # 应 >= 9.0.0
```

### 2. 装 Tauri 开发依赖（Phase 1 Web 优先可跳过，W7 起需要）
```bash
# macOS
xcode-select --install
brew install rust

# 检查
rustc --version
```

### 3. 配置环境变量
```bash
cp .env.example .env.local
```

`.env.local` 里 **必填** 的只有两项：

| 变量 | 说明 | 生成命令 |
|---|---|---|
| `JWT_SECRET` | 登录 token 签名密钥 | `openssl rand -hex 32` |
| `APP_MASTER_KEY` | 加密数据库里 API Key 的主密钥 | `openssl rand -hex 32` |

可以一次性自动生成并写入：
```bash
sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env.local
sed -i '' "s|^APP_MASTER_KEY=.*|APP_MASTER_KEY=$(openssl rand -hex 32)|" .env.local
```

⚠️ **关于 AI Provider API Key（Seedance / 豆包 / Nano Banana 等）**：
**不要写进 .env.local**！登录后到 `/admin/providers` 后台填，加密存数据库。
.env.local 里的 `SEEDANCE_API_KEY=` 等留空即可。

### 4. 启动本地依赖
```bash
pnpm infra:up
# 期望输出：
#   ✓ Container ss-postgres   Healthy
#   ✓ Container ss-redis      Healthy
#   ✓ Container ss-minio      Healthy
#   ✓ Container ss-minio-init Exited (0)
```

查看：
- Postgres: `localhost:5432`
- Redis: `localhost:6379`
- MinIO API: `localhost:9000`
- MinIO Console: <http://localhost:9001>（账号 `ss_minio_user` / `ss_minio_password`）

### 5. 装依赖 + 初始化数据库
```bash
pnpm install
pnpm db:generate      # 生成 Prisma Client
pnpm db:migrate       # 创建数据库表（首次会生成 migration）
pnpm db:seed          # 灌入默认风格 / Provider / Prompt 模板 / admin
```

---

## 二、日常开发

```bash
# 启动开发（web + workers，按需扩展）
pnpm dev

# 跑测试
pnpm test

# Prisma Studio（可视化看数据）
pnpm db:studio
```

---

## 三、当前进度（W1 末交付）

| 模块 | 状态 | 文件 |
|---|---|---|
| Monorepo 骨架 | ✅ | `pnpm-workspace.yaml` / `turbo.json` / `tsconfig.base.json` |
| Prisma Schema 全集 | ✅ | `packages/db/prisma/schema.prisma` |
| Storage Adapter (MinIO + LocalFs) | ✅ | `packages/adapters/storage/` |
| Provider Adapter + **Seedance** | ✅ | `packages/adapters/provider/` |
| **API Key 加密存储 + 后台管理工具** | ✅ | `packages/adapters/src/crypto.ts` + `provider/index.ts` |
| EventBus Adapter (In-Process) | ✅ | `packages/adapters/eventbus/` |
| Auth Adapter (Local JWT) | ✅ | `packages/adapters/auth/` |
| Cost Ledger 中间件 | ✅ | `packages/adapters/provider/base.ts` + `packages/core/cost/ledger.ts` |
| 分镜向下合并算法 + 单测 | ✅ | `packages/core/storyboard/merge.ts` + `.test.ts` |
| 资产自动 @ 匹配算法 + 单测 | ✅ | `packages/core/generation/auto-match.ts` + `.test.ts` |
| Prompt 编译器 | ✅ | `packages/core/generation/prompt-compiler.ts` |
| **i18n CN/EN 双语基础设施** | ✅ | `packages/i18n/locales/{zh-CN,en}/*.json` |
| Docker Compose | ✅ | `infra/docker-compose.yml` |

### W1 验收测试（人工）

```bash
# 1. 跑核心算法测试（不依赖数据库）
pnpm test

# 期望: 至少 16 个测试通过（merge ×8 + auto-match ×9）
```

```bash
# 2. 验证数据库初始化
pnpm db:reset                # 重置（开发期可频繁用）
pnpm db:seed
```

```bash
# 3. 浏览数据
# ⚠️ pnpm db:studio (Prisma Studio) 只作 dev 个人调试用 —
#    它会显示 "Prisma Studio" 品牌、Changelog 链接到 Prisma 团队 GitHub。
#    W2 起团队成员请改用 SS 自建的 /admin/db-explorer（品牌完全自有）。
pnpm db:studio               # dev 临时方案：http://localhost:5555
```

```bash
# 4. 验证 Seedance 调用（需要真实 API Key）
# 不要写在 .env.local —— W2 起到 /admin/providers 后台填，加密存数据库
# W2 末通过 worker 测试脚本验收
```

---

## 四、下周（W2）开始

W2 主题: **Mission Control + Story Compass**

需要的开发顺序：
1. `apps/web` 起手（Next.js 15 + tRPC + Tailwind + shadcn 安装）
2. `packages/api` 起手（tRPC v11 + Zod）
3. 实现 `projectRouter`（CRUD + clone）
4. Mission Control 项目列表 + 单项目首页 UI
5. `scriptRouter.upload` / `scriptRouter.analyze`
6. 实现 Anthropic Provider（剧本分析 LLM）
7. Story Compass 单集分析页（8 维评分 + 整集诊断 + 剧情曲线）
8. W2 末验收：建项目 → 上传剧本 → 出分析报告

---

## 五、常见问题

**Q: Prisma 提示找不到 Client?**
A: 跑 `pnpm db:generate` 重新生成。

**Q: docker-compose 启动 MinIO 卡住?**
A: 检查 9000 / 9001 端口是否被占用：`lsof -i :9000`。

**Q: TypeScript 报 `@ss/xxx` 模块找不到?**
A: 跑 `pnpm install`，再 `pnpm db:generate`。Workspace 链接需要先安装。

**Q: 想换 Seedance 之外的视频模型?**
A: 编辑 `.env.local` 加新 Provider key，在 `packages/adapters/provider/` 新建 .ts 文件 + 在 `index.ts` `initProviders()` 里注册。业务代码完全不用改。

**Q: 想切换到云端（R2/OSS）?**
A: 改 `.env.local`：`STORAGE_DRIVER=r2` + `S3_ENDPOINT=...`。MinIO Adapter 已兼容所有 S3 协议。
