# 项目任务清单 · StarsAlign Studio / 星垣工坊

> 最后更新:2026-06-10(**六七 · mac-mini 单日推进 M0+M1+M2′ 三里程碑 + 本地 TTS 全栈 + 美术两需求 + 两遍深审修 10 项**· 详见 [PROGRESS](PROGRESS.md))
> 仓库:https://github.com/henrywei2030/SS
> **🚀 一键启动**:`pnpm start`(详见 [README.md](README.md#快速启动) / [CLAUDE.md](CLAUDE.md#设备登记))
> **📖 主线蓝图**:[docs/06-feature-plan-2026H2.md](docs/06-feature-plan-2026H2.md)(M0–M6 可直接 coding;2026-06-10 mac-mini 逐项核对与代码一致)
> **📖 历史留尾参考**:[docs/W1-W7-followup.md](docs/W1-W7-followup.md)(2026-05-24 盘点,真未做散项已并入下方「工程卫生」区)

---

## 🚧 进行中

- [ ] **🎬 七功能 AIGC 增强路线图(M0–M6)**(规划定稿 mac-studio 2026-06-10 · **六七 mac-mini 单日推进 M0+M1+M2′ 三关全落地**,完整蓝图 [docs/06-feature-plan-2026H2.md](docs/06-feature-plan-2026H2.md))— ✅ **M0 基建**(job-queue 通用队列 + ffmpeg 封装 + 通知服务铃铛)/ ✅ **M1 成片**(EpisodeRender 表 + core/compose 时间线/SRT/concat/字幕/BGM + 成片 tab,真打 MP4+字幕)/ ✅ **M2′ 配音补强**(voiceMediaId 校验 + generateAudio 产品化 + 声线规范化,seedance 真打卡 token 401 待续)。**下一步:M3 关键帧+链式+QC**
- [ ] **🔊 本地 TTS 声线生成(MOSS-TTS-Nano · 六七 mac-mini)**— 用户追加需求,已完整闭环。零依赖系统内运行(onnxruntime-node + sentencepiece-js,**零 Python**),`packages/core/voice/` 移植官方 ONNX 推理;UI「按设定生成」→ 本地推理 → 自动写 voiceMediaId,真打 9.8s 样本零扣费。**留**:桌面打包带 .node + 845MB 权重策略(首跑 ModelScope 下载,.dmg/CI/win-laptop 验)/「从有声视频抽音轨反向采纳声线」补充功能
- [ ] **🖥️ 桌面程序化遗留**(Phase 1 去 infra ✅ + Phase 2 Mac .app/.dmg ✅ + Windows CI 绿出包 ✅,决策 ADR-35,完整历史见 PROGRESS 六二条)— 剩:① win-laptop 下载 CI artifact 真装真跑(**只能在 win-laptop 做**,出差时)② 桌面包 Mock 视频端到端真打 ③ 退出钩子加固(osascript quit → sidecar orphan,详见想法池)④ .dmg Finder 布局美化 / 自动更新流水线(低优)⑤ Developer ID + 公证(行政项,分发给别人才需要;自用 ad-hoc 签名已够)

---

## 📋 待办

### 🎬 主线里程碑队列(M0–M6 · 实施细节以 [docs/06](docs/06-feature-plan-2026H2.md) 为准)

- [x] **M0 基建**(六七 mac-mini):job-queue 通用队列(ss-jobs + kind 注册表 globalThis,bullmq/in-process 双驱动)+ ffmpeg-static + core/media/ffmpeg.ts + 通知服务 core/notify + tRPC + 铃铛。真打通
- [x] **M1 成片合成 F1**(六七 mac-mini):EpisodeRender 表(migration apply)+ core/compose(时间线/SRT/concat 1080p/字幕烧录回退/BGM ducking)+ kind compose + api + 成片 tab。真打:3 take→MP4+中文字幕烧录+SRT 对轴。修正台词源(Scene.content 非 shot.content)
- [x] **M2′ 配音补强 F3**(六七 mac-mini):voiceMediaId 校验 + generateAudio 产品化(setting+预估)+ normalizeAudio + 一键规范化。⚠️ seedance 真打卡 moyu token 401(退款验净 ¥0)→ 见真打债
- [ ] **M3 关键帧先行+链式+QC F2/F6**(~3 sessions,**下一步**):**3a** aigc.generateKeyframe(已编译组提示词走 seedream)+ confirmKeyframe(写组首 shot startFrameMediaId,钩子全在 **0 migration**;生成 N+1 关键帧以 N 作 img2img 参考收敛一致性)/ **3b** scene-aware 尾帧链(按 Shot.sceneId 分段同场景内可选链,ffmpeg 抽尾帧→下组首帧,**切场自动断链**,happyhorse-r2v 9 图参考备选)/ **3c** GenerationAttempt+qcScore/qcJson migration(⚠️ 单独点头)+ TextRequest 扩 imageUrls?(多模态判官)+ core/qc(抽首中尾帧→VLM 评分+人脸一致性对比)+ kind `qc`(take.qc.enabled 默认关)+ takes 画廊 QC 徽章/按分排序/漂移标记;**验收**:带/不带首帧对照一致性肉眼可辨,QC 给黑帧/跑题低分
- [ ] **M4+M5 整集批量+并抽/failover F4/F5**(~3.5 sessions,**先决重构**:generateVideo 主体下沉 core/video-generation/submit.ts(锁/sweep/占位/预算/编译/合规/入队,core 返判别 TRPCError 留 router),单点真打回归后再叠):**F4** batchGenerateForEpisode(待生成 groups → **成本预估强制确认弹窗** → Shot.priority S>A>B>C 排序 + 接 ScriptAnalysis.productionPlan)+ cancelQueuedForEpisode(退款复用 helper)+ 失败 retryable 自动重抽 ≤batch.retry.max + 批量工具条/总进度/完成全败**通知推手机**;**F5** seedance relay endpointStyle 泛化通用 relay 视频适配器(model 参数化)+ 并抽 providerIds?≤2(同事务双占位各 PREPAY,共享 groupId 对决)+ healthScore/lastErrorAt failover + shot.video.fallbackProviderIds + A/B 并排对比卡;第一家并抽 = happyhorse 或 kling-v2-6 / wan2.6(M5 实测定);**验收**:整集按优先级跑完+推送、预估实扣偏差 <10%、双模型并排、拔 key 自动 failover
- [ ] **M6 动态 Prompt 优化 F7**(~2.5 sessions):优化器层插在 token 编译器之前(优化器 = binding.storyboard.prompt.modelId = claude-opus-4-6,**预生成+缓存**写回 ShotGroup.prompt 人可审可改,binding 留空回退静态模板零风险)+ PromptTemplate 新 category PROMPT_OPTIMIZER(按目标 provider 自适应输出风格:seedance 叙事段/kling 关键词运镜/happyhorse 参考图×动作)+ **ContextContributor 可扩展架构**(首批 shot/assets/style/continuity 四个,SystemSetting prompt.optimizer.contributors 开关,新维度=加 contributor+开关核心不动;素材投喂走 Asset.profileJson 免迁移/多模态/VLM 转述)+ editHistory embedding 飞轮(text-embedding-v4 应用层余弦,向量存 Json 列桌面 PG 零障碍,top-3「AI 原文→人改后」few-shot)

> 全局约定(蓝图 §6):双形态(server/desktop)必过 · migration 逐个单独确认 · 新 binding KEY/设置进 seed.ts(db:sync 闭环)· 各里程碑结尾真扣费验证费用预先报备 · 每里程碑 typecheck+全测试套+收工记账可换机接续

### 🔥 真打验证债(贯穿,各里程碑结尾消化)

- [ ] docx 上传多集切分真打(六五修复后用户未回报;若集号写法非「第N集」需调 parseEpisodeBoundaries 规则)
- [ ] 视频生成端到端真打(Seedance 扣费,六四起留)+ 桌面包 Mock 视频端到端
- [ ] **seedance 配音透传真打**(六七卡 moyu token 401,退款已验净 ¥0):更新 token 后打 reference_audio/generate_audio;先点「自动 @」让 voiceMediaId 进 references。不支持则配音切 kling-v2-6
- [ ] **本地 TTS 桌面打包**(六七新增):onnxruntime-node .node 二进制 + 845MB 权重(首跑 ModelScope 下载)在 .dmg/CI 验 + win-laptop onnxruntime 预编译真跑
- [ ] 旗舰档二选一(六七定,v3 已确认不在 moyu):`kling-v2-6`(1.2元/s 音画同出) vs `wan2.6`(t2v/i2v 各 1.1元/s)— M5 真接时逐家实测后定
- [ ] happyhorse / kling / wan 经 moyu 请求形状逐家真打(M5:参数/轮询/响应解析)
- [ ] 其余模型价格按实际账单校齐(五八-fix 留:haiku/gemini/gpt-5.5/opus/gpt-image-2 仍是旧文档价,用到时核)

### 🧹 工程卫生(塞缝做 · 2026-06-10 六七核对收拢 — 碰到相关代码顺手清,不单独排期)

- [ ] Insight 补 2 卡片:项目费用 Top5 / API 用量明细(30天趋势/模型分布/抽卡率Top10 已有)
- [ ] PromptEdit 补 Project/Episode/Script `@@index` 反向索引
- [ ] storyboardRouter/assetRouter 集成测试(mergeShots/splitGroup/confirmCandidate 并发场景 — generate 已覆盖)
- [ ] parse.ts「时间:xxx」误识场景边界 case 测试
- [ ] OperationLog action 命名规范化(asset.create/image.generate 混风)+ 错误消息中英统一(用户面向中文/日志 code 英文)
- [ ] ~50 处硬编码颜色(emerald/rose/amber)→ CSS 变量跟主题
- [ ] CharacterRole enum 中文 → 英文 + UI label map(i18n 友好)
- [ ] DateTime locale 跟用户(现无全局处理)
- [ ] a11y:aria-label / focus trap / ESC 关闭(Dialog/img/icon-button)
- [ ] CandidateInfoDialog 大图 loading skeleton(慢网络体验)
- [ ] 预设模板 seed 数据(景别/机位/运镜/光线 — admin/presets UI 已有,seed 缺)
- [ ] `apps/web/public/logo.png` OG 分享图
- [ ] Invitation 邀请流程 UI(表/schema 已就绪,~300 行 router+UI+审批区)
- [ ] W5 worker 升级残项:L3 concurrency 从 ProviderConfig 动态读 / L5 providerJobId 断点续跑 / L6 typed Error 失败分类(L4 cancel:QUEUED 态由 M4 cancelQueuedForEpisode 吸收,RUNNING 态取消仍留)
- [ ] storyboard 生成后端限流 + SSE 流式进度(前端 3 并发池已有;关联想法池「拆解链路深度优化」②)
- [ ] EN 文案深度 review(低优)

### 👥 W8 团队实战(建议 M1 成片能力落地后启动)

- [ ] 5 人冷启动会议(分配集数)
- [ ] 完成至少 1 集 7 镜头实战
- [ ] 实战期 P0/P1 bug 紧急 sprint
- [ ] 实战反馈回灌 M 线排期

---

## ✅ 已完成

- 📦 **历史已完成项精简归档** — 完整记录见 [PROGRESS.md](PROGRESS.md) 与 `git log`
- 🧾 **2026-06-10 六七核对清出的过时待办**(判定证据见 PROGRESS 六七条):已完成未勾 — W4 真实 ImageProvider / W5.2 autoMatch / W5.3 takes 历史 / W5.4 BullMQ worker+SSE+轮询 / W5.5 素材库 / W6 数据总览 3 卡片·成员分配·报告 / W7 Prompt 编辑器·风格管理·Tauri 打包 / W8 审计 UI / README 徽章 / CHANGELOG / *.tsbuildinfo 入 gitignore / 单 shot 超长 merge.ts 已处理;作废 — W5.1 分镜级 4 列布局(被现 AIGC 工作台形态替代)/「环境与基础设施」4 项(mac-studio 已拉起多轮)/ packages/workers·apps/desktop 占位项(均已存在)

---

## 💡 想法池(idea backlog,暂不排期)

- **激活升级:签名授权码(2026-06-09 六四)** — 当前共享密钥(全机通用、无到期/吊销)。可升级 Ed25519 签名授权码:私钥离线出码(绑用户名/有效期)、app 内置公钥验签、每人/每机不同码;代码大部分复用,换校验逻辑 + 加出码脚本。
- **公开仓库下激活加固(2026-06-09 六四)** — 仓库 public → 激活哈希在公开源码(密钥 ~50-55bit、格式已知,执着攻击者约 1 天可破)。选项:换更长密钥 / 构建期 env 注入哈希(不入源码)/ 私有化仓库。密钥可随时轮换。
- **拆解链路深度优化(2026-06-09 mac-mini 真打后记,见 [PROGRESS](PROGRESS.md))** — ① 去重复生成(传已识别人物名给后续块、只补新人,省钱但块间串行)② 真·流式进度(token 边生成边推 UI,需 tRPC→SSE)③ 拆解绑更快模型(sonnet via moyu ~40 tok/s 是慢根,/admin/bindings 零代码换)
- **桌面退出钩子加固** — osascript/Apple Events `quit` 不触发 main.rs 整组 SIGTERM → sidecar(pg+web)orphan;确认 Cmd+Q/关窗是否覆盖,否则补退出清理
- **代码健康渐进优化(见 [ADR-31](docs/05-tech-decisions.md))** — 3 agent 审计结论:不是屎山,骨架优秀、局部有债。**已落地**:P0-1 fileToBase64 统一+修 bug(`3a001f0`)/ P1 pricing.ts 计费公式集中+12 测锁口径(`031314d`)/ P1 sanitizeErrorMsg 12 测锁脱敏(`c129192`)。**待续**:① P2 拆 god 文件(asset.ts 2636 等先抽 `*-shared` 再逐组移 procedure,每组 typecheck+test+计数校验)② P3 抽 `runGenerationAttempt`/`writeLedgerEntry` 收 13 处样板 + worker refund 改调已测 core ③ 删死 EventBus(0 订阅) ④ `resolveMediaFetchUrl` 收 media→URL ×3 ⑤ top-bar 导出器/批量池下沉。**原则**:逐块独立改动 + 验证,不在 live app 单次重排巨石
- **CRDT 实时协作**(yjs/Hocuspocus 分镜多光标/Presence,扩展到资产卡;现零基础)— Phase 2
- **火山合规 ComplianceProvider 自动化**(现 setComplianceManually 手动过渡可用;接 face check API 自动写 Asset.complianceId,~200 行 SDK+轮询)— Phase 2
- **资产关系图谱**(人物关系 / 场景空间相邻)— Phase 2
- **`packages/ui/` 跨 web/desktop 共享 UI 包** — Phase 2
- 视情况引入 issue 管理(GitHub Issues / Linear)
- 接入 LiteLLM 后统一所有 Provider 调用接口
- 引入 next-themes 替代手写 ThemeToggle(OS 偏好自动同步)
- 添加 ColorPicker 让企业租户自定义品牌色
- **Wireless Canvas(脑暴模式,画布拖拽分镜)** — Phase 3 旗舰
- 3D 一致性(Gaussian Splatting 数字分身)— Phase 3
- Distribution Hub(多平台发布 + 数据回流 ROI 分析)— Phase 3
- AI 多 Agent 对抗评审(Critic + Defender + Judge)— Phase 2
- Auto-Salvage 废片回收(从失败片段中截取可用段)— Phase 2
- 高对比 / 色弱友好 主题(无障碍)
- **PromptEdit 训练数据集导出工具**(fine-tune 数据管道)— W6+

---

> 📌 **使用说明**
> - `[ ]` 未完成 / `[x]` 已完成
> - 完成后从"进行中 / 待办"剪切到"已完成"，并标注完成日期
> - 新任务先进"待办"，开始做时再移到"进行中"
> - 每次收工时让 Claude 帮你更新本文件并重新上传到 Project 知识库
