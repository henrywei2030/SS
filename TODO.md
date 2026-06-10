# 项目任务清单 · StarsAlign Studio / 星垣工坊

> 最后更新:2026-06-11(**七十 · mac-studio:M6a/b 动态 Prompt 优化落地(优化器+ContextContributor+整集后台 job)+ 八要素文章研读 + 八维 Prompt Mini-Harness 方案定稿落盘 [docs/07](docs/07-prompt-harness.md)**· 详见 [PROGRESS](PROGRESS.md))
> 仓库:https://github.com/henrywei2030/SS
> **🚀 一键启动**:`pnpm start`(详见 [README.md](README.md#快速启动) / [CLAUDE.md](CLAUDE.md#设备登记))
> **📖 主线蓝图**:[docs/06-feature-plan-2026H2.md](docs/06-feature-plan-2026H2.md)(M0–M6 可直接 coding;2026-06-10 mac-mini 逐项核对与代码一致)
> **📖 历史留尾参考**:[docs/W1-W7-followup.md](docs/W1-W7-followup.md)(2026-05-24 盘点,真未做散项已并入下方「工程卫生」区)

---

## 🚧 进行中

- [ ] **🎬 七功能 AIGC 增强路线图(M0–M6)**(蓝图 [docs/06](docs/06-feature-plan-2026H2.md))— ✅ M0 基建 / ✅ M1 成片 / ✅ M2′ 配音补强(均六七)/ ✅ **M3 全清**(3a/3b 六八真打通 + 3c QC 六九)/ ✅ **M4 先决重构 + F4 整集批量**(六九)/ ✅ F5a relay 泛化(六九)/ ✅ **M6a/b 动态 Prompt 优化**(七十:优化器层+ContextContributor 四件套+单组✨/整集后台 job;M6c 并入 docs/07 H3)。**剩:真打回归 gate**(见真打债置顶)→ gate 后 **F5b 并抽/failover**
- [ ] **🧠 Prompt Mini-Harness(八维知识库 × 装配流水线)**(方案定稿 七十,完整蓝图 [docs/07-prompt-harness.md](docs/07-prompt-harness.md) — 八要素方法论 × 系统对账 + 6 个真实代码修正点 + ADR D-A~D-F)— **下一步 H0 基座**(timelinePart/enhancerPart 编译段 + mergeShots 默认拼接补全维 + PromptKnowledge 表&种子语料&懒 embedding + 检索纯函数;1 会话,migration ×1,不碰资金路径可与真打 gate 并行)→ H1 检索进流水线+storyboard v3 → H2 判官+修复闭环 → H3 飞轮
- [ ] **🔊 本地 TTS 声线生成(MOSS-TTS-Nano)**— 六七闭环,**六八三需求加固**:声音设定→推荐种子声线(manifest 真元数据表)/ 人到声必到(voiceRefs 绕 token 闸,旧五七-3 链实为双重失效)/ 批量按设定生成(主演配角 27 人 3.5min 零扣费,群演按用户定调排除)/ relay 同步开关(默认关防死资产)。**留**:桌面包权重首跑 ModelScope 下载验证(.dmg 依赖已修齐,见六八)/ win-laptop onnxruntime 真跑 /「从有声视频抽音轨反向采纳声线」
- [ ] **🖥️ 桌面程序化遗留**(ADR-35;六八:**dmg 缺四原生依赖的六七债已修**(依赖闭包补包+darwin-arm64 裁剪,238M 残→300M 全)+ 构建隔离 .next-desktop(打包不再打断 dev server))— 剩:① win-laptop CI artifact 真装真跑(出差时)② 桌面包 Mock 视频端到端 + TTS 权重首跑真打 ③ 退出钩子加固 ④ .dmg Finder 美化/自动更新(低优)⑤ Developer ID + 公证(分发才需要)

---

## 📋 待办

### 🎬 主线里程碑队列(M0–M6 · 实施细节以 [docs/06](docs/06-feature-plan-2026H2.md) 为准)

- [x] **M0 基建**(六七 mac-mini):job-queue 通用队列(ss-jobs + kind 注册表 globalThis,bullmq/in-process 双驱动)+ ffmpeg-static + core/media/ffmpeg.ts + 通知服务 core/notify + tRPC + 铃铛。真打通
- [x] **M1 成片合成 F1**(六七 mac-mini):EpisodeRender 表(migration apply)+ core/compose(时间线/SRT/concat 1080p/字幕烧录回退/BGM ducking)+ kind compose + api + 成片 tab。真打:3 take→MP4+中文字幕烧录+SRT 对轴。修正台词源(Scene.content 非 shot.content)
- [x] **M2′ 配音补强 F3**(六七 mac-mini):voiceMediaId 校验 + generateAudio 产品化(setting+预估)+ normalizeAudio + 一键规范化。⚠️ seedance 真打卡 moyu token 401(退款验净 ¥0)→ 见真打债
- [x] **M3 关键帧先行+链式+QC F2/F6**(3a/3b 六八 mac-studio 真打通;**3c 六九 mac-studio 落地**):3a generateKeyframe/confirmKeyframe + N-1 参考收敛 ✅(真打 ¥0.3)/ 3b 尾帧链(抽尾帧→下组首帧,切场拒绝)✅ 真打通 / **3c QC** ✅:qcScore/qcJson migration(点头应用)+ TextRequest.imageUrls 多模态(openai-compat image_url parts / claude base64 source,base64 内联绕开本地存储公网不可达)+ core/qc(下载 take→ffmpeg 抽首/中/尾帧 ≤768px→连同绑定人物形象图(≤2 张/3MB 上限)喂 VLM 判官→评分落库+qc.evaluate 记账;失败不抛 qcJson.error)+ kind `qc`(take.qc.enabled 默认关 + binding.shot.qc.modelId,均进 seed)+ takes 徽章(色阶/⚠漂移/失败/评分中)+按分排序+轮询窗。**留真打**:配视觉模型 binding 后验收"黑帧/跑题低分"(见真打债置顶)
- [ ] **M4+M5 整集批量+并抽/failover F4/F5**(六九 mac-studio:**先决重构 ✅ + F4 ✅ + F5a ✅,剩 F5b**):~~先决重构~~ ✅ generateVideo 主体下沉 core/video-generation/submit.ts(锁/sweep/占位+PREPAY/gacha/预算/编译/合规/能力门/入队,core 返判别 deny(占位已 FAILED+REFUND 退净)、TRPCError 留 router;906→571 行,机械对账零漂移)/ ~~**F4**~~ ✅ estimateBatchForEpisode(逐组报价与 PREPAY 同公式)+ batchGenerateForEpisode(**成本确认强制闭环**:confirmTotalCny+confirmGroupIds 双比对防陈旧报价与等额换组;S>A>B>C 排序,shot 优先级缺失回退 ScriptAnalysis.productionPlan 场级(Scene.number 解析防删场错位);BUDGET 止损;2/min 限频)+ cancelQueuedForEpisode(只摘 BullMQ waiting → CANCELLED+退款归原提交者,先落库后摘 job;worker CANCELLED 幂等门兜底)+ 失败 retryable 自动重抽 ≤batch.retry.max(默认 0,clamp≤3,startedAt 过滤)+ 批次完成/全败**通知推手机**(落库+webhook,advisory lock+payload.batchId 判重)+ 批量工具条/确认弹窗/进度横幅/取消 / ~~F5a~~ ✅ relay 视频适配器泛化(admin 配 `adapter:'relay-video'` 即把 kling/wan 等任意 moyu 视频模型零代码接入,形状以 M5 真打为准)。**剩 F5b(真打 gate 后)**:并抽 providerIds?≤2(同事务双占位各 PREPAY,共享 groupId 对决)+ healthScore/lastErrorAt failover + shot.video.fallbackProviderIds + A/B 并排对比卡;第一家并抽 = happyhorse 或 kling-v2-6 / wan2.6(M5 实测定);**验收**:整集按优先级跑完+推送、预估实扣偏差 <10%、双模型并排、拔 key 自动 failover
- [x] **M6a/b 动态 Prompt 优化 F7**(七十 mac-studio):优化器层 ✅(binding.storyboard.prompt.modelId 启用,留空=关闭零风险;**@token 保全守卫**丢一拒回;乐观锁防覆盖人工编辑;normalize+PromptEdit `[AI优化]` 标记+prompt.optimize 记账并入文本日预算池)+ PROMPT_OPTIMIZER 模板(enum migration 点头,DB 模板+core 兜底双写)+ **ContextContributor 架构** ✅(shot/assets/style/continuity 四件套,CSV 开关,按目标模型家族 seedance/kling/happyhorse 自适应文风)+ 单组✨同步/整集✨后台 job(铃铛通知,jobId 同集去重)。**M6c(embedding 飞轮)并入 [docs/07](docs/07-prompt-harness.md) H3 作超集**。留真打:✨优化按钮(token 保全/写回/乐观锁,可并入 gate 顺验)

> 全局约定(蓝图 §6):双形态(server/desktop)必过 · migration 逐个单独确认 · 新 binding KEY/设置进 seed.ts(db:sync 闭环)· 各里程碑结尾真扣费验证费用预先报备 · 每里程碑 typecheck+全测试套+收工记账可换机接续

### 🔥 真打验证债(贯穿,各里程碑结尾消化)

- [ ] **🎯 六九真打回归 gate 三连+一(置顶,一次整集批量可全验;过 gate 才叠 F5b)**:① 单点抽卡 1 次(验 M4 submit 下沉:出片+扣费/退差正常)→ ② `/admin/bindings` 配 `binding.shot.qc.modelId`(视觉模型如 relay-gemini-3-flash)+ 系统设置开 `take.qc.enabled` → 看 takes QC 徽章出分(验 M3c;验收口径:黑帧/跑题低分、换脸标漂移;费用 ≈¥0.01-0.05/take)→ ③ 工作台「批量生成」走确认弹窗整集跑(验 F4:S>A>B>C 顺序 / 预估 vs 实扣偏差 <10% / 完成推送(需配 notify.webhook.url)/ 取消排队退费)→ ④(可选顺验)`/admin/bindings` 配 `binding.storyboard.prompt.modelId` 后点单组「✨AI 优化」(验 M6:token 保全/写回/乐观锁;¥0.02-0.05/次)
- [ ] **moyu /images/edits ~300s 服务端硬限(六八实证)**:img2img(三视图/九宫格/关键帧带参考)4 次真打全在 284-305s 被掐(EPIPE,gpt-image-2 与 seedream 都一样;文生图通道正常)。临时路:用「从设定生成」(文生图)/错峰重试;根治候选:问 moyu edits 限时 / 火山直连异步任务式 API。客户端三层已修(尺寸/16、超时 600s、per-model 尺寸分档)
- [ ] docx 上传多集切分真打(六五修复后用户未回报;若集号写法非「第N集」需调 parseEpisodeBoundaries 规则)
- [ ] 视频生成端到端真打(Seedance 扣费,六四起留;六八已有 1 条真 take 并验通 cache-video 落地缓存)+ 桌面包 Mock 视频端到端
- [ ] **seedance 配音透传真打**(六七卡 moyu token 401,退款已验净 ¥0):更新 token 后打 reference_audio/generate_audio(六八起 voiceRefs 已自动进 refAudioUrls,无需点「自动 @」)。不支持则配音切 kling-v2-6
- [ ] **seedance 首帧约束真打**(M3a 六八新增):admin/providers 给视频商配 supportsFirstFrame:true 后真打 FLF2V(蓝图:seedance-2.0-fast 首尾帧支持存疑,不支持换 happyhorse-i2v)
- [ ] **本地 TTS 桌面打包**(六八半消化:.dmg 四原生依赖已修齐并核验)— 剩:新机装包后 TTS 权重首跑 ModelScope 下载真打 + win-laptop onnxruntime 预编译真跑
- [ ] **跨机模板同步**:storyboard_main v2(四维电影级)— **六九实证缓解**:mac-studio 开工 `db:sync` 按 versionTag 增量把 v2 自动补进了本机 DB(seed-sync 对"新版本行缺失"走 insert-if-missing)→ mac-mini / win-laptop 开工 db:sync 大概率同样自动补,开工后在 /admin/prompts 验证 v2 在即可,手动粘贴仅作兜底
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
