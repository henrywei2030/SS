# 同行研究总览 + 仓库体检 · v1

> 配套改进意见 §1 + §2 + §3 修订版 Tier 表
> 生成日期:2026-05-24
> 数据源:GitHub REST API + raw.githubusercontent.com + GitHub Atom feed(unauthenticated 速率上限触发后用 HTML/Atom 补)

## 14 仓库一览

> Tier 列基于"改进意见 §3 修订版 Tier 表"假定值,license 列基于本次实测。

| Tier | 仓库 | Stars | 最后 push | 状态 | License (实测) | 一句话定位 |
|---|---|---:|---|---|---|---|
| A | **mastra-ai/mastra** | 24,228 | 2026-05-23 | active | Apache-2.0 + ee/ 闭源 | TS-first 的多 Agent 框架,workflow / tool / memory 抽象齐全 |
| A | **langfuse/langfuse** | 27,765 | 2026-05-23 | active | MIT-Expat + ee/ 闭源 | LLM 观测平台,trace/session/score/cost 数据模型成熟 |
| A | **shuyu-labs/BigBanana-AI-Director** | 1,311 | 2026-05-17 | active | BigBanana CL 1.0(禁商) | 国产"AI 短剧导演"产品形态参考(🔴 只能 read) |
| A | **chatfire-AI/huobao-drama** | 12,341 | 2026-05-21 | active | CC-BY-NC-SA-4.0(禁商) | 火宝短剧:Nuxt3 + Hono + Drizzle + Mastra + sqlite 全流水线(🔴 只能 read) |
| A | **HBAI-Ltd/Toonflow-app** | 8,298 | 2026-05-12 | active | Apache-2.0 | 漫画/动画生产流水线,商用友好(🟢 可借鉴) |
| A | **xuanyustudio/LocalMiniDrama** | 418 | 2026-05-20 | active | MIT | 本地化短剧生成工程,可借鉴 |
| B | **Forget-C/Jellyfish** | 3,324 | 2026-04-17 | semi-active | Apache-2.0 | 待 01-* 文档定位 |
| B | **HKUDS/ViMax** | 6,836 | 2026-03-29 | semi-active | MIT | HKUDS 实验室视频生成研究 |
| B | **A-cat-with-carrots/OnlyShot-ai-short-drama-skill** | 18 | 2026-05-16 | active | MIT | 小型短剧 skill demo,价值在 prompt 蓝本 |
| B | **yuanzhongqiao/deep-printfilm** | 867 | 2026-05-07 | active | 无 LICENSE(禁商) | "PrintFilm" 短剧/电影 studio,Script→Asset→Keyframe(🔴) |
| B | **abhinavkale-dev/fynt** | 364 | 2026-04-13 | semi-active | MIT | 待 01-* 文档定位 |
| C | **Wan-Video/Wan2.2** | 15,861 | 2026-03-17 | semi-active | Apache-2.0(代码) | 阿里 Wan2.2 视频生成模型,代码 Apache,权重协议另谈 |
| C | **SkyworkAI/SkyReels-V3** | 461 | 2026-01-30 | dormant | Skywork CL(license:other) | 昆仑 SkyReels-V3 短剧专用视频模型 |
| C | **ali-vilab/In-Context-LoRA** | 2,074 | 2024-12-20 | **dead** | 无 LICENSE + FLUX 派生 | In-Context LoRA 方法,纯论文配套(🔴) |

## 死仓库 / 半死仓库(过去 90 天无 push / archived / 源码下架)

按"过去 90 天无 push"作为半死线(以 2026-05-24 为基准):

