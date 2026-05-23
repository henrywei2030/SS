# 04 · 数据模型

> Prisma 24 张表 + 18 枚举的完整设计 + Phase 2/3 升级预留字段说明
>
> Schema 文件：`packages/db/prisma/schema.prisma`

---

## 一、表分类速览(28 张表 / 9 个领域)

> 2026-05-22 (深夜) 更新:
> - W3 加 3 表 — `scenes`(剧本场号)/ `shot_groups`(合并组)/ `prompt_edits`(AI→人改训练集源)
> - W4 加 1 表 — `asset_usage_bindings`(三层 episode/scene/shot 出场绑定 + 10 档 UsageType,替代旧 shot_asset_refs)
> - Asset 大改:加 archetypeKey(同人物多变体)+ 7 视角槽位字段(portrait/threeView/sceneMain/Front/Left/Right/Back/Panorama)+ maturity (L0-L5 enum) + lockedAt + voiceMediaId/voiceModelId
> - MediaItem 加 aspectRatio + viewKind 派生字段
> - GenerationAttempt 加 candidateForSlot + rejected/rejectedAt/rejectedBy
> - ScriptAnalysis 加 scope (EPISODE/PROJECT) + scriptId nullable + projectId + perEpisodeStats + comparisonJson(W6 整剧批量分析预留)
> - PromptEditTarget enum 加 ASSET(资产文本字段改动训练集)
>
> 2026-05-23 (八收工) 更新(W1-W5 跨模块 audit P0):
> - **`asset_usage_bindings`** 唯一约束由 `@@unique([assetId, episodeId, sceneId, shotId, usageType])` → **partial functional unique index**(`COALESCE(sceneId,'') + COALESCE(shotId,'') + WHERE deletedAt IS NULL`),修 PG 中 NULL≠NULL 致并发双插。schema 里 `@@unique` 注释化,真索引在 migration `20260523103000_audit_p0_assetusage_partial_unique`。
> - **`generation_attempts`** 写入路径补齐:storyboard.generateForEpisode(每场 action=TEXT)/ script.analyze(action=ANALYSIS)/ asset.breakdown(action=TEXT)/ asset.generateImage(失败路径补 status=FAILED + 真 unitPriceCny)— Phase 2 ROI 链路完整。
> - **`AssetDraft` LLM 输出** 新增 `archetypeKey` 必出字段(同人物变体共享 key,如 "陆乘-重生初期"/"疗伤期" 都用 `lucheng`),Asset 变体能力贯穿。
> - **`Episode.status`** 状态转换守卫:publishEpisode 只允 NOT_STARTED/IN_PROGRESS → IN_PROGRESS,防 COMPLETED/ARCHIVED 终态被 downgrade;script.upload/uploadFile 入口加 isEpisodeLockedNow 守卫,防 GENERATING 期间换剧本致跨版本 shot。
> - **`Asset.maturity`** 升级路径补齐:setComplianceManually 通过合规后必触发 computeMaturity(L4→L5)。
>
> 2026-05-23 (九收工) 更新(W5.1 token 化数据底座):
> - **`asset_usage_bindings`** 加 2 列:`shotGroupId String?`(AIGC 生成段级 binding,典型 1-8 这种 ShotGroup)+ `refSlotIdx Int?`(group 内稳定序号 1/2/3,UI "图片N"/"音频N" + 视频提示词 @图片N token 引用同一编号)。
> - 重建 partial functional unique 含 shotGroupId 维度(`COALESCE(sceneId,'') + COALESCE(shotGroupId,'') + COALESCE(shotId,'') + WHERE deletedAt IS NULL`)— migration `20260523113000_w5_1_assetusage_shotgroup_refslot`。
> - **`ShotGroup`** 加 `bindings AssetUsageBinding[]` 反向关系。
> - **AssetUsageType 不扩**:音频用既有 SOUND_BG / SOUND_VOICE / THEME 三个值,compile 时用 `kindFromUsage()` 派生 IMAGE/AUDIO 而不是存独立字段。
>
> 2026-05-23 (十收工) 更新(W5 audit3 + W6 + W7 + 10 轮 audit):
> - **`generation_attempts.shotGroupId`** FK 改 SetNull(W5 audit3,防硬删 ShotGroup 抹审计;migration `20260523170000_w5_audit3_attempt_shotgroup_setnull`)
> - **`generation_attempts.providerJobId`** 加 partial unique `(providerId, providerJobId) WHERE providerJobId IS NOT NULL`(W5 P2,防 W5.5 BullMQ webhook/retry 双写;migration `20260523180000_w5_p2_providerjob_unique`)
> - **`asset_usage_bindings` partial unique 含 shotGroupId+refSlotIdx**(W5 audit S1,防同 group 内编号撞车;migration `20260523150000_w5_audit_refslot_unique`)
> - **`SystemSetting.category`** 字典文档化为 6 种(原 schema 注释只列 4):`general / security / branding / feature_flag / model_binding / preset`(W7 加 preset)
> - **`PromptTemplate` 业务接入**:loadPromptTemplate helper 让 3 个 LLM 入口(asset/breakdown / storyboard/generate / script/analyze)从 DB 拉,fallback 到 hardcoded;seed 补 `script_analysis_main` 模板。Admin 改完实时生效(无缓存)
> - **`me.presets` 公开 endpoint**:让 W3 storyboard 编辑分镜(framing/angle)能拉 admin/presets 的预设字典(datalist 模式,自定义值兼容)
> - **`generation_attempts.inputJson` 脱敏**:`sanitize-prompt` helper 将 prompt 明文改为 preview(200 字)+ sha256 hash;references 仅留 idx+kind+assetId(剥 name+mediaUrl);防 DBA / 备份泄露 / listVideoTakes 越权拿原文
>
> 2026-05-24 (十一收工) 更新(W1-W7 audit P1/P2 followup + Shot schema 联动 + Step 1):
> - **`shots`** 加 `movement String?` + `lighting String?`(W7 4 大预设 framing/angle/movement/lighting 完整落库,跟 admin.preset 联动;migration `20260524000000_w7_followup_shot_movement_lighting`)
> - **`shots`** 加 `startFrameMediaId String?` + `endFrameMediaId String?`(ADR-23,Seedance 2.0/Veo 3.1/Wan 2.6 FLF2V 预留,Phase 1 不用 Phase 2 启用;migration `20260524100000_adr23_shot_first_last_frame`)
> - **`assets`** 公开导出移除 `ShotAssetRef` 类型,schema model 仍保留但标 `@deprecated`(W6 schema 升级时一起 drop)
> - **`users`** signup 加 deletedAt 过滤(防软删邮箱永久占用 P0)
> - **`projects` / `episodes` / `shots` / `scenes`** 多处 deletedAt 过滤补齐(admin.style.delete / project.get / archive 路径)
> - **Decimal.js 接入 cost ledger**:CostLedgerEntry 累加用 Prisma.Decimal,防 IEEE-754 大额漂移(ledger.ts/insights.ts/aigc.ts/base.ts 4 文件)

