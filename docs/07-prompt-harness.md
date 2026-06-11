# 07 · Prompt Mini-Harness:八维知识库 × 提示词装配流水线

> 状态:**H0–H3 代码全部落地**(2026-06-11 七一 mac-studio 单日四期连推;方案定稿同日 七十)
> 留:真打 gate 顺验(✨硬门/✨✨判官修复/体检卡/知识痕迹/±强化词 A/B/分镜 v3 对照)+ H3 飞轮持续运营(权重随真打数据演化)
> 前置阅读:[docs/06-feature-plan-2026H2.md](06-feature-plan-2026H2.md) §5(M6 动态 Prompt,已落地 M6a/b)
> 本文档取代 06 蓝图中的 **M6c**(embedding 飞轮并入本文 H3,作其超集)

---

## 0. 背景与方法论来源

外部输入:公众号实战文章(Seedance 提示词方法论,用户 2026-06-11 提供正文),核心三件:

1. **八要素万能公式**:`主体 + 动作 + 场景 + 光影 + 镜头语言 + 风格 + 画质 + 约束` — 少一个,AI 按默认值填充,产出"平均水准"。
2. **时间轴切片**:15s 切 4 段(0-3 全景交代 → 3-7 中景动作 → 7-11 特写情绪 → 11-15 收尾转折),每 3-4 秒一个节奏点;"全景→中景→特写→拉远"黄金结构,禁一镜到底。
3. **强化词 = 质量保险丝**(五类):画质(4K超高清/电影质感/细节丰富/胶片颗粒感)、稳定(面部清晰不变形/人体比例自然/动作流畅连贯无跳帧/五官一致)、光影(暖黄逆光/丁达尔效应/月光冷色调)、氛围(治愈清新/紧张压抑/肃杀冷峻)、风格(水墨动漫风/吉卜力/新海诚)。省掉强化词 ≈ 10 条 7 返工。

避坑五条:抽象词必须翻译成具体画面("紧张"→"手在油灯下颤抖着揭开木板");动作写到声音/触感级;强化词不可省;15s 内 3-4 个节奏点;年代细节自己写死("1942 年华北农村"),AI 不懂历史。

作者声称效果:出片率 30%→80%+。**我们有作者没有的东西:M3c qcScore 可把这个声称变成可量化实验。**

## 1. 现状对账(八要素 × 系统,2026-06-11 真实代码走查)

| # | 要素 | 系统现状 | 判定 |
|---|---|---|---|
| 1 | 主体 | 资产体系 + @token + 形象图/三视图全投喂 | ✅ 超越文章(图锚定) |
| 2 | 动作 | shot.content 30 字,无微观死磕纪律 | ⚠️ 半缺 |
| 3 | 场景 | Scene 时段/地点/原文;**年代世界观无结构化来源** | ⚠️ 半缺 |
| 4 | 光影 | shot.lighting + storyboard_main v2 光影章 | ✅ |
| 5 | 镜头语言 | framing/angle/movement + 轴线/动接动原则 | ✅ 最强项 |
| 6 | 风格 | StyleProfile 三件套 + M6 按模型家族自适应 | ✅ |
| 7 | 画质 | **全缺** — 编译链不产画质词 | ❌ |
| 8 | 约束 | 仅负面词/合规;稳定类强化词无系统位 | ❌ |
| ⏱ | 时间轴 | **每镜 durationS 数据全有,从未送进 prompt** | 🔥 最大金矿 |

## 2. 目标架构:五段装配流水线(mini-harness)

把 M6 单 pass 优化器升级为确定性编排的流水线,LLM 只出现在 1/3/4 三个角色:

```
1. Planner      本组哪几维是重点 + 每维检索 query
                (H1 用确定性规则:夜戏→光影/绑定人物→约束…;LLM Planner 为后续升级开关)
2. Retriever    PromptKnowledge 八维逐维 top-k≤3(余弦;过滤:模型家族/项目/风格/年代 tags)
3. Composer     现有 M6 优化器(contributor 上下文 + 检索片段 → 八要素+时间轴改写)
4. Checkers     硬门(确定性,一票否决):@token 保全✓已有 / 时长加总 / 禁用词 / 抽象词黑名单 / 长度
                软门(LLM 判官,advisory):八维逐项打分 + 缺失清单 → 只决定"修哪维"
5. Repair       定向修复 ≤2 轮(只喂不及格维度+对应片段,不整体重写)
→ 写回 ShotGroup.prompt(人可审可改) + 落 PromptOptimizeRun 八维体检报告
```

