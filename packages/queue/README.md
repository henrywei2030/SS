# @ss/queue · BullMQ + SSE Token + Redis

> 生成日期:2026-05-24(第 19 轮 audit Sprint D-4)

## 用途

W5.5 视频生成异步化基础设施(ADR-25):
- BullMQ video-gen queue 入队 / 配置(web 端用)
- worker 端配套常量 / 类型(`@ss/queue/types` 单一真相源)
- Redis 客户端单例 + 退避(`@ss/queue/redis`)
- SSE token HMAC 签发 / 验证(`@ss/queue/sse-token`)

## 模块边界

**依赖**:
- `bullmq` / `ioredis` / `jose`(HMAC)
- `@ss/shared`(constants)

**被依赖**:
- `@ss/api`(router 入队 + SSE token 签发)
- `apps/web/app/api/sse/aigc/[attemptId]`(SSE route handler 校验 token + 订阅 Redis channel)
- `apps/workers/video-gen`(worker 端订 queue + 写 Redis pub/sub)

**绝不**:依赖 `@ss/api` / `@ss/core`(底层基础设施)

## 核心入口

| 文件 | 职责 |
|---|---|
| `src/types.ts` | VideoGenJobDataSchema(zod) + VideoGenProgressEvent + videoGenChannel(attemptId) |
| `src/video-gen-queue.ts` | getVideoGenQueue() + addVideoGenJob(payload) — web 入队 |
| `src/redis.ts` | getPrimaryRedis() + 退避连接 + 30s 错误节流 |
| `src/sse-token.ts` | signStreamToken(attemptId, userId) + verifyStreamToken(token) — HMAC 5min TTL |

## 跨模块协作

```
[web tRPC mutation aigc.generateVideo]
   │ 1. 占位 attempt(status=RUNNING)
   │ 2. addVideoGenJob(payload)  ← jobId='videogen:attempt:<attemptId>',防重入
   │ 3. signStreamToken(attemptId, userId)  ← HMAC token 5min
   │ 4. return { attemptId, sseToken }
   ▼
[worker apps/workers/video-gen]
   │ 5. job 出队 → processor(job, workerId)
   │ 6. publish 'running' → Redis channel videogen:attempt:<id>
   │ 7. provider.generate(...)
   │ 8. 成功:写 MediaItem + 升 attempt SUCCESS + costLedgerEntry(事务)
   │ 9. publish 'success' → Redis channel
   ▼
[web SSE route /api/sse/aigc/<attemptId>]
   │ 10. verifyStreamToken(token) ← 拒陌生用户
   │ 11. subscribe Redis channel → 推 EventSource → 前端 hook 更新 UI
```

## 升级 hook

| 场景 | 改哪里 |
|---|---|
| 加新 Job 类型(Phase 2 Voice / Compliance worker) | 新 file `src/<name>-queue.ts` + types.ts 加 schema |
| Provider 容量调整(并发 / retry / dead letter) | `src/video-gen-queue.ts` defaultJobOptions + worker.ts WorkerOptions |
| SSE token TTL 改 | `sse-token.ts` `STREAM_TOKEN_TTL_SEC` 常量 |
| Redis 切集群 / Sentinel | `src/redis.ts` getPrimaryRedis() 实现 |
| Bull Board / Prometheus 监控(Phase 2) | 新 file `src/observability.ts` + 接 BullMQ events |

## 独立测试

```powershell
pnpm --filter @ss/queue typecheck
# 无 vitest 单测(集成测留 worker 端)
```

## 已知约束

- VideoGenJobDataSchema 是 web / worker 双向唯一契约,**改字段必须两边同步**(zod parse 在入队时强制)
- jobId 用 `videogen:attempt:<attemptId>` 确保 BullMQ 不入重复 job(stale re-queue 走 idempotency check)
- Redis channel 用 `videogen:attempt:<attemptId>`(单实例);Phase 2 多 worker 时,publish 走 Redis pub/sub 天然广播
- SSE token 用 `SSE_TOKEN_SECRET` env,fallback `JWT_SECRET`(必须 32+ chars)
- requestId 透传:web 入队时塞进 VideoGenJobDataSchema.requestId,worker console.log 加 `[req=xxx]` 前缀
