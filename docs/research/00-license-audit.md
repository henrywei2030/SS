# 同行仓库 License 审计 · v1

> 生成日期:2026-05-24
> 数据源:GitHub REST API + raw.githubusercontent.com + GitHub Atom feed(实时查询)
> 用途:决定我们能否借鉴某仓库的代码 / schema / 设计
> 14 个仓库全部可访问,无 NOT FOUND / ARCHIVED / DISABLED

## 风险等级图例

- 🔴 **严禁直接借鉴**:GPL/AGPL 传染、无 LICENSE(默认全保留)、CC-NC-*/Community License 禁商用、FLUX-non-commercial 派生
- 🟡 **仅参考叙述**:允许 read 公开页面,不允许 copy 代码片段;模型权重协议(SkyReels Community License 等)受单独约束
- 🟢 **可借鉴(保留 NOTICE)**:MIT / Apache-2.0 / BSD,只要保留版权声明就可商用

## 全表(14 仓库)

| # | 仓库 | License (SPDX) | 等级 | 商用风险 | 借鉴方式 |
|---|---|---|---|---|---|
| 1 | shuyu-labs/BigBanana-AI-Director | **BigBanana Community License 1.0** (NOASSERTION) | 🔴 | 高:明文禁商用,含内部生产 | 仅 read 设计与产品形态,**禁止 copy 代码 / schema** |
| 2 | chatfire-AI/huobao-drama | **CC-BY-NC-SA-4.0**(README badge,无 LICENSE 文件) | 🔴 | 高:非商用 + 相同方式共享(传染) | 仅 read,设计层借鉴用自然语言转述,不抄代码 |
| 3 | yuanzhongqiao/deep-printfilm | **无 LICENSE 文件 + README 无声明** | 🔴 | 极高:默认全保留 | 只能看,任何复制都构成侵权 |
| 4 | xuanyustudio/LocalMiniDrama | **MIT** | 🟢 | 低 | 可借鉴 schema / 工程片段,保留 NOTICE |
| 5 | A-cat-with-carrots/OnlyShot-ai-short-drama-skill | **MIT** | 🟢 | 低 | 可借鉴,保留 NOTICE |
| 6 | HBAI-Ltd/Toonflow-app | **Apache-2.0** | 🟢 | 低 | 可借鉴,保留 NOTICE + 列入第三方目录 |
| 7 | Forget-C/Jellyfish | **Apache-2.0** | 🟢 | 低 | 可借鉴,保留 NOTICE |
| 8 | abhinavkale-dev/fynt | **MIT** | 🟢 | 低 | 可借鉴,保留 NOTICE |
| 9 | mastra-ai/mastra | **Apache-2.0 + ee/ 闭源**(双轨制,API 显示 NOASSERTION) | 🟢/🟡 | 主代码低,`ee/**` 路径禁用 | 主代码可借鉴;**严禁触碰 `packages/*/ee/` 任何文件** |
| 10 | langfuse/langfuse | **MIT-Expat + ee/ 闭源**(双轨制,API 显示 NOASSERTION) | 🟢/🟡 | 主代码低,`ee/`、`web/src/ee/`、`worker/src/ee/` 禁用 | 主代码可借鉴;**严禁触碰 ee/ 目录** |
| 11 | HKUDS/ViMax | **MIT** | 🟢 | 低 | 可借鉴,保留 NOTICE |
| 12 | SkyworkAI/SkyReels-V3 | **license: other**(Skywork Community License) | 🟡 | 中:允许商用但需遵守独立协议(可能需邮件备案) | 借鉴前先阅读 Skywork Community License PDF,模型权重单独受限 |
| 13 | Wan-Video/Wan2.2 | **Apache-2.0** | 🟢 | 低(代码层) | 代码可借鉴;模型权重可能另有 ModelScope/HF 协议 |
| 14 | ali-vilab/In-Context-LoRA | **无 LICENSE 文件** + README 指向 FLUX-1-dev-non-commercial | 🔴 | 高:派生自 FLUX 非商用模型 | 仅 read 论文/方法,**不能借代码或权重** |

## 高风险仓库详情(🔴 / 🟡)

### 🔴 1. shuyu-labs/BigBanana-AI-Director(BigBanana Community License 1.0)
- LICENSE 全文显式禁止:商业活动 / 付费服务 / 收入生成 / SaaS / OEM / 白标 / **企业内部生产商业运营**。
- 商标条款另禁使用 BigBanana / AntSK 品牌资产。
- 我们能做:**只读产品形态、UI 流程、模块分工**,转写成自己的设计语言。
- 我们不能做:照搬目录结构、字段名、prompt 模板、组件实现。

### 🔴 2. chatfire-AI/huobao-drama(CC-BY-NC-SA-4.0)
- README badge 明示 `licenses/by-nc-sa/4.0/`,无 LICENSE 文件兜底。
- NC 禁商用,SA 是 copyleft 传染(衍生作必须同许可)。
- 我们能做:read 技术架构描述(Nuxt 3 + Hono + Drizzle + Mastra + better-sqlite3),理解他们的"前后端 + Mastra Agent 技能"思路。
- 我们不能做:抄 Mastra Agent SKILL.md 任何文件、抄 config.yaml 字段、复用 prompt。