| 领域 | 表 | 用途 |
|---|---|---|
| § 1 身份与权限 | `users` | 用户 |
| § 2 项目与团队 | `projects` / `project_members` / `invitations` | 项目 + 成员 + 邀请 |
| § 3 剧本与分析 | `scripts` / `script_analyses` | 剧本上传(多版本 isCurrent + lockedAt)+ AI 分析(单集 + 整剧) |
| § 4 集与镜头 | `episodes` / `episode_assignments` / `scenes` / `shots` / `shot_groups` / `shot_asset_refs(已废)` | 集 + 分配 + **场** + 分镜(含 sceneId/groupId)+ **合并组** |
| § 4.5 训练数据 | `prompt_edits` | AI 输出 → 人改的训练样本(targetType SHOT/SHOT_GROUP/SCENE/ASSET) |
| § 4.6 出场绑定 | `asset_usage_bindings` | **W4 新**:Asset 三层出场绑定(episode/scene/shot + 10 档 UsageType) |
| § 5 数字资产 | `assets` / `asset_versions` | 人物/场景/道具 + 版本历史 |
| § 6 媒体中台 | `media_items` | 统一媒体存储（图/视/音/3D） |
| § 7 AIGC 抽卡 | `generation_attempts` | 每次生成的完整记录 |
| § 8 成本账本 | `cost_ledger_entries` | Cost Ledger 不可篡改流水 |
| § 9 操作审计 | `operation_logs` | 变更追溯 |
| § 10 Prompt/风格 | `prompt_templates` / `prompt_template_versions` / `style_profiles` | Prompt 模板系统 |
| § 11 Provider 配置 | `provider_configs` | AI 模型配置 + 加密 API Key |
| § 12 通知 | `notifications` | 邀请/Mention/告警 |
| § 13 工作报告 | `work_report_snapshots` | 抽卡率/成本快照 |
| § 14 系统设置 | `system_settings` | 全局 KV 配置 |