| 仓库 | 最后 push | 距今 | 处理建议 |
|---|---|---:|---|
| **ali-vilab/In-Context-LoRA** | 2024-12-20 | **521 天** | 已死。降级到 Tier D,**仅作为论文方法学参考**,不读代码、不抄实现。如需 in-context LoRA 思路,直接读 arxiv:2410.23775 论文。 |
| **SkyworkAI/SkyReels-V3** | 2026-01-30 | 114 天 | 半死(刚过 90 天线)。降级注意:模型生态可能转向 V4,跟进时优先查官方 HF / ModelScope 是否有新版。Tier C 维持,但不要把它当主选模型。 |
| **Wan-Video/Wan2.2** | 2026-03-17 | 68 天 | 临界但仍活。Wan2.2 是 Wan 系列稳定版,跟进 Wan-Video org 看是否已发 Wan3.x。Tier C 维持。 |
| **HKUDS/ViMax** | 2026-03-29 | 56 天 | 活但更新慢(学术项目常态)。Tier B 维持。 |
| **abhinavkale-dev/fynt** | 2026-04-13 | 41 天 | 活,小项目节奏。Tier B 维持。 |

**无下架 / archived / disabled 仓库**。14/14 GitHub 可访问。

## Tier A 推荐研究顺序

根据 license 等级 + stars + last push + 与我们栈相关性,Tier A 六个仓库的研究优先级:

### P0(本周必读,license + 栈 100% 匹配)

1. **mastra-ai/mastra**(Apache-2.0, 24.2k stars, 当天 push) — 我们已经在用 Mastra,直接读源码理解 step / workflow / memory / vNext beta 改进,反哺我们的 W7 后台 Agent 编排。
2. **langfuse/langfuse**(MIT, 27.8k stars, 当天 push) — LLM 观测的 schema 已是行业事实标准,直接对照我们 W6 数据洞察 MVP 的字段是否对齐。

### P1(下周读,产品形态参考)

3. **chatfire-AI/huobao-drama**(CC-NC-SA, 12.3k stars, 3 天前 push) — 国产短剧赛道里 stars 最高、最新的对标。**只能 read 产品流程**,但 README 已经把"前后端 + Mastra Agent + skill" 架构说透,价值在"对方做了什么"。
4. **HBAI-Ltd/Toonflow-app**(Apache-2.0, 8.3k stars, 12 天前 push) — 同赛道 license 最友好的一个,可深入读代码,看 stage / asset binding 设计。

### P2(看情况读,小项目可快速扫一眼)

5. **shuyu-labs/BigBanana-AI-Director**(Community License 禁商, 1.3k stars, 7 天前 push) — AntSK 出品的"AI 导演",产品形态层面看一下定位,**不能借代码**。
6. **xuanyustudio/LocalMiniDrama**(MIT, 418 stars, 4 天前 push) — 小仓但 MIT 干净,可读完整代码作为"本地化短剧"工程蓝本。

## 后续步骤(待写)

- `docs/research/01-mastra-deep-dive.md` — P0:mastra 主代码深读 + ee/ 边界图
- `docs/research/02-langfuse-data-model.md` — P0:langfuse trace/observation schema vs 我们 W6 的对照
- `docs/research/03-huobao-drama-product-walkthrough.md` — P1:huobao README 拆解(only read,not copy)
- `docs/research/04-toonflow-pipeline-analysis.md` — P1:Toonflow Apache 代码层借鉴清单
- `docs/research/05-video-model-procurement.md` — P2:Wan2.2 / SkyReels-V3 的代码与权重协议梳理(模型采购视角)

## 体检总结

- 14/14 仓库存活,无 archived/disabled。
- **真正能借代码**(🟢)的有 6 个,其中 P0 两个(mastra / langfuse 主代码)价值最高。
- **国产短剧赛道**(BigBanana / huobao-drama / deep-printfilm) **全部 🔴 license 禁商或无声明**,只能做产品调研。
- **In-Context-LoRA 已死**(521 天无 push),降级到 Tier D。
- **Wan2.2 / SkyReels-V3** 是模型权重视角的对标,代码协议没问题,但权重要单独走采购流程(SkyReels 需读 Skywork Community License PDF)。