### 🔴 3. yuanzhongqiao/deep-printfilm(无 LICENSE)
- 无 LICENSE 文件,README 无任何许可声明 → GitHub 默认条款:**保留全部权利**,只授予 fork 和查看权。
- 我们能做:只读,做笔记记录"他们也走 Script→Asset→Keyframe 工作流"这种事实级观察。
- 我们不能做:任何 copy/paste(无论代码、schema、prompt、UI 文案)。

### 🔴 14. ali-vilab/In-Context-LoRA(无 LICENSE + FLUX 派生)
- 无 LICENSE 文件 → 默认全保留。
- README 明示需遵守 FLUX License(`black-forest-labs/flux/tree/main/model_licenses`),FLUX-1-dev 是 non-commercial。
- 数据集还有版权声明免责。
- 我们能做:read 论文 arxiv:2410.23775,理解"in-context LoRA"方法论。
- 我们不能做:用他们的代码或权重训练任何商用模型。

### 🟡 9. mastra-ai/mastra(Apache-2.0 + ee/ 闭源)
- LICENSE.md 第一段写明:`packages/core/src/auth/ee/`、`packages/server/src/server/auth/ee/` 及任何 `ee/` 目录受 `ee/LICENSE` 闭源条款约束。
- 主代码(包括 Agent 框架、tool 调用、内存等)是 Apache-2.0,可借鉴。
- 商用风险点:误触 ee/ 目录(企业版 auth / billing / sso 相关)。

### 🟡 10. langfuse/langfuse(MIT-Expat + ee/ 闭源)
- 主代码 MIT,但 `ee/`、`web/src/ee/`、`worker/src/ee/` 目录走另一套 ee/LICENSE。
- 商用风险点:LLM 观测(traces / sessions / scores)的 schema 全在主代码,可借鉴;但 SSO / RBAC / 计费 / project-level isolation 多在 ee/。

### 🟡 12. SkyworkAI/SkyReels-V3(license: other)
- LICENSE.txt 顶部 frontmatter `license: other`,正文为 Skywork 协议,引用 [Skywork Community License PDF](https://github.com/SkyworkAI/Skywork/blob/main/Skywork%20Community%20License.pdf)。
- 允许商用,但要求遵守独立条款(可能含邮件备案、不得用于危害国家社会安全的活动)。
- 商用前必须阅读完整 PDF + 联系 `skywork-opensource@kunlun-inc.com` 确认。
- 模型权重协议独立于代码协议。

## 安全仓库列表(🟢)

可在保留 NOTICE 的前提下直接借鉴代码 / schema / 工程模式:

| 仓库 | License | 我们可能借鉴的内容(假设性,根据公开README/Tier 表估算) |
|---|---|---|
| **mastra-ai/mastra**(主代码) | Apache-2.0 | Agent 框架的 step / workflow / tool 抽象,memory 设计,Mastra Engine 与 Vercel AI SDK 的整合 |
| **langfuse/langfuse**(主代码) | MIT | Trace / observation / session / score 数据模型,LLM 成本统计字段,Prisma schema 模式 |
| **HBAI-Ltd/Toonflow-app** | Apache-2.0 | 漫画/动画生产流水线的 stage 划分、asset binding 思路 |
| **Forget-C/Jellyfish** | Apache-2.0 | 取决于实际定位(需后续 01-* 文档定位);Apache-2.0 给最大借鉴自由 |
| **Wan-Video/Wan2.2**(代码层) | Apache-2.0 | T2V/I2V 推理代码、配置组织;**模型权重协议另谈** |
| **xuanyustudio/LocalMiniDrama** | MIT | "本地化短剧"路线的工程思路、可能的 prompt 模板 |
| **HKUDS/ViMax** | MIT | 视频生成相关学术工程组织;研究向更多 |
| **A-cat-with-carrots/OnlyShot-ai-short-drama-skill** | MIT | "短剧技能"小型 demo 的 prompt / 流程蓝本 |
| **abhinavkale-dev/fynt** | MIT | 取决于实际定位;MIT 给最大借鉴自由 |

> **NOTICE 文件标准做法**:复用任何 Apache-2.0 / MIT / BSD 代码片段时,在 `docs/05a-third-party-licenses.md` 追加 entry(项目已有该文件),并保留原 copyright header。

## Phase 0 体检要点

- 14/14 仓库存活,**无下架 / archived / disabled**。
- 6 个 🟢、4 个 🟡(其中 mastra/langfuse 实际主代码 🟢)、4 个 🔴。
- 最重要的红线:**huobao-drama、BigBanana、deep-printfilm** 这三个"国产短剧/AI 视频生产平台"全是 🔴(CC-BY-NC-SA / Community License 禁商 / 无 LICENSE),**只能做产品形态调研,严禁代码层借鉴**。
- mastra / langfuse 是最安全且最有借鉴价值的 🟢(主代码 Apache/MIT),要做的就是绕开 ee/ 目录。
