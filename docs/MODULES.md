# 模块全景与边界 · StarsAlign Studio

> 生成日期:2026-05-24(第 19 轮 audit Sprint D-4)
> 本文档是所有 workspace 模块的边界 + 协作契约 + 升级 hook 集中说明。
> 各模块的 README 是细节,本文档是全景。

---

## § 1. Workspace 模块清单

```
starsalign-studio/
├── apps/
│   ├── web/              Next.js 14 主应用(前端 + tRPC route handler)
│   ├── desktop/          Tauri 2.x 桌面端骨架(Phase 1.5 真编译)
│   └── workers/
│       └── video-gen/    BullMQ 异步视频生成 worker(独立进程)
└── packages/
    ├── shared/           Topic 常量 / Error 类 / 通用 schema(零依赖)
    ├── db/               Prisma client + schema + seed(@ss/db)
    ├── i18n/             zh-CN / en locale 词条 + Locale resolver
    ├── adapters/         外部系统适配层(auth / storage / eventbus / provider)
    ├── core/             业务算法纯函数(asset breakdown / storyboard generate 等)
    ├── queue/            BullMQ queue + SSE token + Redis 客户端
    └── api/              tRPC router 集成(@ss/api,被 apps/web 挂载)
```

---

## § 2. 依赖关系图(单向无循环)

```
┌─────────────┐         ┌─────────────┐         ┌──────────────────┐
│ apps/web    │         │apps/desktop │         │apps/workers/     │
│ (Next.js)   │         │ (Tauri 壳)  │         │  video-gen       │
└──────┬──────┘         └──────┬──────┘         └────────┬─────────┘
       │ tRPC handler          │ wraps web              │ consumes job
       │                       │                        │
       ▼                       ▼                        ▼
┌──────────────────────────────────────────────────────────────────┐
│                        packages/api                              │
│           (router 集成 + ctx + middleware)                       │
└─────────────────────┬────────────────────────────────────────────┘
                      │ import
       ┌──────────────┼──────────────┬─────────────┐
       ▼              ▼              ▼             ▼
┌──────────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐
│packages/core │ │packages/ │ │packages/ │ │packages/db │
│(纯算法)      │ │adapters  │ │queue     │ │(Prisma)    │
└──────┬───────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘
       │              │            │              │
       └──────────────┴────────────┴──────────────┘
                      ▼
              ┌────────────────┐
              │packages/shared │
              │(零依赖)        │
              └────────────────┘
              ┌────────────────┐
              │packages/i18n   │
              └────────────────┘
```

**核心规则**:
- ✅ `shared` 零依赖,任何包都可 import
- ✅ `adapters` 只依赖 `shared` + `db`,**绝不**反向依赖 `core` / `api`
- ✅ `core` 业务算法,可依赖 `shared` + `adapters`(为了调 provider)
- ✅ `api` 集成层,依赖所有底层包
- ✅ `apps/*` 只依赖 `api` + `shared`,**不直接** import `core` / `adapters`(走 api router)
- ✅ worker 独立进程,直接 import `db` + `queue` + `adapters/provider`(不走 api)
- ❌ router 内**不互调**(用 EventBus 解耦)
- ❌ `core` 反向依赖 `api`(违反层次)

---

## § 3. 跨模块通信契约

### 3.1 同步调用(tRPC)
- 前端 / desktop / 任意 HTTP 客户端 → `apps/web/app/api/trpc/[trpc]` → `@ss/api` router
- requestId 自动注入(`hdrs['x-request-id']` 或 server 生成 UUID),贯穿 ctx → audit log → 入队 job → worker
- 错误响应携带 `requestId` 字段,用户报 bug 时附上,运维 grep 日志可全链路追溯

### 3.2 异步事件(EventBus)
- 单一真相源:`packages/shared/src/events.ts`(topic 常量 + payload type)
- Phase 1 in-process(`@ss/adapters/eventbus` `InProcessEventBus`)
- Phase 2 切 NATS(`EVENT_BUS_DRIVER=nats`),payload 同 schema
- dev 模式 trace log 默认开(`[eventbus] publish topic=X eventId=Y subscribers=N`)
- 关 trace:`SS_EVENTBUS_TRACE=0`;prod 默认关,显式开 = `SS_EVENTBUS_TRACE=1`

### 3.3 异步队列(BullMQ)
- 单一真相源:`packages/queue/src/types.ts`(VideoGenJobDataSchema zod)
- web 入队 `addVideoGenJob(payload)`,worker 收到 Job<VideoGenJobData> 类型完全一致
- 进度反馈走 Redis pub/sub(`videogen:attempt:<attemptId>` channel)→ SSE 推前端
- HMAC token 签 SSE 订阅授权(`packages/queue/src/sse-token.ts`)

