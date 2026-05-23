---
title: 三方研究素材 License 跟踪
status: living
created: 2026-05-24
updated: 2026-05-24
---

# 三方研究素材 License 跟踪

> **用途**:确保我们借鉴的所有同行设计在 license 上合规,避免未来开源公开 / 法务审查 / 投资人尽调时"撞车"。
> **配套**:`docs/research/00-license-audit.md`(Phase 0 体检产出物,数据底层) · `docs/05-tech-decisions.md`(ADR,每条借鉴的具体决定)

---

## 1. 风险等级定义

| 级别 | License 范畴 | 含义 | 我们能做什么 |
|---|---|---|---|
| 🔴 高 | GPL-3.0 / AGPL-3.0 / CC BY-NC-SA / 无 LICENSE / proprietary | **严禁直接借鉴**(传染或默认全保留) | 只能读 README + 论文,**不能 copy 任何代码片段 / schema 字段命名 / 配置文件** |
| 🟡 中 | LGPL / AGPL with SaaS exception 不明 / 自定义协议 | **仅参考叙述** | 允许 read for inspiration,**独立从零实现**,在 ADR 写明"灵感来源 XXX,不复制" |
| 🟢 低 | MIT / Apache-2.0 / BSD-2/3-Clause / 0BSD / Unlicense | **可借鉴** | 直接 copy 允许,**保留原作者 NOTICE / Attribution 即可** |

### 几个易踩雷的边界

- **无 LICENSE 文件 = 默认全部版权保留**(不是公有领域)。常见误区:"GitHub 公开 = 可以抄",**错**。
- **AGPL + 我们是 SaaS**:司法管辖未一致,**最稳的策略是默认禁抄**,除非明确条款说支持 SaaS 例外。
- **CC BY-NC-SA**:CC 协议**不为软件设计**,且 -NC 明确禁商用,-SA 要求衍生作品同协议(传染)。商业 SaaS 绕开。
- **MIT/Apache 允许 copy 但要保留 NOTICE**:在文件头加 "Original from XXX (MIT License)" 即可。

---

## 2. 仓库借鉴跟踪表(2026-05-24 Phase 0 实测)

> 数据源:docs/research/00-license-audit.md(GitHub REST API + raw.githubusercontent.com 实测)
> 这里只列**我们真的借鉴 / 参考过 OR 已纳入研究计划**的仓库;14 仓库全表见研究文档。

| 仓库 | License (实测) | 等级 | 我们借鉴了什么 | 实施方式 | 关联 ADR |
|---|---|---|---|---|---|
| **mastra-ai/mastra** | Apache-2.0 + ee/ 闭源 | 🟢 主代码<br>🟡 ee/ | Phase 2 P2.4 多 Agent 编排框架 | 直接依赖 npm,主代码可学;**严禁触碰 `packages/*/ee/`** | **ADR-22** |
| **langfuse/langfuse** | MIT + ee/ 闭源 | 🟢 主代码<br>🟡 ee/ | LLM 观测 schema(trace/observation/score/cost) | 用于对照我们 W6 数据洞察字段;**严禁触碰 ee/ 目录** | ADR-21 §4 |
| **chatfire-AI/huobao-drama** | CC-BY-NC-SA-4.0(README badge) | 🔴 | 灵感:Mastra 在 TS 全栈短剧业务可行性 | 仅 read,**禁止 copy 任何 SKILL.md / config.yaml / prompt** | ADR-22 |
| **HBAI-Ltd/Toonflow-app** | Apache-2.0 | 🟢 | 漫画/动画生产 stage 划分思路 | 可深读代码,保留 NOTICE | (待) |
| **shuyu-labs/BigBanana-AI-Director** | BigBanana CL 1.0(禁商) | 🔴 | 产品形态参考(README + 截图) | 仅 read,**不能 copy 字段名 / 目录结构 / prompt 模板** | (无,产品调研) |
| **xuanyustudio/LocalMiniDrama** | MIT | 🟢 | `@图片N` token 化方案 | 已在 [video.ts](../packages/core/storyboard/video.ts) 落地同类设计,保留 NOTICE | (W5.1 设计) |
| **OnlyShot-ai-short-drama-skill** | MIT | 🟢 | Prompt SOP 思路(80-150 ref 库 / 失败模式) | 思想借鉴,具体内容独立写(避免风格撞车) | (待) |
| **abhinavkale-dev/fynt** | MIT | 🟢 | monorepo 结构(apps/{web,worker} + packages/) | 已采用同款 monorepo 模式,保留 NOTICE | ADR-02 |
| **ali-vilab/In-Context-LoRA** | 无 LICENSE + FLUX 派生 | 🔴 | 论文方法学参考(in-context LoRA) | 仅读 arxiv:2410.23775,**不能用代码或权重** | (Phase 3) |
| **Wan-Video/Wan2.2** | Apache-2.0(代码层) | 🟢 代码<br>🟡 权重 | 开源 FLF2V 参考实现 | 代码可借鉴,**权重协议另读 ModelScope/HF** | ADR-23 |
| **SkyworkAI/SkyReels-V3** | Skywork CL(license:other) | 🟡 | Phase 3 自托管视频模型选项 | 商用前阅读 Skywork CL PDF + 邮件备案 | (Phase 3) |