---

## 二、核心实体详解

### 2.1 `Project` — 项目

```prisma
model Project {
  id           String   @id @default(cuid())
  name         String
  type         ProjectType   // AI_REAL / ANIM_3D / ANIM_2D / POSTER / CUSTOM
  aspect       String        // "9:16" | "16:9" | "1:1"
  styleId      String?
  budgetCny    Decimal?      @db.Decimal(12, 2)
  startDate    DateTime?     @db.Date
  daysCount    Int?

  defaultVideoProviderId String?    // 'seedance-2.0'
  defaultImageProviderId String?
  defaultLlmModel        String?

  ownerId      String
  members      ProjectMember[]
  episodes     Episode[]
  // ...
  deletedAt    DateTime?           // 软删除
}
```

**升级性**：`defaultXxxProviderId` 字段允许 Phase 2 项目级 Provider 偏好（如某项目专用 Veo）

### 2.2 `Shot` — 分镜（核心）

```prisma
model Shot {
  id             String     @id
  episodeId      String
  number         String         // "1-8" / "9-18a"（合并后）
  framing        String?        // 景别
  angle          String?        // 角度
  content        String     @db.Text
  prompt         String     @db.Text
  promptCompiled String?    @db.Text  // 编译后真实下发的 prompt snapshot
  durationS      Float

  priority       Priority?      // S / A / B / C
  isMerged       Boolean    @default(false)
  mergedFrom     String[]       // 原始镜号集合

  positionIdx    Int            // ✅ Linear 排序
  positionX      Float?         // ★ Phase 3 Canvas 预留
  positionY      Float?         // ★ Phase 3 Canvas 预留

  status         ShotStatus     // DRAFT/PUBLISHED/QUEUED/GENERATING/.../FINAL
  versionHash    String?        // 版本快照
}
```

**关键升级钩子**：
- `positionX/Y` — Phase 3 Wireless Canvas 直接用
- `versionHash` — 支持 Diff & 回滚
- `mergedFrom[]` — "向下合并"后保留原始镜号链

### 2.3 `Asset` — 数字资产

```prisma
model Asset {
  id             String       @id
  type           AssetType        // CHARACTER / SCENE / PROP / STYLE_REFERENCE
  name           String
  alias          String[]         // ★ 别名（auto-match 关键）
  description    String?      @db.Text
  prompt         String       @db.Text

  characterRole  String?          // '主演-男主演' / '配角-反派' ...
  tags           String[]         // ['悔恨','坚定','重情义']

  styleId        String?

  // W4-MM 后的 7 视角槽位(以下三个旧字段已 @deprecated,新代码不要用)
  /// @deprecated 用 portraitMediaId / sceneMainMediaId
  mainMediaId    String?
  /// @deprecated 用 threeViewMediaId
  threeViewIds   String[]
  /// @deprecated 用 panoramaMediaId
  panorama360Id  String?

  // W4-MM 新槽位(人物 + 场景 + 道具/风格)
  portraitMediaId   String?  // 人物 9:16 正面形象
  threeViewMediaId  String?  // 人物 16:9 三视图(正/侧/背合一张)
  sceneMainMediaId  String?  // 场景主视角
  sceneFrontMediaId String?  // 场景正面
  sceneLeftMediaId  String?  // 场景左侧
  sceneRightMediaId String?  // 场景右侧
  sceneBackMediaId  String?  // 场景背面
  panoramaMediaId   String?  // 场景 360° 全景
  refImageIds       String[] // 参考图(生成时作 reference)

  // ★ Phase 2 升级钩子
  loraIds        String[] @default([])     // LoRA 训练集
  voiceMediaId   String?                    // 角色配音

  // ★ Phase 3 升级钩子
  model3dUrl     String?                    // 3D 模型 URL
  gaussianUrl    String?                    // Gaussian Splatting

  // 合规
  complianceId       String?                // 火山引擎合规代码
  complianceStatus   ComplianceStatus      // NOT_REQUIRED/PENDING/APPROVED/REJECTED/EXPIRED
  complianceCheckedAt DateTime?

  status         AssetStatus      // DRAFT / CANDIDATE / CONFIRMED / RETIRED
  deletedAt      DateTime?
}
```

**升级路径**：
- LoRA → Phase 2 自训风格 LoRA 挂这里
- Gaussian Splatting → Phase 3 3D 数字分身存这里
- Compliance ID → 视频生成时复用，避免每次重新审核

