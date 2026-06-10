# 06 · 七功能 AIGC 增强路线图(2026 H2)

> **状态**:规划定稿 2026-06-10(mac-studio),待开工 **M0**。
> 本文是可直接 coding 的开工蓝图。所有"已预留钩子"均经 2026-06-10 深审 + 开发文档时核实存在。
> 配套:`docs/DEVELOPMENT.md`(系统现状)、`docs/01-architecture.md`(分层蓝图)。

---

## 0. 范围与目标

把系统从「想法 → 镜头片段」补成「**想法 → 成片**」的全流程生产线,七个方向全做:

| 编号 | 方向 | 里程碑 |
|---|---|---|
| F1 | 成片合成(按集自动串片) | M1 |
| F2 | 角色/分镜一致性(关键帧先行 + 链式) | M3 |
| F3 | 配音(原生参考音频链路,**非外挂 TTS**) | M2′ |
| F4 | 整集批量流水线(按优先级调度) | M4 |
| F5 | 多模型并抽 + failover | M5 |
| F6 | Take 自动质检(VLM 预筛) | M3 |
| F7 | 动态 Prompt 优化(替代固定模板) | M6 |

---

## 1. 视频模型锁定(moyu)

**只用三家**,各司其职:

| 档位 | modelId | 用途 | 备注 |
|---|---|---|---|
| 快速出片 | `doubao-seedance-2-0-fast-260128` | 主力批量生成 | ⚠️ 描述仅 480p/720p · 4-15s,**未提音频/首尾帧** → 配音(F3)/首尾帧链(F2)在此模型上能否生效**必须 M2′/M3 真打验证** |
| 旗舰 | **`kling-v3`(用户指定目标)** | 高质量 / 人物一致性 | ⚠️ **moyu catalog 当前无 v3,最高 `kling-v2-6`(音画同出)**。M5 真接前若仍无 v3 → 回报 + 临时回落 `kling-v2-6` |
| 参考生视频 | `happyhorse-1.0-r2v`(+ i2v/t2v) | **强一致性主力**(最多 9 张参考图) | r2v 9 图参考是三家里最强的一致性手段 |

辅助模型(非视频):
- **优化器 LLM**:`claude-opus-4-6`(用户指定,质量优先)
- **图像/关键帧**:`doubao-seedream-4-5`(主体/编辑一致性)
- **VLM 质检**:`gemini-2.5-flash`(便宜)/ `qwen3-vl-flash`
- **Embedding**:`text-embedding-v4`(动态 prompt 检索)

---

## 2. 决策记录

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| D1 | 配音方式 | **原生参考音频链路**(非独立 TTS 管线) | `Asset.voiceMediaId` → `refAudioUrls` → 模型已全通(五八+r13);模型原生配音免费口型同步;外挂 TTS 是造平行轮子 |
| D2 | 一致性主路 | **关键帧先行(animatic)**,尾帧链做可选开关 | 图层先收敛便宜可审;链干净关键帧而非模糊尾帧防误差累积 |
| D3 | 动态 prompt 触发 | **预生成 + 缓存**(写回 ShotGroup.prompt) | 省 LLM 钱 + 人可审可改 + PromptEdit 捕获人改喂飞轮 |
| D4 | 优化器模型 | **claude-opus-4-6** | 用户指定质量优先;预生成+缓存每组只优化一次,贵档成本可控 |
| D5 | 第二/三视频模型 | kling-v3(目标)/ happyhorse | 见 §1 |
| D6 | QC 默认 | **关**(`take.qc.enabled=false`) | 真打核成本后再开 |
| D7 | 批量前成本确认 | **强制弹窗** | 防一键烧钱 |
| D8 | pgvector 替代 | **应用层 embedding 余弦**(普通 Json 列) | 桌面嵌入式 PG 装不了 pgvector;项目内候选集小,应用层够用 |

---

## 3. 里程碑

### M0 · 公共基建(~1 session)
- **通用任务队列** `packages/queue/src/job-queue.ts`:单队列 `ss-jobs` + `{kind, data}` + 按 kind 的 handler 注册表(globalThis 防 standalone 分裂,沿用 progress-bus 模式);bullmq/in-process 双驱动。**现有 video-gen 队列不动**(资金路径)。
- **ffmpeg**:`ffmpeg-static`(三平台二进制,desktop-pack 平铺天然带上,Mac 包体 +~75MB);`packages/core/media/ffmpeg.ts` 封装 concat / 抽帧 / 混音 / ffprobe 时长。
- **通知服务**:`Notification` 表已存在零代码用 → `packages/core/notify/`(insert + 可选 webhook,URL 存 `notify.webhook.url`,飞书/Bark 通用 JSON)+ tRPC `notification.*` + top-nav 铃铛(30s 轮询)。
- 验收:job-queue kind 路由 / notify 落库 + webhook。

