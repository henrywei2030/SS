# @ss/adapters · 外部系统适配层

> 生成日期:2026-05-24(第 19 轮 audit Sprint D-4)

## 用途

把所有外部系统(auth / storage / eventbus / LLM Provider)抽象成接口,业务层只依赖接口不依赖具体实现。
切换实现(local→Clerk / minio→R2 / in-process→NATS / mock→真接 Provider)只改这里的 switch case,业务零改动。

## 子模块清单

| 子模块 | 路径 | 接口 | 当前实现 | Phase 2 切换目标 |
|---|---|---|---|---|
| auth | `auth/` | `AuthAdapter` | `LocalAuthAdapter`(JWT + bcrypt) | Clerk / WorkOS |
| storage | `storage/` | `StorageAdapter` | MinIO / local-fs | R2 / OSS / S3 |
| eventbus | `eventbus/` | `EventBus` | `InProcessEventBus` | NATS / Redis Streams |
| provider | `provider/` | `TextProvider` `ImageProvider` `VideoProvider` `ComplianceProvider` | Mock + Claude / Seedance / NanoBanana 真接(待 API key) | + 火山合规 + Volcengine |

## 模块边界

**依赖**:
- `@ss/shared`(SsError / sanitizeErrorMsg / events)
- `@ss/db`(部分 — auth 查 user / provider 读 ProviderConfig)
- 各 SDK(bcryptjs / jose / @aws-sdk/client-s3 等)

**被依赖**:
- `@ss/api`(全部 router)
- `@ss/core`(provider 调用)
- `apps/workers/video-gen`(provider / storage)

**绝不**:依赖 `@ss/api` / `@ss/core`(适配层不应反向依赖)

## 核心入口

### auth/
- `getAuthAdapter()` — 工厂,看 `AUTH_DRIVER` env(默认 local)
- `LocalAuthAdapter`:login / signup / verifyToken / changePassword / logout
- **关键约束**:input email/username 必经 `.toLowerCase().trim()` 防绕过软删(双层防御 — router .transform + adapter 内归一化)

### storage/
- `getStorageAdapter()` — 工厂,看 `STORAGE_DRIVER` env
- `MinIOStorageAdapter`:putObject / getObject / signedUrl / copyObject(URL 编码 audit 修过)
- `LocalFsStorageAdapter`:`.local/storage/` 兜底
- `buildStorageKey({ scope, projectId, kind, ext })` — 统一文件名格式

### eventbus/
- `getEventBus()` — 工厂,看 `EVENT_BUS_DRIVER` env
- `InProcessEventBus`:基于 Node EventEmitter,dev 模式自动 trace log
- 关 trace:`SS_EVENTBUS_TRACE=0`;prod 默认关

### provider/
- `getTextProvider(providerId)` / `getImageProvider` / `getVideoProvider` / `getComplianceProvider`
- 工厂读 `ProviderConfig` DB row + 解密 apiKeyEnc(用 `APP_MASTER_KEY`)
- Mock provider 兜底(无 key 时跑 picsum / 公开样片)
- **关键约束**:所有 provider.generate() 接 `{ skipLedger?: boolean }`,router 单点写 cost(防双扣)
- 失败白名单:`isUnrecoverableError(e)` → BullMQ 不重试(ADR-25 M4)

## 升级 hook(Phase 1.5+)

### 加新 Auth 实现
1. 新建 `auth/<vendor>.ts` 实现 `AuthAdapter`(login/signup/verifyToken/changePassword/logout)
2. 在 `auth/index.ts` switch case `'<vendor>'`
3. `AUTH_DRIVER=<vendor>` env 切换

### 加新 Storage 实现
- 同上模式,实现 `StorageAdapter`

### 加新 Provider(NanoBanana / GPT Image / 豆包真接)
1. 新建 `provider/<vendor>.ts` 实现 `ImageProvider` 接口
2. 在 `provider/index.ts` 加 switch
3. `seed.ts` 灌 ProviderConfig 行
4. `/admin/providers` UI 配 API key(加密存,APP_MASTER_KEY 解密)
5. errorMsg 必经 `sanitizeErrorMsg`(防 URL/token 泄漏)

### 加新 EventBus(NATS)
1. 新建 `eventbus/nats.ts` 实现 `EventBus`
2. 在 `eventbus/index.ts` switch
3. 加 zod schema 化所有 EVENTS payload(跨进程 type 不可信)

## 独立测试

```powershell
pnpm --filter @ss/adapters typecheck
pnpm --filter @ss/adapters test   # vitest:crypto.test.ts
```

## 已知约束

- 适配层是**唯一**接触外部 SDK 的地方,业务层 import 接口不 import SDK
- 任何 Adapter 失败必须 throw `SsError` 子类(`ProviderError` / `ComplianceError` / `ForbiddenError`),让 trpc wrapErrors 翻译
- ProviderError 的 message 经 trpc errorFormatter 透到前端 — 必经 `sanitizeErrorMsg` 脱敏
- adapter 实例缓存单例(避免每请求重建),`getXxx()` 工厂内部 lazy init