### 3.4 LLM / 图像 / 视频 Provider
- 单一接口:`packages/adapters/provider/types.ts`(TextProvider / ImageProvider / VideoProvider / ComplianceProvider)
- Mock 与真实 provider 同接口,`getImageProvider('mock-img')` 切换
- ProviderRegistry 在 `seed.ts` 灌入,运行时 `/admin/providers` 配 API key(加密存)
- 失败白名单分类:`isUnrecoverableError(e)` → BullMQ 不重试(ADR-25 M4)

---

## § 4. 升级 hook 集中清单(给 agent / 维护者参考)

### 4.1 Provider 接入(Phase 1.5+)
- `packages/adapters/provider/<vendor>.ts` 新建 Adapter 类
- 实现 `TextProvider` / `ImageProvider` / `VideoProvider` 接口
- 在 `seed.ts` 灌 ProviderConfig 行
- 在 `packages/adapters/provider/index.ts` 加 switch case
- **关键约束**:`skipLedger:true` 传入,Provider 内**不**写 CostLedgerEntry(router 端单点写,防双扣)

### 4.2 Mastra Agent 接入(Phase 2 — ADR-26+27)
- 所有 mutation 应有 `.meta({ agentTool: {...} })` 元数据(描述 / 副作用 / 成本 / 是否需 confirm)
- **Phase 1 已 100% 覆盖 13 个核心 mutation**(第 19+20 轮 audit 落地):
  - asset.create / asset.generateImage / asset.batchCreate / asset.breakdown
  - storyboard.generateForEpisode / storyboard.publishEpisode / storyboard.mergeShots
  - aigc.generateVideo / aigc.bindAssetToGroup
  - script.upload / script.analyze
  - project.create / project.addMember
- Phase 2 启动时:写 `packages/agent/tools.ts` 扫所有 router → procedure.meta.agentTool → Mastra tool registry,**零业务改动**

### 4.3 EventBus 切 NATS(Phase 2)
- 当前 `InProcessEventBus`,switch via `EVENT_BUS_DRIVER` env
- 新建 `packages/adapters/eventbus/nats.ts` 实现 `EventBus` 接口
- payload type 不变,但加 zod schema 化 publish 前 parse(跨进程 type 不可信)
- EventMeta 加 traceId / spanId 接 OTel

### 4.4 数据库切云(Phase 2)
- `DATABASE_URL` 改 Supabase / Neon 即可
- migration 不动(Prisma 屏蔽)
- 多设备共享:Phase 2 计划,Phase 1 各设备本地 Docker(见 CLAUDE.md `跨设备数据矩阵`)

### 4.5 国际化扩展(Phase 2)
- 新增 locale:`packages/i18n/locales/<locale>/` + 在 `packages/i18n/src/index.ts` `SUPPORTED_LOCALES` 加
- 所有 t() key 必须 zh-CN/en/<新> 都有(否则 fallback 默认)

### 4.6 Tauri 桌面端真编译(Phase 1.5)
- 当前 `tauri.conf.json` 无 `capabilities` 配置(Tauri 2 默认空 = 严格拒绝,最安全)
- Phase 1.5 启用:
  1. 装 Rust toolchain(`rustup-init`)
  2. 装系统依赖(Win: VS Build Tools + WebView2;mac: Xcode CLI;Linux: webkit2gtk)
  3. `pnpm install` 拉 @tauri-apps/cli 2.x
  4. 改 `tauri.conf.json` 加 `"capabilities": ["capabilities/default.json"]`(预设已在 `apps/desktop/src-tauri/capabilities/default.json`)
  5. 按需启用 disabled_by_default 中的 fs/shell/http 权限,严格 review
  6. `pnpm tauri:dev` 跑 dev / `pnpm tauri:build` 跑 production bundle
- 详见 `apps/desktop/README.md`

---

## § 5. 模块独立性测试

每个模块应能被**单独**升级 / 改 UI / 改业务参数,不破坏其他模块。

### 测试方法
1. `pnpm --filter @ss/<module> typecheck` 只跑该 module 类型检查
2. `pnpm --filter @ss/<module> test` 只跑该 module 单测
3. 改一个 module 跑全栈 `pnpm typecheck` 应该过(否则有耦合泄漏)

### 当前已知耦合
- `apps/web` 跟 `packages/api` 是强耦合(同源 tRPC 类型),正常
- `apps/workers/video-gen` 跟 `packages/queue` `packages/db` 强耦合,正常
- 其余模块 horizontal 独立 ✓

---

## § 6. 模块 README 索引(分模块详情)

- [`packages/api/README.md`](../packages/api/README.md) — tRPC router 入口契约
- [`packages/core/README.md`](../packages/core/README.md) — 业务算法纯函数
- [`packages/queue/README.md`](../packages/queue/README.md) — BullMQ + SSE token
- [`packages/adapters/README.md`](../packages/adapters/README.md) — auth/storage/provider/eventbus 适配
- [`apps/desktop/README.md`](../apps/desktop/README.md) — Tauri 桌面端骨架
- Phase 2 待补:packages/shared / db / i18n / apps/web / apps/workers