### M1 · F1 成片合成(~2 sessions)
- DB:**新表 `EpisodeRender`**(episodeId/status/mediaId/srtMediaId/paramsJson/errorMsg/createdBy)→ migration。
- core `core/compose/`:时间线(按 group.positionIdx 取已采纳 take,缺口列 `gaps`)+ SRT(台词用剧本解析同款正则从 shot.content 提,时间按 ffprobe 实测累加)+ ffmpeg concat(统一 1080p 目标比例)+ 字幕烧录 + **BGM 混音(对白 ducking)**。
- queue 新 kind `compose`;api `compose.renderEpisode(allowGaps?)` / `listRenders`;web aigc 集工作台「成片」tab。
- 验收:一集 ≥3 采纳 take → MP4 可播、字幕对轴、桌面态同样可用。

### M2′ · F3 原生配音链路补强(~0.5–1 session)
> 不造新管线,只补已建链路的漏:
- 核查 autoMatch / 手动 bind 是否同 autoFill 自动带 `voiceMediaId`,缺则补。
- `generateAudio` 产品化:默认值进 setting,生成对话框明示有声单价差(计入预扣估算)。
- 声线字段加规范提示 + ffmpeg「裁剪 + 响度归一」小工具。
- ⚠️ **真打验证 seedance-2.0-fast 是否透传 reference_audio / generate_audio**;不支持则配音主力改 `kling-v2-6`(音画同出),并回报。

### M3 · F2 关键帧先行 + 链式 + F6 质检(~3 sessions)
- **3a 关键帧**(钩子全在:`Shot.startFrameMediaId` ADR-23 ✓、`VideoRequest.firstFrameUrl` ✓):`aigc.generateKeyframe`(用已编译组提示词走 seedream → 候选)+ `confirmKeyframe`(写组首 shot startFrameMediaId,**0 migration**);**生成 N+1 关键帧时把 N 关键帧作 img2img 参考**(图层收敛一致性)。
- **3b 链式**(scene-aware):按 `Shot.sceneId` 分段,**同场景内**可选尾帧链(ffmpeg 抽 N 采纳 take 尾帧 → N+1 首帧);**切场自动断链**;happyhorse-r2v 9 图参考作多参考备选。
- **3c 质检**:`GenerationAttempt + qcScore/qcJson` → migration;**TextRequest 扩 `imageUrls?`**(多模态判官);`core/qc/`(ffmpeg 抽首/中/尾帧 → VLM 评分 + 人脸一致性对比 portrait);新 kind `qc`,process-job 成功末尾入队(`take.qc.enabled` 默认关);web takes 画廊 QC 徽章 + 按分排序 + 漂移标记。
- 验收:带/不带首帧对照一致性肉眼可辨;QC 给黑帧/跑题低分。

### M4 + M5 · F4 批量 + F5 并抽/failover(~3.5 sessions)
- **先决重构**:`generateVideo` 主体下沉 `core/video-generation/submit.ts`(锁/sweep/占位/预算/编译/合规/入队),core 返判别、TRPCError 留 router(同 stale-sweep 分层纪律)。单点真打回归后再叠加。
- **F4**:`batchGenerateForEpisode`(待生成 groups → **成本预估强制确认** → 按 `Shot.priority` S>A>B>C 排序,**接上 `ScriptAnalysis.productionPlan`**)+ `cancelQueuedForEpisode`(退款复用 helper)+ 失败 retryable 自动重抽 ≤ `batch.retry.max`;web 批量工具条 + 总进度 + 完成/全败**通知推手机**。
- **F5**:seedance relay endpointStyle **泛化为通用 relay 视频适配器**(model 参数化);并抽 `providerIds?:string[]`(≤2,同事务双占位各 PREPAY,共享 `GenerationAttempt.groupId` 对决标记 ✓);failover 用 `healthScore`/`lastErrorAt`(✓ 预留)+ `shot.video.fallbackProviderIds`;web A/B 并排对比卡。
- **第一家并抽 = happyhorse 或 kling**(待 §1 kling 版本落定);各家经 moyu 请求形状逐家真打。
- 验收:整集按优先级跑完 + 推送;预估与实扣偏差 <10%;双模型并排;拔 key 自动 failover。

### M6 · F7 动态 Prompt 优化(~2.5 sessions)
见 §5。

---

## 4. 跨分镜一致性方案(四层)

> 核心:**关键帧先行(animatic 流)+ 场内链式;链干净关键帧,不链模糊尾帧。**

1. **关键帧先行**:每组先用 seedream 出首帧;生成 N+1 关键帧时把 N 关键帧作 img2img 参考 + 角色三视图 → 一致性图层先收敛(便宜、可审、可重抽);整集关键帧序列 = 动态分镜表,确认后才批量 i2v 烧视频钱。
2. **场内首尾帧链**:按 `Shot.sceneId` 分段,同场景相邻组可选尾帧链;**切场自动断链**。⚠️ seedance-2.0-fast 首尾帧支持待真打;happyhorse-i2v 兜底。
3. **误差累积防护**:链优先用干净关键帧;QC 一致性分超阈值自动断链回锚资产参考图;happyhorse-r2v(9 图)作强一致性档。
4. **衔接注记**:分镜/优化器对组边界产出"承接说明"(人物位置/朝向/光线/动作余势)→ 编译进下组 prompt 头("接上镜:…")。

