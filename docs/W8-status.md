# W8 实战准备进度报告

> 生成日期:2026-05-24(十八收工 + 后续 R3/W8-A/B/C 推进)
> 用户授权:出门 2h,期间完成 W8 + 持续 debug + 决策代行
> 仓库:https://github.com/henrywei2030/SS

---

## 🎯 W8 12 步 checklist 实际进度

| 步 | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | `git pull origin main` | ✅ 完成 | 已 verify working tree clean + up to date |
| 2 | `pnpm install` | ✅ 完成 | preflight 全绿,无新 deps |
| 3 | `pnpm db:migrate:deploy` | ✅ 完成 | 19 migration 全 apply,"No pending migrations" |
| 4 | `pnpm infra:up` | ✅ 完成 | Postgres / Redis / MinIO 3 容器 healthy(23h+) |
| 5 | `pnpm dev` + `pnpm worker:dev` | ✅ 完成 | web :3000 `307` / worker :9200 `200`(自动检测既有进程) |
| 6 | 配 **Claude API Key** | ⏸ **阻塞** | 需用户进 `/admin/providers` 录入 |
| 7 | 配 **Seedance Key** | ⏸ **阻塞** | 同上(+ Volcengine 合规账号) |
| 8 | 配 **NanoBanana Key** | ⏸ **阻塞** | Phase 1.5 可选 |
| 9 | 创第二个 user | ⚠️ 部分 | admin seed 完成;allowSignup 默认关,创第二 user 需用户手动开(或人工 SQL — 我尝试被 classifier 拒,合理) |
| 10 | 端到端完整流程 | ⚠️ 部分 | **W8 smoke 18/18 全过**(无 LLM 部分);真触发分镜/抽卡需 Key |
| 11 | 跑通后 5 人冷启动 | ⏸ **阻塞** | 协调人召集 |
| 12 | 1 集 7 镜头实战 | ⏸ **阻塞** | 5 人分工真出片 |

---

## 🧪 W8 Smoke 18/18 — 真服务验证十八收工核心(`scripts/w8-smoke.mjs`)

```
[1]  ✅ admin 大写 ADMIN 登录(双层 lowercase+trim 防御不阻塞)
[2]  ✅ x-request-id header 是 UUID
[3]  ✅ me.session 返回 user(ctx 注入正常)
[4]  ✅ 自定义 X-Request-Id header 优先级生效
[5]  ✅ project.create + requestId 链接
[6]  ✅ unauth error.data.requestId 真透传(跟 header 一致)
[7]  ✅ zod 报错 + zodIssues 透传
[8]  ✅ sanitizeErrorMsg 真生效(generateForEpisode 错误无 URL/hex)
[9]  ✅ cleanup
[10] ✅ worker /health 200
[11] ✅ / status=307(next-intl redirect)
[12] ✅ /zh-CN/login status=200(public)
[13] ✅ /zh-CN/projects status=200(authed)
[14] ✅ /zh-CN/library status=200(authed)
[15] ✅ /zh-CN/admin/users status=200(admin)
[16] ✅ insights.getProjectOverview 200
[17] ✅ me.systemBranding 接通(brand=星垣工坊 / gachaMax=5 / budgetWarnPct=80%)
[18] ✅ me.presets 4/4 类(framing,angle,movement,lighting)
```

跑命令:`node scripts/w8-smoke.mjs`(任意时刻可重跑回归)

---

## 🐛 真发现 + 修的 bug(2 项 P1)

### P1 安全:tRPC errorFormatter 生产泄漏 stack
- **文件**:`packages/api/src/trpc.ts:36-44`
- **问题**:`errorFormatter` 默认在 dev + prod 都把 stack trace 包进 `shape.data`,生产部署后所有 API error 都暴露代码路径 / 内部结构给前端
- **修法**:`isProd ? delete baseData.stack : keep`,dev 保留 stack debug 用
- **commit**:`62de8b7`
- **PoC**:smoke v2 之前 step 17 看到 5KB+ stack 完整暴露在 client error response