### 2.4 `GenerationAttempt` — 抽卡记录

```prisma
model GenerationAttempt {
  id            String          @id
  shotId        String?
  assetId       String?

  providerId    String          // 'seedance-2.0'
  modelId       String
  action        GenerationAction // VIDEO/IMAGE/TEXT/AUDIO/COMPLIANCE/ANALYSIS
  inputJson     Json            // 编译后 prompt + refAssets snapshot
  outputMediaId String?
  outputMediaIds String[]       // 多候选
  errorMsg      String?

  // 计费
  inputUnits    Float
  outputUnits   Float
  unitPriceCny  Decimal         @db.Decimal(10, 6)
  costCny       Decimal         @db.Decimal(10, 4)

  status        AttemptStatus   // QUEUED/RUNNING/SUCCESS/FAILED/TIMEOUT/BUDGET_BLOCKED
  startedAt     DateTime?
  finishedAt    DateTime?
  durationMs    Int?

  providerJobId String?         // W5.0:异步 Provider(Seedance)create→poll 任务 ID

  // 采纳标记
  adopted       Boolean
  adoptedAt     DateTime?
  adoptedBy     String?

  groupId       String?         // 同镜头多次抽卡归组
}
```

**升级路径**：
- `outputMediaIds[]` — Phase 2 多模型 Race 时一次生成多个候选
- `groupId` — Phase 2 Diff Highlight 用
- `costCny` 流入 `cost_ledger_entries` → ROI 分析

### 2.5 `MediaItem` — 媒体中台

```prisma
model MediaItem {
  id           String          @id
  projectId    String?         // null = 公共库
  scope        MediaScope      // PUBLIC / PROJECT / PERSONAL
  kind         MediaKind       // IMAGE / VIDEO / AUDIO / THREE_D / OTHER
  storageKey   String          // StorageAdapter 解析
  cdnUrl       String?         // Phase 2 CDN

  meta         Json            // 按 kind 决定形状
  tags         String[]
  aiLabels     Json?           // CLIP/CLAP 输出
  embeddingId  String?         // ★ Phase 2 pgvector

  copyright    CopyrightStatus // UNKNOWN/SELF_OWNED/LICENSED/RESTRICTED/FORBIDDEN
  source       MediaSource     // UPLOAD/AIGC/IMPORTED/EXTERNAL

  isFavorited  Boolean
  parentId     String?         // 衍生关系（降噪/混音版本）
}
```

**升级路径**：
- `embeddingId` — Phase 2 向量检索"用图搜""用音搜"
- `parentId` — 多版本衍生（原始 / 降噪 / 混音 / 最终）

### 2.6 `CostLedgerEntry` — 成本账本（不可篡改）

```prisma
model CostLedgerEntry {
  id            String     @id
  userId        String
  projectId     String?
  episodeId     String?
  shotId        String?
  attemptId     String?    @unique

  providerId    String
  modelId       String
  action        String     // 'video.generate' / 'image.generate' / 'text.analyze' / ...

  inputUnits    Float
  outputUnits   Float
  unitPriceCny  Decimal    @db.Decimal(10, 6)
  costCny       Decimal    @db.Decimal(12, 4)

  success       Boolean

  billingCycle  String?    // '2026-05' 月度归集
  plan          String?    // 'subscription' / 'pay-as-you-go'
}
```

**Phase 2 升级**：
- `billingCycle` 已就位 → 月度账单一行 SQL
- `plan` 字段支持双轨计费

### 2.7 `ProviderConfig` — Provider 配置 + 加密 API Key

```prisma
model ProviderConfig {
  providerId    String       @unique
  displayName   String
  kind          ProviderKind
  apiUrl        String?
  isActive      Boolean

  // ★ W1.7 加密 API Key 系统
  apiKeyEnc        String?   // AES-256-GCM base64(iv|tag|ciphertext)
  apiKeyMasked     String?   // '••••XYZ7' UI 显示
  apiKeyUpdatedAt  DateTime?
  apiKeyUpdatedBy  String?
  apiKeyRef        String?   // env 变量名（fallback）

  // 计费
  unitPriceCny  Decimal       @db.Decimal(10, 6)
  unitName      String        // 'second' / 'image' / 'ktoken' / 'request'

  maxConcurrent Int
  rateLimitRpm  Int
  defaultParams Json?

  healthScore   Float          // Phase 2 自动 failover
  lastErrorAt   DateTime?
}
```