---

## 5. 动态 Prompt 优化(替代固定模板)

### 5.1 优化器层(动态生成)
现有 token 编译器**之前**插「优化器 LLM」,产物写回 `ShotGroup.prompt` → 再走原 `compileShotGroupVideoPrompt`(已有 `extraInstruction` 注入位)。

```
分镜结构化字段 + 绑定资产设定 + 项目风格 + 上组衔接注记 + few-shot
   │  优化器 = binding.storyboard.prompt.modelId(已存在)= claude-opus-4-6
   ▼  动态 prompt 正文 + 建议负面词 + 给下组的衔接注记
ShotGroup.prompt(人可审可改) → compileShotGroupVideoPrompt → promptCompiled 下发
```
- **触发**:预生成 + 缓存(点「优化本组/整集」)。
- **模型自适应**:优化器按目标 providerId 切输出风格(seedance 偏叙事段 / kling 偏关键词+运镜 / happyhorse-r2v 偏参考图×动作)→ 存 PromptTemplate(新增 category `PROMPT_OPTIMIZER`)。
- **开关**:binding 留空 = 回退现有静态模板,零风险。

### 5.2 可扩展架构 — ContextContributor 模式
**不把"喂什么"硬编码进优化器**:

```ts
interface PromptContextContributor {
  key: string;      // 'shot'|'assets'|'style'|'continuity'|'worldbook'|'refMedia'|'editHistory'
  order: number;
  enabled: boolean; // 来自 SystemSetting,admin 可开关
  render(ctx): Promise<string | MultiModalPart>; // 文本 或 多模态 part
}
```
优化器 = 收集启用的 contributor → 按 order 拼 meta-prompt → 调 LLM。
**新增维度 = 新增一个 contributor 文件 + 一个开关,核心不动。**

**扩展三类**:
| 要加什么 | 怎么加(轻→重) |
|---|---|
| 结构化新字段 | **先塞 `Asset.profileJson`(Json 列,免 migration)** → contributor 读 → 高频稳定才升正式列 |
| 投喂素材(图/视频/音频) | a) 多模态优化器直接吃(image_url part,用 gemini/qwen-vl)b) VLM 转描述注入(复用 M3 VLM,便宜可缓存)|
| 维度开关/顺序/权重 | `SystemSetting prompt.optimizer.contributors`,admin 配,不改代码 |

### 5.3 编辑反馈飞轮(embedding few-shot)
`editHistory` contributor:moyu `text-embedding-v4` 把当前分镜 embed → 余弦排序项目内 `PromptEdit`(向量存普通 Json 列,**桌面 PG 零障碍**)→ top-3「AI 原文→人改后」few-shot 注入。

### 5.4 落地
首批 4 contributor(shot/assets/style/continuity)→ 第二批(editHistory/refMedia 可独立收工)。M6 ~2.5 sessions。

---

## 6. 全局约定
1. **双形态必过**:server(BullMQ/Redis/MinIO)+ desktop(in-process/local-fs/嵌入 PG)各验;新单例一律 globalThis。
2. **migration 逐个单独确认**(M1 EpisodeRender / M3 qc 字段,各提交时停等点头)。
3. **新 binding KEY / 设置进 seed.ts**(db:sync 跨机闭环)+ admin/bindings 注册表同步。
4. 真扣费验证(seedance/kling/happyhorse/opus/VLM)各里程碑结尾真打一次,费用预先报备。
5. 每里程碑:typecheck + 全测试套 + 收工记账,可独立中断/换机接续。

---

## 7. 风险与真打验证清单
- ⚠️ **seedance-2.0-fast 音频/首尾帧**:描述未提 → M2′/M3 真打;不支持则配音改 kling-v2-6、首尾帧链改 happyhorse-i2v。
- ⚠️ **kling v3 不存在于 moyu**:M5 真接前确认;无则回落 v2-6 并回报。
- ⚠️ **happyhorse / kling 经 moyu 的请求形状未知**:M5 逐家真打(参数/轮询/响应解析)。
- opus-4-6 优化器成本:预生成+缓存缓解;监控 ledger,必要时降便宜档。

---

## 8. 排期
```
M0 基建(1) → M1 成片(2) → M2′ 配音(0.5-1) → M3 关键帧+链式+QC(3)
            → [submit 下沉] → M4 批量 + M5 并抽(3.5) → M6 动态 prompt(2.5)
总计约 12-13 sessions
```
依赖:M4/M5 依赖 submit 下沉;M3 链式依赖 M0 ffmpeg;M6 editHistory 依赖 embedding。
