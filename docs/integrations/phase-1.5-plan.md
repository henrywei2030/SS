# Phase 1.5 P0 规划 v2.1(主次重审版)

> 日期:2026-05-24
> 来源:整合 docs/integrations/moyu-{api,full-docs,pricing,design-notes}.md
> 替换:docs/W1-W7-followup.md 中"P0 实战阻塞项"章节
> 状态:Phase 1.5 启动前的最终任务清单
>
> **v2.1 主次重审变更(2026-05-24 十九收工后)**:
> - 原则:moyu 是参考源不是设计模板,严格分"产品逻辑必需"(主)vs "UI 风格借鉴"(次)
> - **P0-2 4 倍率 → 2 倍率压简**:cacheRate / groupRate 是 SaaS 多租户产物,对单租户工坊过度,推 Phase 2
> - **P0-3 maskSecret 降级 P1-5**:纯 UI 美化(5 min),跟其他 UI polish 一起做
> - 净省工作量 ~0.5-1 天,P0 聚焦"上线必需"

---

## § 0. 重大设计变更(对比原 W1-W7-followup.md)

| 原计划 | 新计划 | 原因 |
|---|---|---|
| 配 3 个独立 Key(Claude / Seedance / NanoBanana) | **配 1 个中转站 token 覆盖 8 Provider** | moyu = OpenAI 兼容聚合,实测 token 真接通 chat/image/video |
| 简单 `costCny = units × price` | **加 2 倍率拆分**(模型/输出),cache+group 推 Phase 2 | moyu 实测公式精确,但 cache/group 对单租户工坊过度,压简 |
| 失败 `success:false costCny:0` | **加 entryType + 预扣/退还机制** | 视频生成 task 必须先预扣 + 完成后退还多扣 |
| Mock VideoProvider 兜底 | **真接中转站 via SeedanceProvider(endpointStyle:'relay')** | 已实装,只差配 token |
| W4 真 ImageProvider Phase 1.5 才做 | **中转站 seedream-4-0 真接,直接走 OpenAICompatImageProvider** | 已实装,只差启用 |

---

## § 1. P0 必修清单(实战前必做)

### P0-1 ⭐⭐⭐ Cost Ledger 加 entryType 字段 + 预扣/退还机制

**为什么**:
- moyu 视频 task 实测:**先预扣 ¥10 → 完成后退还多扣 ¥6.297 → 净消耗 ¥3.702**
- 我们当前 ledger 只记 `success: true/false + costCny`,**无法区分**预扣 vs 真扣 vs 退还
- 真接 Seedance 后,用户余额管理 + 财务对账会乱

**改造**:
1. `packages/db/prisma/schema.prisma` CostLedgerEntry 加字段:
   ```prisma
   model CostLedgerEntry {
     // ... 原有字段
     entryType    LedgerEntryType @default(NORMAL)  // 新字段
     refundReason String?  // 新字段:"video_task_overcharge_refund" 等
     parentEntryId String? // 新字段:退还行指向预扣行
     // ...
   }
   enum LedgerEntryType {
     NORMAL    // 正常扣费(LLM / image)
     PREPAY    // 预扣(视频 task 创建时)
     REFUND    // 退还多扣(视频 task 完成时)
     ADJUSTMENT // 手动调整(admin)
   }
   ```
2. 写 migration `20260524130000_phase15_ledger_prepay_refund`
3. `packages/api/src/routers/aigc.ts generateVideo`:创建占位 attempt 时**同时**写 PREPAY entry,worker 完成后**额外**写 REFUND entry
4. `apps/workers/video-gen/src/processor.ts`:成功后计算 `refund = prepaid - actual`,refund > 0 时插 REFUND entry
5. `packages/api/src/routers/insights.ts`:`totalCost` 改成 `SUM(costCny) WHERE entryType IN (NORMAL, REFUND)`(REFUND 是负数自动抵消)

**工作量**:~200 行 + 1 migration · 半天

---

### P0-2 ⭐⭐⭐ 计费模型 2 倍率拆分(模型/输出 · cache+group 推 Phase 2)