## 3. 数据模型(新表 ×2,migration 逐个点头)

**PromptKnowledge**(八维知识库,单表多维)— **已落地(七一),实际字段**:
`id / dimension(八维枚举) / slug?(@unique,种子条目锚) / title / content / tagsJson(family/style/mood/era/keywords) / embedding Json?(懒回填) / embeddingModel?(换模型识别旧向量重算) / projectId?(null=全局,非空=项目私有世界观) / source(SEED|MANUAL|MINED) / enabled / hitCount / lastUsedAt / weight(H3 飞轮权重,clamp 0.2-2) / createdBy`

**PromptOptimizeRun**(体检报告/审计/飞轮数据源)— **已落地(七一),实际字段**:
`id / groupId / episodeId / projectId / userId / stagesJson(composer/judge/repair 各自 model+tokens+cost+targets) / dimScoresJson?(八维分+issue,判官缺席 null) / fragmentIds String[] / iterations / applied / denyCode? / totalCostCny / createdAt`(纯 id 关联无 FK,同 PromptEdit 模式)

种子语料 v1 = **83 条已落库**:文章强化词五类(QUALITY 8/CONSTRAINT 10/LIGHTING 12/SCENE 10/STYLE 8)、抽象词翻译对(ACTION 15)、运镜语法/轴线规则自 v2 模板蒸馏(CAMERA 14)、主体锚定纪律(SUBJECT 6);db:sync 按 slug 增量,admin 改过的不覆盖。

## 4. 真实代码走查修正点(2026-06-11 第二轮,地基事实)

1. **时间轴不解析正文**:`[i/N]` 只是 mergeShots 默认拼接([storyboard-group.ts:113](../packages/api/src/routers/storyboard-group.ts))的显示约定,手编/promptOverride/AI 优化都会破坏它。改为 `compileShotGroupVideoPrompt`(纯 parts 拼装,[video.ts:224](../packages/core/storyboard/video.ts))新增 **timelinePart 结构段**,从 Shot 表 durationS 累加生成 `【时间轴】0-3s 全景·固定·低调 | 3-7s …`,正文零接触,三态(默认/手编/已优化)统一生效;preview/keyframe 复用 parts 真相源自动受益。enhancerPart(强化词段)同理。
2. **mergeShots 默认拼接捡漏**:现只带 framing/angle,**movement/lighting/sound/durationS 从未进组 prompt 正文** — 升级默认拼接行(≈5 行改动),未优化组信息密度立即抬升。
3. **embedding 接口已预留**:`ProviderKind` 含 'embedding'([types.ts:12](../packages/adapters/provider/types.ts))— 补 `ITextEmbeddingProvider` + openai-compat `/embeddings` + registry 分支即可。
4. **H1 零核心改动**:M6 contributors 为 async render(ctx) 且 ctx 带 prisma — 八维检索 = **一个** knowledge contributor 文件,现有 CSV 开关直接管;"八个独立 RAG"的隔离在 dimension 列 + 检索过滤,不在物理拆分。
5. **种子 embedding 懒加载**:seed/db:sync 须在无 API key/离线可跑 → 条目 embedding=null 入库,首次检索批量补算回填;未配 embedding binding 时降级 tags+关键词检索。
6. **记账收口**:planner/composer/judge/repair 统一 `action='prompt.optimize'`(文本日预算池两处过滤已含,不再扩),阶段明细进 run 表。

## 5. 分期(每期独立可验,与真打 gate 并行 — 不碰资金路径)

> **落地记录(2026-06-11 七一,单日四期)**:全部 ✅;各期"真打"类验收项移交 gate 顺验。

