# @ss/api · tRPC Router 集成层

> 生成日期:2026-05-24(第 19 轮 audit Sprint D-4)

## 用途

把业务 router 全部集中在这,`apps/web` 挂到 `/api/trpc/*`,`apps/desktop` 同一份。
所有 mutation / query 的输入 zod schema + 中间件(权限 / rate-limit / audit log)在这里集中。

## 模块边界

**依赖**:
- `@ss/db`(Prisma client)
- `@ss/core`(纯业务算法 — asset breakdown / storyboard generate / cost ledger 等)
- `@ss/adapters`(auth verifyToken / provider / storage / eventbus)
- `@ss/queue`(addVideoGenJob / signStreamToken)
- `@ss/shared`(EVENTS / SsError / sanitizeErrorMsg / ...)
- `@ss/i18n`(resolveLocale)

**被依赖**:
- `apps/web/app/api/trpc/[trpc]/route.ts`(挂 Next.js Route Handler)
- `apps/desktop`(同一 tRPC client,Phase 2 启用)

**绝不**:被 `@ss/core` / `@ss/adapters` 反向 import(违反单向依赖)

## 核心入口

| 文件 | 职责 |
|---|---|
| `src/trpc.ts` | initTRPC + middleware 工厂(requireAuth / requireAdmin / wrapErrors / rateLimit) + AgentToolMeta(ADR-27) |
| `src/context.ts` | createContext — 每请求从 cookie 还原 user + 注入 requestId |
| `src/root.ts` | 合并所有 router 成 appRouter |
| `src/routers/*.ts` | 业务 router(auth / project / asset / storyboard / aigc / media / script / admin / insights / reports) |
| `src/middleware/audit.ts` | logOperation — 写 OperationLog(失败 console.error 含 requestId) |
| `src/middleware/rate-limit.ts` | rateLimit middleware factory |
| `src/utils/episode-lock.ts` | Episode 软锁(advisory_xact_lock + status) |

## 跨模块协作

- **入参** → user 调 tRPC → ctx 注入(prisma / user / requestId / ip / userAgent / locale)
- **出参** → tRPC errorFormatter 透传 `{ requestId, ssCode, zodIssues }` 到前端 error data
- **发事件** → 通过 `getEventBus().publish(EVENTS.XXX, payload)` 给订阅方
- **入队** → 通过 `addVideoGenJob(payload)` 给 worker
- **写审计** → `logOperation(ctx, action, targetType, targetId, before, after)`

## 升级 hook(Phase 1.5+)

| 场景 | 改哪里 |
|---|---|
| 加新 router | `src/routers/<name>.ts` + 在 `root.ts` 注册 |
| 加权限 middleware | `src/middleware/` + 工厂导出 |
| Mastra agent 接入 | mutation 加 `.meta({ agentTool: {...} })`(已为 5 个核心做,ADR-27 计划逐步覆盖到 13 个) |
| 错误码扩展 | `@ss/shared/errors.ts` 加 SsError 子类 + `trpc.ts` HTTP_TO_TRPC 加映射 |
| audit 字段扩展 | `middleware/audit.ts` 改 logOperation 签名 + schema 加字段(需 migration) |

## 独立测试

```powershell
pnpm --filter @ss/api typecheck
pnpm --filter @ss/api test   # vitest:episode-lock + script-extract
```

## 已知约束

- `OperationLog.action` 命名渐进迁移到 `<module>.<entity>.<verb>` 三段式(ADR-27,新增必合规,老的不动)
- `meta()` 配置已在 trpc.ts 注入 TRPCMeta type,所有 procedure 可加 `.meta({...})`
- 错误 throw 必用 `TRPCError`,不要 throw 裸 `Error`(让 errorFormatter 能透传 requestId)
- 任何对外暴露 errorMsg 都过 `sanitizeErrorMsg`(防 Provider URL/token 泄漏)