**主次定位**:**主**(产品逻辑必需) — 但只取核心 2 倍率,cache/group 是 SaaS 多租户产物,Phase 2 再加

**为什么**(moyu 实测公式压简版):
```
cost = (input_tokens / 1M × model_rate) + (output_tokens / 1M × model_rate × output_rate)
```

我们当前 `unitPriceCny`(per ktoken 合并价)精度不够 — 输入输出同价漂移严重。

**改造**:
1. ProviderConfig 加字段(只 2 个):
   ```prisma
   model ProviderConfig {
     // ... 原
     modelRate  Decimal? @db.Decimal(10, 6)  // 基础倍率 / 1M tokens(nullable 兼容旧)
     outputRate Decimal? @db.Decimal(10, 4)  // 输出价 = 输入 × 此倍率(典型 2x-5x)
   }
   ```
2. 写 migration + seed.ts 给中转站 provider(relay-*)填真倍率(claude-sonnet-4-5: modelRate=12.232 outputRate=5.001)
3. BaseProvider.recordLedger 改:
   ```ts
   if (modelRate != null) {
     const inputCost = inputUnits / 1_000_000 * Number(modelRate);
     const outputCost = outputUnits / 1_000_000 * Number(modelRate) * Number(outputRate ?? 1);
     costCny = inputCost + outputCost;
   } else {
     // 兼容旧 unitPriceCny 单价模式
     costCny = totalUnits / 1000 * unitPriceCny;
   }
   ```
4. 兼容旧:`unitPriceCny` 保留,新 Provider 优先用 2 倍率,旧 Provider 沿用单价模式

**Phase 2 延后(写注释占位)**:
- `cacheRate`:Claude/GPT prompt caching hit 折扣 — 单租户实际省钱有限(主要用于 system prompt > 1024 tokens 的高频场景),且需解析 `usage.prompt_tokens_details.cached_tokens`,Provider 适配复杂度高
- `groupRate`:用户分组倍率(VIP/新客/默认)— SaaS 多租户才有意义,工作室自用全 1.0,无价值

**工作量**:~150 行 + 1 migration · **半天**(压简后,原 1 天)

---

### ~~P0-3 maskSecret 前 5+后 4~~ → **已降级 P1-5**(纯 UI 美化,Phase 1.5 后段 polish)

> v2.1 主次重审:UI 风格借鉴非"上线必需",跟其他 polish 一起做。详见 § 2 P1-5。

---

### P0-4 ⭐⭐ /admin/api-usage 加导出 CSV

**为什么**:moyu /console/log 有"导出 CSV"按钮,我们 /admin/api-usage 缺。运维对账 + 用户拿明细要这个。

**改造**:
1. `apps/web/src/app/[locale]/admin/api-usage/page.tsx` 加导出按钮
2. 新 tRPC `adminRouter.exportCostLedgerCsv`:
   - 输入:`{ from, to, filterBy: { userId?, projectId?, providerId? } }`
   - 输出:CSV string 或 base64
3. 前端用 `Blob + URL.createObjectURL` 触发下载(我已在 scripts/w8-smoke 中用过)
4. CSV 字段:时间 / 令牌 / 分组 / 类型(NORMAL/PREPAY/REFUND) / 模型 / 输入 / 输出 / 缓存 / 花费 / 详情

**工作量**:~150 行 · 半天

---

### P0-5 ⭐⭐⭐ 中转站素材库接入(asset:// 引用机制)

**为什么**(看 docs/integrations/moyu-full-docs.md § "素材库接口文档" 24106 chars):
- 中转站素材库:上传图片/视频/音频得到 `asset://` URL → 视频生成 prompt 引用
- **避免每次重传大文件**,token 隔离,7 天有效期
- 我们 W5.6 Media Vault 已有 MediaItem 表,但**没接 中转站素材库**

**改造**:
1. 新建 `packages/adapters/provider/relay-asset.ts` RelayAssetProvider:
   - `upload(file: Buffer, kind: 'image'|'video'|'audio'): Promise<{assetUrl: string, expiresAt: Date}>`
   - `delete(assetUrl: string): Promise<void>`