| 期 | 内容 | 量 | 验收 |
|---|---|---|---|
| **H0 基座** ✅ | ① timelinePart + enhancerPart(`prompt.enhancer.quality`/`prompt.enhancer.stability` 设置,默认=文章模板,留空关闭) ② mergeShots 默认拼接补全维(共享 `buildGroupShotLine`,手动/autoMerge 统一) ③ PromptKnowledge 表 + 种子 83 条 ④ ITextEmbeddingProvider(openai-compat /embeddings)+ 懒回填 + 检索纯函数(余弦/keyword/tag 三档降级链,单测) | 1 会话 · migration ×1 ✅ | 编译预览见时间轴+强化词 ✅(真实组实测);检索单测绿 ✅;真打 A/B(±强化词 qcScore)→ gate |
| **H1 检索进流水线** ✅ | knowledge contributor ×1(CSV 默认五件套)+ 确定性 Planner(`allowTagFallback` 闸:通用维 tag 兜底/对症维宁缺毋滥;LLM Planner 留 `harness.planner.enabled` 升级位)+ 分镜侧轻量注入(`buildSceneKnowledgeBlock`:项目世界观无条件 + 全局对症,零 embedding 外呼)+ **storyboard_main v3**(写作三纪律三章 + 自查⑥,版本化 db:sync 自动生效) | 1 会话 | 优化产物含检索语料痕迹 ✅(contributor 真实组实测对症命中);分镜 v3 真打一场对照 → gate |
| **H2 判官+修复闭环** ✅ | 硬门五门 checkers(token/时长加总/禁用词/抽象词黑名单/长度,一票否决,违规全收集)+ 八维判官(`binding.prompt.judge.modelId` 独立;输出消毒:known dims/clamp/repairDims 自推不信模型自报)+ 定向 Repair ≤2 轮(只喂不及格维+片段;软门修复过不了硬门即丢弃保上一版)+ PromptOptimizeRun 表 + 工坊八维体检卡 + 「✨✨深度优化」入口。**延迟分档**:单组✨同步=Composer+硬门(秒级);判官+修复仅整集✨ job 与单组✨✨(同 kind,payload.groupId 区分) | 1 会话 · migration ×1 ✅(与 weight 合并) | 体检卡可见 ✅(UI 落地);故意喂缺维 → 判官命中 → repair 补齐 → gate(需 LLM) |
| **H3 飞轮** ✅(机制) | 回路① PromptEdit「AI→人改」配对 → LLM 蒸馏候选(`minePromptEditCandidates`,admin /admin/knowledge「⛏️蒸馏」触发,enabled=false 待审)/ 回路② run.fragmentIds × qcScore 权重 ±0.05 clamp[0.2,2](qc 落分钩子,7 天归因窗)/ 回路③ QC 漂移按模型家族沉淀 CONSTRAINT 候选(幂等 upsert,hitCount=证据数)。admin 知识库管理页(筛选/启停/编辑/删除/候选审核) | 1 会话起,持续 | 候选条目出现在 admin ✅(漂移沉淀实测);权重随真打数据变化 ✅(机制实测 ±0.05,长期演化靠真打累积) |

成本预报备:全流程 ≈ ¥0.03-0.12/组(Planner≈0 确定性 + embedding ¥0.0005 + Composer ¥0.02-0.05 + 判官 ¥0.005 + 修复 0-2 轮),整集 30 组 ¥1-4,走文本日预算池,整集照旧后台 job+铃铛。

**退化阶梯**(每档可用):无知识库=现状 → 有库无向量=tags+关键词检索 → 有向量=语义检索 → 开判官=闭环修复。

## 6. 决策记录

- **D-A 单表多维**,不做 8 个物理库;不复用 PROMPT_FRAGMENT(PromptTemplate 无 embedding/tags/projectId,slug+versionTag 唯一约束形状不合)。
- **D-B 种子语料从文章+v2 模板蒸馏**,按模型家族打 tag;embedding 懒回填(离线/无 key 可 seed)。
- **D-C 判官 advisory、硬门 gate**:八维判官只决定修哪维,永不单独否决写回(qcScore 不可信信号纪律平移 — 提示词正文可注入);token/时长/禁用词硬门一票否决。
- **D-D 飞轮三回路**:人改蒸馏(admin 审核)/ qcScore 相关性权重 / 家族雷点沉淀 — 静态方法论 → 随项目与模型进化的私有知识资产。
- **D-E 项目级世界观 = projectId 作用域的场景维条目**(不动 Project schema)。
- **D-F 已拍板默认**:判官独立 binding(`binding.prompt.judge.modelId`);修复上限 2;storyboard_main v3 并入 H1。

## 7. 与既有规划的关系

- **吸收 06 蓝图 M6c**(embedding 飞轮)为 H3 超集;吸收想法池「AI 多 Agent 对抗评审」的收敛版(判官+修复即其 scoped 形态)。
- 与**真打回归 gate**(TODO 真打债置顶)并行:H0-H2 不碰资金路径;gate 真打时顺带验 timelinePart/强化词/✨优化。
- F5b(并抽/failover)仍压 gate 后,与本线独立。