**加密说明**：
- `apiKeyEnc` 用 `APP_MASTER_KEY` 加密
- 仅服务端解密
- `apiKeyMasked` 在 UI 显示后 4 位
- 切换 `APP_MASTER_KEY` 会导致已加密 key 无法解密 → 后台重新填写

### 2.8 `SystemSetting` — 系统级 KV

```prisma
model SystemSetting {
  key          String   @unique
  value        String   @db.Text
  category     String   // 'general' / 'security' / 'branding' / 'feature_flag'
  description  String?
  isSecret     Boolean
  updatedBy    String?
}
```

**已 seed 6 条**：
- `system.locale.default = 'zh-CN'`
- `system.brand.name_cn = '星垣工坊'`
- `system.brand.name_en = 'StarsAlign Studio'`
- `system.brand.tagline_cn = '群星垒垣，万剧汇聚'`
- `system.gacha.max_attempts = '5'`
- `system.budget.warn_pct = '80'`

---

## 三、18 个枚举

| 枚举 | 值 | 用途 |
|---|---|---|
| `UserStatus` | ACTIVE / SUSPENDED / PENDING | 账号状态 |
| `ProjectType` | AI_REAL / ANIM_3D / ANIM_2D / POSTER / CUSTOM | 项目类型 |
| `MemberRole` | OWNER / ADMIN / LEADER / MEMBER / VIEWER | 项目角色 |
| `InvitationStatus` | PENDING / ACCEPTED / REJECTED / EXPIRED / CANCELLED | 邀请 |
| `ScriptSource` | UPLOAD / AI_GENERATED / IMPORTED | 剧本来源 |
| `EpisodeStatus` | NOT_STARTED / IN_PROGRESS / **GENERATING** / COMPLETED / ARCHIVED | 集数状态(GENERATING 为 W3.1.followup 软锁中间态) |
| `AssignRole` | OWNER / COLLAB / REVIEWER | 集数分配角色 |
| `ShotStatus` | DRAFT / PUBLISHED / QUEUED / GENERATING / GENERATED / ADOPTED / IN_EDIT / FINAL / FAILED / BUDGET_BLOCKED | 镜头状态机 |
| `Priority` | S / A / B / C | 制作价值优先级 |
| `AssetRefKind` | VISIBLE / MENTIONED / VOICE_ONLY | 资产引用类型 |
| `AssetType` | CHARACTER / SCENE / PROP / STYLE_REFERENCE | 资产类型 |
| `AssetStatus` | DRAFT / CANDIDATE / CONFIRMED / RETIRED | 资产状态 |
| `ComplianceStatus` | NOT_REQUIRED / PENDING / APPROVED / REJECTED / EXPIRED | 合规状态 |
| `MediaScope` | PUBLIC / PROJECT / PERSONAL | 媒体可见范围 |
| `MediaKind` | IMAGE / VIDEO / AUDIO / THREE_D / OTHER | 媒体类型 |
| `CopyrightStatus` | UNKNOWN / SELF_OWNED / LICENSED / RESTRICTED / FORBIDDEN | 版权状态 |
| `MediaSource` | UPLOAD / AIGC / IMPORTED / EXTERNAL | 媒体来源 |
| `GenerationAction` | VIDEO / IMAGE / TEXT / AUDIO / COMPLIANCE / ANALYSIS | 生成动作类型 |
| `AttemptStatus` | QUEUED / RUNNING / SUCCESS / FAILED / TIMEOUT / CANCELLED / BUDGET_BLOCKED | 抽卡状态机 |
| `PromptCategory` | ASSET_BREAKDOWN / IMAGE_GENERATION / SHOT_GENERATION / SCRIPT_STORYBOARD / PANORAMA_360 / PROMPT_FRAGMENT / PROMPT_PRESET | Prompt 分类 |
| `StyleKind` | AI_REAL / ANIM_3D / ANIM_2D / CUSTOM | 风格类型 |
| `ProviderKind` | VIDEO / IMAGE / TEXT / AUDIO / COMPLIANCE / EMBEDDING | Provider 类型 |

---

## 四、Phase 2/3 升级预留字段汇总

不破坏现有 Phase 1 业务的"先埋字段"清单：

