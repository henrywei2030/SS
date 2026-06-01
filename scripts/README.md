# scripts/ 目录索引

> 项目根 `scripts/` 下的辅助脚本一览。按"调用方"和"何时可删"分类。

## 🟢 长期常驻(CI / 收工流程 / 日常 onboarding)

| 脚本 | 调用方 | 用途 | 删除条件 |
|---|---|---|---|
| `init-env.mjs` | `pnpm setup:env` | 跨平台生成 `.env.local` + 密钥 + 给子项目建 `.env.local` symlink | **不可删**(新设备 onboarding 入口) |
| `preflight.mjs` | `pnpm preflight` | 7+1 项环境自检(Node / pnpm / Docker / .env / generated / git) | **不可删**(开工自检) |
| `start.mjs` | `pnpm start` | 一键启动:preflight + infra + migration + turbo dev + 开浏览器 | **不可删**(CLAUDE.md 设备登记主推) |
| `db-migrate-dev-guard.mjs` | `pnpm db:migrate` | 守卫 prisma migrate dev 不在生产跑 + 显式 generate(Prisma 7 兼容) | **不可删**(`pnpm db:migrate` 入口) |
| `db-reset-guard.mjs` | `pnpm db:reset` | 守卫 prisma migrate reset 不在生产跑(灾难防护) | **不可删** |
| `set-admin-password.ts` | 手动 `tsx scripts/set-admin-password.ts <email> <pwd>` | 重置任意用户密码(admin 忘密用)+ 默认密码警示 | **不可删**(运维必备) |

## 🟡 一次性 / 按需运维(留档供追溯,确认无用后可删)

| 脚本 | 创建时间 | 当时目的 | 何时可删 |
|---|---|---|---|
| `relay-batch-test.mjs` | 二十二收工(2026-05-25) | 中转站 107 非视频模型批量连接性测试(给新 token 用) | 长期保留(每次添加新中转站时跑一遍) |
| `relay-real-test.mjs` | 二十二收工 | 中转站端到端真打(TEXT max_tokens=1 / IMAGE 探活) | 长期保留(同上) |
| `test-admin-provider-crud.mjs` | 二十二收工 | admin Provider CRUD 端到端验证 | 长期保留(Provider 管理改动时回归) |
| `w8-smoke.mjs` | W8 准备 | 全链路 smoke 测试(19 个核心场景) | 长期保留(团队实战前回归用) |

## 🔁 维护原则

1. **一次性脚本**用完归到本表的"🟡 一次性"分类,**3 个月内确认无用 → 真删**
2. **每个新加的运维脚本**必须在本 README 留一行(脚本名 / 调用方 / 用途)
3. **CI / 收工 / onboarding 三类常驻脚本**改动需谨慎,跨设备影响大

## 关联文件

- `packages/queue/*.mjs` — BullMQ 队列 / 视频任务的运维工具,见 [packages/queue/README.md](../packages/queue/README.md)
- `infra/docker-compose.yml` — 本地 PG/Redis/MinIO,`pnpm infra:up` 拉起
