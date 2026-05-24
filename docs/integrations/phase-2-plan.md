# Phase 2 启动 Plan(草案 v0.1)

> 起草日期:2026-05-25(二十一收工后)
> 状态:**草案**,等用户拍板大方向 + 优先级排序后启动
> 关联:[ADR-26 Agent 联动](../05-tech-decisions.md#adr-26) / [ADR-28 §G 留尾](../05-tech-decisions.md#adr-28) / [phase-1.5-plan v2.1](phase-1.5-plan.md)

---

## § 0. Phase 1.5 → Phase 2 过渡

**Phase 1.5 完成(2026-05-24 二十收工)**:
- ✅ P0-1 entryType 预扣退还 / P0-2 2 倍率 / P0-4 CSV 导出 / P0-5 中转站 asset:// / P0-6 配 token(用户操作)
- ✅ moyu → relay 全面去特征化 / binding 强制显式选 / audit r21 真 P0+P1 修
- ✅ 一键启动 pnpm start / docs 全局对齐(20+ 收工)
- ✅ ADR-28 7 段决议归档

**Phase 2 触发条件**(满足任一):
- W8 实战暴露 Phase 1 / 1.5 设计不足
- 用户需要多人 SaaS 化(目前工作室 1 人 + 多设备)
- ROI 数据足够支持下一轮设计投入

---

## § 1. Phase 2 三大主题(候选,需用户排序)

### 主题 A:**SaaS 多租户化**(财务复杂度↑↑ / 产品复杂度↑↑↑)

把工作室自用工具升级成 multi-tenant SaaS:多用户 / 多组织 / 计费 / 充值 / 邀请。

**触发**:有外部团队想用、或者运营自己的 AI 短剧云服务。

**任务清单**(估 ~30 天工作量):
- **A-1** 数据模型加 `Organization` / `User-Org-Role` / `Subscription` / `Plan` 表(~5 表 + 2 enum)
- **A-2** ProviderConfig 加 cacheRate / groupRate(ADR-28 §G 留尾):
  - cacheRate:Claude/GPT prompt caching hit 折扣(解析 `usage.prompt_tokens_details.cached_tokens`)
  - groupRate:VIP / 新客 / 默认分组倍率(用户分组 × 单价乘子)
- **A-3** 充值 + 支付集成(参考 ADR-28 §G):Stripe + 支付宝 + 微信 + 兑换码
- **A-4** Cost Ledger 多租户隔离 + 月度 Billing Cycle 真接通
- **A-5** 签到送额度 / 裂变邀请(用户黏度,ROI 视情况)
- **A-6** Token 范围控制 + 智能体绑定(每 token 限定可用 model 列表)
- **A-7** 租户视角 console(/console/playground / /console/token / /console/log / /console/topup 等)— 参考 moyu console 4 区分但保留主次

### 主题 B:**Mastra Agent 编排**(自动化↑↑↑ / 产品创新↑↑↑)

把 13 个核心 mutation(已加 `.meta(agentTool)`)接入 Mastra 编排器,让 AI agent 自主跑业务流。

**触发**:用户想"一句话出剧 → 全链路自动跑完"。

**任务清单**(估 ~14 天工作量):
- **B-1** 装 Mastra(`@mastra/core`)+ Agent 注册扫描(`scanAgentTools()` 扫所有 router .meta.agentTool)
- **B-2** 写第一个 Pipeline:`生成完整短剧`(script.upload → analyze → storyboard.generate → publish → asset.batchCreate → breakdown → generateImage × N → aigc.generateVideo × N)
- **B-3** Agent 调用前 Budget Pre-check(累加 13 mutation 的 `costEstimateCny` → 跟项目剩余预算比 → 超则 dryRun 模式)
- **B-4** Agent 调用 audit log(每步 .meta.sideEffects 写 OperationLog,可回放)
- **B-5** 多 Agent 对抗评审(Critic + Defender + Judge,从 TODO 想法池迁来)
- **B-6** Auto-Salvage 废片回收(失败 attempt 自动截可用段,从 TODO 想法池)

### 主题 C:**Phase 1.5 留尾 polish + Phase 1 技术债**(产品质量↑↑ / 创新度↓)

把所有 audit 留尾 + W5.6 进阶 + W7 polish 一次性清完。

**触发**:W8 实战暴露 UI/性能/可观测性问题。

**任务清单**(估 ~10 天工作量):
- **C-1** W5.6 进阶:音频波形(wavesurfer.js)/ AI 自动打标(BPM/时长)/ pgvector 向量搜索
- **C-2** Polish 剩余:34 处硬编码颜色 → CSS var / a11y 完善 / listBindings N+1 / OperationLog 命名规范化
- **C-3** W3 Y.js + Hocuspocus 协作扩展(分镜表实时协同编辑)
- **C-4** W4 资产关系图谱(人物关系 / 场景空间相邻图,可视化)
- **C-5** ADR-28 §G 中转站留尾:素材库 group_id 自动创建 / /v1/models 自动同步 / token 模型白名单
- **C-6** /admin/api-usage 列设置 + RPM/TPM 指标 + 主题切换(ADR-28 §F P1-2/3/4)
- **C-7** OTel + Sentry 接入(可观测性)
- **C-8** 桌面端 Tauri 真编译(需 Rust toolchain)

---

## § 2. 推荐启动顺序(待用户拍板)

### 选项 1:实战驱动(推荐 ✨ — 先暴露问题再设计)

```
W8 真实战(1-2 周)→ 收集 P0/P1 bug + 用户反馈
    ↓
Phase 2 启动:基于实战痛点选主题 A/B/C
    ↓
3-6 月迭代 1 个主题至 80% 完成度
```

**好处**:不投入未必有 ROI 的设计;每步都有真实数据支撑

### 选项 2:并行起步

```
W8 实战 + Phase 2 主题 B(Mastra)并行
    ↓
B 完成后用 agent 自动跑 W8 实战
    ↓
B + C(polish)轮换
    ↓
A(SaaS 化)等外部需求触发
```

**好处**:Mastra 让 W8 自动化,降低人力成本

### 选项 3:技术债优先

```
Phase 2 主题 C(polish 全清)
    ↓
W8 真实战(此时代码质量更高)
    ↓
B(Mastra)/ A(SaaS)按需启动
```

**好处**:代码质量提升,长期可维护性↑

---

## § 3. 量级估算

| 主题 | 工作量 | 风险 | ROI | 推荐启动时机 |
|---|---|---|---|---|
| A SaaS 化 | ~30 天 | 高(财务+合规复杂)| 高(可商业化) | 有外部团队需求才启 |
| B Mastra | ~14 天 | 中(框架新,实战少)| 高(自动化创新) | W8 跑完积累数据后 |
| C Polish | ~10 天 | 低(已知任务)| 中(质量提升)| W8 暴露 UI 问题后 |

---

## § 4. 不在 Phase 2 范围(留 Phase 3)

- Wireless Canvas(脑暴模式画布拖拽)
- 3D Gaussian Splatting 数字分身
- Distribution Hub(多平台发布 + ROI 回流)
- 海外多区域部署
- Plugin SDK / Marketplace
- 国际化海外合规网关

---

## § 5. 决策提醒

**Phase 2 启动前需要用户决策**:
1. 选主题 A / B / C(或顺序组合)
2. 投入预算(时间 / 成本上限)
3. 触发条件(W8 实战是否先跑)

**草案待补充项**:
- 每个主题的 ADR 占位(目前 ADR-29 / 30 / 31 / 32 仍是占位)
- 跟其他成员同步(如果 Phase 2 涉及多人)
- 验收标准(per 主题)

---

> 本文件是 Phase 2 启动前的整理材料,正式启动时拆分成各主题的子 plan(类似 phase-1.5-plan.md v2.1)。