### P1 脚本 bug:smoke cookie 处理被 next-intl Set-Cookie 冲掉
- **文件**:`scripts/w8-smoke.mjs`
- **问题**:用 `split(',').map(c => c.split(';')[0]).join('; ')` 字符串拼接,被 next-intl Set-Cookie NEXT_LOCALE 覆盖整个 cookie 字段,导致 ss_session 丢失,后续 page 请求全 307 → /login
- **修法**:加 `cookieJar = new Map()`,按 cookie name 合并
- **commit**:`62de8b7`

---

## 📊 三次 commit 累计

| commit | 内容 | 文件 +/- |
|---|---|---|
| `573a659` | feat(audit-r19+r20)60 次 debug 全栈加固 — 13 mutation .meta 100% + requestId 全链 + EventBus 4 publish 补 | 27 / +1164 / -27 |
| `7688c8a` | docs(audit-r3)19 轮文档一致性修补 + W8 smoke 脚本 | 3 / +315 / -10 |
| `62de8b7` | fix(security)tRPC errorFormatter 生产剥 stack + smoke v2 cookie jar 修 + 18/18 | 2 / +104 / -7 |

**总计**:30+ 文件,+1583 / -44 行,3 个 commit 全 push origin/main

---

## ✅ 全栈验证状态(2026-05-24 末)

### 健康基线
- `pnpm typecheck` 15/15 全过
- `pnpm test` 25 单测 + 10/10 task 全过
- `pnpm audit` 无 vuln
- `scripts/w8-smoke.mjs` 18/18 全过

### DB 真状态(R3-B agent verify)
- 4 高频查询全 **Index Scan**(无 Seq Scan):
  - insights time-window:`cost_ledger_entries_projectId_createdAt_idx` 0.157ms
  - aigc listGroups:`generation_attempts_shotGroupId_action_status_idx` 0.089ms
  - media list:`media_items_scope_kind_idx` 0.046ms
  - audit log:`operation_logs_projectId_createdAt_idx` 0.047ms
- OperationLog 7 条 smoke action 真持久化(EventBus + auditLog 真落库)
- 9 connections 8 idle,正常

### 服务运行状态
- web :3000 = 307(next-intl /zh-CN redirect)✓
- worker :9200/health = 200 ✓
- ss-postgres / ss-redis / ss-minio 全 healthy 23h+ ✓

---

## 🚧 下次开工建议

### 优先(W8 推进)
1. **配 Claude API Key** → `/admin/providers` 设置 ClaudeTextProvider
2. 跑 `scripts/w8-smoke.mjs` 看 step 8 sanitizeErrorMsg(真 LLM 时验证 URL/token 真脱敏)
3. **真触发 storyboard.generateForEpisode**(LLM 真出分镜)→ 看 worker `[req=xxx]` 日志

### 次优(Phase 1.5)
1. 配 Seedance Key → 真出视频
2. 开 `auth.allowSignup` → 创第二 user → 测真协作
3. Tauri Rust toolchain 装 → `pnpm tauri:dev` 真编译

### Phase 2 留尾(ADR-27 明确)
- React Error Boundary + 401 全局 redirect
- Optimistic update / 客户端 zod / form reset
- recharts lazy load / SSE polling fallback / 失败 errorCode 枚举
- 大文件 chunked upload / AIGC 来源 breadcrumb
- schema `@@index([projectId, createdAt])` migration
- OperationLog action 三段式渐进迁移

---

## 📁 关键文件指引

- **smoke 脚本**:`scripts/w8-smoke.mjs`(任意可重跑)
- **模块边界**:`docs/MODULES.md`
- **十八收工决议**:`docs/05-tech-decisions.md` ADR-27
- **W8 启动 checklist**:`docs/W1-W7-followup.md` § 12 步
- **十八收工日志**:`PROGRESS.md` 顶部
- **CHANGELOG 累计**:`CHANGELOG.md`(刷新到 W1-W7 + 19-20 轮 audit + 11 包)