2. `mediaRouter.upload` 改:上传到中转站后,把 `asset://...` 存到 MediaItem.meta.relayAssetUrl
3. `aigc.generateVideo` 改:provider 为 relay-* 时优先用 meta.relayAssetUrl(`asset://`)直接传给中转站,**不需要先上传到 MinIO 再下载**
4. 加 7 天自动续期 cron(或失败时重新上传)

**工作量**:~400 行 + 中转站素材库 API 调用 · 1 天

---

### P0-6 ⭐⭐⭐ 配 1 个中转站 token 启动 W8 实战

**为什么**:替代原计划的"配 3 个独立 Key",OpenAI 兼容中转站一个 token 覆盖 8 Provider,运维成本最低

**步骤**:
1. 在你选的中转站(如 moyu.info / OpenRouter / Poe / OneAPI 自部署)申请新 token(设额度上限,如 ¥50/月)
2. /admin/providers 录入到:
   - `relay-claude-sonnet-4-5`(剧本分析,LLM)
   - `relay-doubao-seedance-1-0-pro`(视频抽卡)
   - `relay-doubao-seedream-4-0`(图像生成)
3. 各 setActive(true) + testConnection(我已实现)
4. 跑 `scripts/w8-smoke.mjs` 看 18/18
5. 真触发 W3 script.analyze + W4 asset.generateImage + W5 aigc.generateVideo(每个 1 次,看真接通)

**工作量**:用户操作 + verify · 1 小时

---

## § 2. P1 推荐做(进 W8 实战后并行)

### P1-1 ⭐⭐ token 可用模型范围控制
**moyu 启发**:每个 token 限定能用哪些 model(避免误用昂贵模型)

**改造**:Token 表加 `allowedModels: String[]`,Provider 调用前 verify。Phase 2 多 admin 多 token 时关键。

### P1-2 ⭐⭐ 主题切换(亮/暗)
**moyu 启发**:头部"切换主题"按钮 + 全局主题色变量

**改造**:Next.js + `next-themes`(已知方案)+ Tailwind class strategy + 测 30 处颜色(W7 留尾的硬编码颜色一起改)

### P1-3 ⭐⭐ 数据看板加 RPM/TPM 指标
**moyu 启发**:KPI 卡有"平均 RPM 0.005 / 平均 TPM 168.431"

**改造**:`insightsRouter` 加 `getRpmTpmStats` query,/insights 页 KPI 4→5 卡

### P1-4 ⭐ 表格列设置
**moyu 启发**:消费日志页"列设置"按钮(用户隐藏不关心的列)

**改造**:`apps/web/src/components/ui/data-table.tsx` 加 column toggle UI,localStorage 持久化

### P1-5 ⭐ maskSecret 前 5+后 4 风格(原 P0-3 降级)
**moyu 启发**:`sk-jsfR**********WnDA`(前 5+后 4),比 `••••WnDA`(仅后 4)信息更多

**改造**:
1. `packages/adapters/src/crypto.ts maskSecret`:`${slice(0,5)}${'•'.repeat(10)}${slice(-4)}`
2. `packages/api/src/routers/admin.ts setApiKey` audit log 用新格式

**工作量**:~20 行 · 5 分钟 — 跟 P1-2 主题切换 / P1-3 RPM 一批做

---

## § 3. P2 长期跟进(Phase 2 SaaS 化时)

| # | 项目 | 启发来源 | 实施时机 |
|---|---|---|---|
| 1 | 充值 + Stripe / 支付宝 / 微信 | /console/topup | SaaS 化 v1 |
| 2 | 兑换码运营 | /console/topup | SaaS 化 v1 |
| 3 | 套餐购买(月度折扣) | /token-plan | SaaS 化 v2 |
| 4 | 签到送额度(用户黏度) | /console/personal | SaaS 化 v2 |
| 5 | 裂变邀请(邀请人数 KPI) | /console/topup | SaaS 化 v2 |
| 6 | 租户视角 console(分体验/个人/优惠/报表) | /console sidebar | SaaS 化 v2 |
| 7 | 报表中心 + 用户账单 | /console/report | 合规要求时 |
| 8 | 智能体绑定 token | /console/token "智能体"字段 | Mastra 落地后 |