| 字段 | 表 | 阶段 | 用途 |
|---|---|---|---|
| `Shot.positionX / positionY` | shots | Phase 3 | Wireless Canvas 拖拽位置 |
| `Asset.loraIds[]` | assets | Phase 2 | 自训 LoRA 列表 |
| `Asset.voiceMediaId` | assets | Phase 2 | 角色配音绑定 |
| `Asset.model3dUrl / gaussianUrl` | assets | Phase 3 | 3D 一致性 |
| `MediaItem.embeddingId` | media_items | Phase 2 | pgvector 向量检索 |
| `MediaItem.parentId` | media_items | 通用 | 衍生版本链 |
| `MediaItem.cdnUrl` | media_items | Phase 2 | CDN 加速 |
| `CostLedgerEntry.billingCycle` | cost_ledger_entries | Phase 2 | 月度归集 |
| `CostLedgerEntry.plan` | cost_ledger_entries | Phase 2 | 计费模式 |
| `User.locale` | users | 通用 | 多语言 |
| `User.timezone` | users | 通用 | 时区 |
| `Project.defaultVideoProviderId / ImageProviderId / LlmModel` | projects | Phase 2 | 项目级 Provider 偏好 |
| `Asset.styleId` 独立于 `Project.styleId` | assets | Phase 2 | 资产级风格 override |
| `ProviderConfig.healthScore` | provider_configs | Phase 2 | 自动 failover |
| `Shot.versionHash` | shots | 通用 | Diff & 回滚 |

**总计 15 个升级钩子，全部可选（nullable / 默认值），不会破坏 Phase 1 业务。**

---

## 五、Migration 历史

| Migration | 创建时间 | 内容 |
|---|---|---|
| `20260521071305_init` | W1 阶段 | 初始 23 张表 + 18 枚举 |
| `20260521094555_add_apikey_enc_and_system_setting` | W1.7 增量 | 加密 API Key 字段 + SystemSetting 表 |

---

## 六、索引策略

关键索引（已在 schema 中声明）：

- `Project`: `[ownerId]` / `[deletedAt]` / `[type]`
- `Episode`: `[projectId]` / `[status]` / `@@unique([projectId, number])`
- `Shot`: `[episodeId]` / `[status]` / `[priority]` / `@@unique([episodeId, positionIdx])`
- `Asset`: `[projectId, type]` / `[projectId, name]`
- `MediaItem`: `[projectId, kind]` / `[scope, kind]`
- `GenerationAttempt`: `[projectId]` / `[shotId]` / `[providerId, status]` / `[createdBy, createdAt]`
- `CostLedgerEntry`: `[projectId, createdAt]` / `[userId, createdAt]` / `[providerId, modelId, createdAt]` / `[billingCycle]`
- `OperationLog`: `[projectId, createdAt]` / `[actorId, createdAt]` / `[targetType, targetId]`

---

## 七、查询速查

### 项目级抽卡率
```typescript
import { getProjectGachaRatio } from '@ss/core/cost';
const { ratio, generatedSeconds, targetSeconds } = await getProjectGachaRatio(projectId);
// ratio = generatedSeconds / targetSeconds
// 1.0 = 完美一次过；2.0 = 平均抽两次；5.0+ = 异常
```

### 项目级成本拆解
```typescript
import { getProjectCostBreakdown } from '@ss/core/cost';
const { totalCny, videoCny, imageCny, textCny, byProvider } = await getProjectCostBreakdown(projectId);
```

### 镜头成本
```typescript
import { getShotCost } from '@ss/core/cost';
const { total, attempts, successful, failed } = await getShotCost(shotId);
```

### 月度账单（Phase 2）
```typescript
import { getCurrentBillingCycle } from '@ss/core/cost';
const { cycle, totalCny } = await getCurrentBillingCycle(userId);
```

---

## 八、Schema 演进原则

1. **可选字段优先** — 新加字段必须 `nullable` 或有默认值，避免迁移破坏
2. **JSON 字段用于探索** — 未完全定型的数据先存 JSON，稳定后再拆字段
3. **软删除** — `deletedAt` 默认不要硬删
4. **审计入仓** — 重要变更入 `OperationLog`
5. **Cost 不漏** — 所有 Provider 调用必经 Cost Ledger
6. **预留 String[] 字段** — `loraIds`、`tags`、`alias` 等列表型容易扩展

---

## 九、想升级 schema？

1. 改 `packages/db/prisma/schema.prisma`
2. 跑 `corepack pnpm db:migrate` 生成新 migration
3. 提交 migration SQL（在 `packages/db/prisma/migrations/`）
4. 必要时更新 `seed.ts`
5. 更新本文档对应条目
6. 在 `PROGRESS.md` 记一条