### 关键修正(2026-05-24 实测 vs 改进意见原说法)

| 仓库 | 改进意见说 | 实测结果 | 影响 |
|---|---|---|---|
| chatfire-AI/huobao-drama | "无 LICENSE = 全保留" | CC-BY-NC-SA-4.0(README badge) | 风险等级不变(🔴),但归因更准确(传染条款而非全保留) |
| HBAI-Ltd/Toonflow-app | "AGPL-3.0" | **Apache-2.0** | **降级风险**:从 🟡 提升到 🟢,**可深读代码** |
| mastra-ai/mastra | "Apache-2.0" | Apache-2.0 + ee/ 双轨制 | 主代码可借,**注意绕开 ee/ 目录** |
| langfuse/langfuse | "MIT" | MIT + ee/ 双轨制 | 主代码可借,**注意绕开 ee/ 目录** |

---

## 3. "灵感来源"记录机制

任何写到 `docs/05-tech-decisions.md` 的 ADR,若灵感来自 license 受限仓库,**必须**在 ADR 内写明:

```markdown
**Inspiration**: [HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) 三层 agent 思想
**License**: AGPL-3.0(🟡 仅参考叙述)
**Our Implementation**: 从零独立写 agent 编排逻辑,不复制其代码;架构相似但实现路径不同
```

这样未来法务审查 / 投资人尽调 / 开源 NOTICE 整理时,**一眼看清每条决策的合规边界**。

---

## 4. 风格上的额外约束

即便 license 允许 copy,**直接搬运 schema 字段命名也会让我们显得"撞车"**。建议风格:

1. **看 5 个项目的设计动机**(为什么有这个字段 / 为什么这样命名)
2. **闭眼自己写一遍**(用我们的领域语言:Asset / Episode / ShotGroup,不是 character / scene / shot_set)
3. **再回头对比**(改进意见 §10 列的 8 项护城河大多是这样产生的)

我们当前已落地的差异化(改进意见独立验证):
- `Asset.archetypeKey` 同人物多变体(陆乘-重生初期 / 疗伤期)
- `AssetMaturity L0-L5` 升级路径
- `PromptEdit` 训练集回流(4 类 targetType)
- `CostLedgerEntry` 不可篡改流水(粒度 = 单次 Provider 调用)
- 三大 Adapter(Storage / Provider / EventBus)接口解耦
- API Key AES-256-GCM 后台加密 + apiKeyMasked
- Phase 2/3 hook 字段预留(15+ 处)
- Mock Provider 全链路兜底(可在无 API Key 下开发)

---

## 5. 法务体检 checklist(发布前 / 开源前)

- [ ] 所有 `docs/research/raw-schemas/*` 文件头都有 license 标注
- [ ] 所有引用同行代码的 ADR 都标了 License + Inspiration / Implementation 区分
- [ ] 第三方依赖的 NOTICE 文件全收集
- [ ] 没有 🔴 级仓库的代码片段出现在我们仓库
- [ ] 投资人尽调材料里能解释 huobao-drama / Toonflow-app 等灵感来源 → 我们的实现链路

---

## 6. 历史变更

- 2026-05-24:创建文档,等待 Phase 0 体检数据填充全表