---

## § 4. 跟原 W1-W7-followup.md 的映射

### 旧 P0 项 → 新位置
| 原 P0 | 新归属 |
|---|---|
| 跑 W5.5 audit migration | P0-1 一起(同 migration) |
| pnpm install @tauri-apps/cli | 移到 P1(Tauri 真编译非紧急) |
| 配 Claude API Key | **替换** → P0-6 配 1 个中转站 token |
| 配 Seedance Key | **替换** → P0-6 同 |
| 验证端到端 | P0-6 步骤 5 |

### 旧 Phase 1.5 项保留(不动)
- Invitation 邀请流程 UI(数据层 ready)
- Tauri 真编译(需 Rust toolchain)
- 跨设备 mac-studio V2 协议验证

---

## § 5. 执行优先级排序(强烈建议顺序)

```
Day 1(2-3h): P0-6 配中转站 token → 跑 smoke 19/19 → 真触发 W3/W4/W5 各 1 次
              ↓
Day 1-2: P0-1 + P0-2 同 migration(entryType + 2 倍率压简版,半天)
              ↓
Day 2: P0-4 CSV 导出(半天) [P0-3 maskSecret 已降级 P1-5]
              ↓
Day 3: P0-5 中转站素材库 asset:// 接入(1 天)
              ↓
Day 4-5: W8 5 人冷启动 + 1 集 7 镜头实战
              ↓
Day 6+: P1-1/2/3/4/5 polish(含 maskSecret + 主题切换 + RPM/TPM + 列设置) + Phase 2 启动
```

**v2.1 净省**:~0.5-1 天(P0-2 半天 + P0-3 移走),Day 2 可提前进 P0-5 或直接 W8 启动

---

## § 6. 关键学习沉淀(写入 ADR)

建议加 ADR-28(占位推 ADR-31):
> **第 21 轮 audit · moyu 真接入深度学习决议**
> 1. 计费模型从单一 unitPriceCny → 2 倍率拆分(modelRate/outputRate),cache+group 推 Phase 2(主次重审 v2.1)
> 2. cost ledger 加 entryType(NORMAL/PREPAY/REFUND/ADJUSTMENT)
> 3. Provider 接入策略:中转站(moyu/OpenRouter)优先,1 token 多 model,Phase 2 直连/订阅作为备份
> 4. 借鉴 moyu 设计:KPI 卡 / token mask 风格 / CSV 导出 / 列设置

---

## § 7. 验收标准(P0-1/P0-2/P0-4/P0-5/P0-6 全完成时,v2.1 压简版)

- [ ] CostLedgerEntry 有 entryType + 视频生成产生 PREPAY + REFUND 两条 entry
- [ ] insights 的 totalCost 是 NORMAL+REFUND 净额(不含 PREPAY 虚扣)
- [ ] ProviderConfig 2 倍率字段(modelRate/outputRate)填了真值,LLM 真调按公式算出跟 moyu 输入/输出分价模型一致的价
- [ ] /admin/api-usage 能下载 CSV(含全字段)
- [ ] 中转站素材库 asset:// 引用真生效,W5 抽卡用图不再重复上传 MinIO
- [ ] 1 个中转站 token 覆盖 3 个 Provider (LLM + image + video)
- [ ] W8 smoke 19/19 + 真触发 W3+W4+W5 单步全过
- [ ] OperationLog 含完整审计(setApiKey / testConnection / generateVideo / 预扣 / 退还)
- [ ] typecheck 全过 + test 25 测全过
- [ ] (maskSecret 风格 sk-XXXX••••••••YYYY 降级 P1-5,本验收不强求)
- [ ] (cacheRate / groupRate 已注释为 Phase 2,本验收不要求)
