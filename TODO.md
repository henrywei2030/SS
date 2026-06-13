# 项目任务清单 · StarsAlign Studio / 星垣工坊

> 最后更新:2026-06-14(**win-laptop**:依赖稳升审计落地 + 前后端性能优化(签名 URL 缓存 / GroupDetail memo)+ Turbopack 验证(BLOCKED)+ 深度优化 jobId 去重 · 详见 [PROGRESS](PROGRESS.md))
> 上一版:2026-06-13(win-laptop:优化器 token 真 bug + Provider 删除放开 + 去moyu化 + happyhorse 链路)
> 仓库:https://github.com/henrywei2030/SS
> **🚀 一键启动**:`pnpm start`(详见 [README.md](README.md#快速启动) / [CLAUDE.md](CLAUDE.md#设备登记))
> **📖 主线蓝图**:[docs/06-feature-plan-2026H2.md](docs/06-feature-plan-2026H2.md)(M0–M6 可直接 coding;2026-06-10 mac-mini 逐项核对与代码一致)
> **📖 历史留尾参考**:[docs/W1-W7-followup.md](docs/W1-W7-followup.md)(2026-05-24 盘点,真未做散项已并入下方「工程卫生」区)

---

## 🚧 进行中

- [x] **🚀 依赖稳升审计 + 前后端性能优化 + Turbopack 验证(2026-06-14 win-laptop)· 用户指令**:① **P0 依赖卫生** 钉死 web RC/alpha→稳定版(react/trpc/tailwind/@types-react 真包)+ `pnpm up -r` 批量 within-major;② **bullmq/ioredis 双版本雷根治** — override 钉单版本 ioredis5.11.1+bullmq5.78.0(实测 16/16 绿,「关键雷」解除);③ **P1** 签名 URL 进程内缓存([minio.ts](packages/adapters/storage/minio.ts),返回稳定 URL 省浏览器重下)+ GroupDetail `React.memo`(治列表刷新重渲风暴);④ **P2 Turbopack 验证=BLOCKED**(@ss/core `.js` 扩展名导入 turbopack 无 extensionAlias → 固化 next.config 注释、撤 dev:turbo、保 webpack);⑤ **稳升全量审计**(ultracode 15 簇 workflow,矩阵见下「📦 依赖升级审计」区)。typecheck 16/16。**留**:🟢 稳升批落地 · onnxruntime/ffmpeg 原生重编译需起服验 TTS/ffmpeg · 签名缓存需重启 dev server 生效
- [x] **🔧 优化器 token 真 bug + Provider 删除放开 + 去moyu化 + happyhorse 链路(2026-06-13 win-laptop)· 用户报/指令**:① **深度优化恒挂真 bug** — guards.ts token 正则贪婪吞 `@图片N` 后中文成假 token → 对齐编译器 `@(图片|音频)\d+`(**系统级**,几乎所有 token 密集提示词受影响);② **Provider 删除全部放开** — 去 3 守卫 + 删除自动清 key/缓存 + 中转站级联删;③ **初始零数据 + moyu 中性化** — seed 去默认中转站 + 文案/占位符/前缀逻辑中性化(架构本就支持换站);④ **happyhorse 深诊** — base64 格式(裸 base64)+ ffmpeg 缩图,卡 moyu 单图 60KB 限。DB 清理 docx.parser→mammoth。typecheck/测试全过。**留**:happyhorse 需公网存储真出片 · 剩余注释中性化 · 深度优化真打验证
  - **06-14 续**:深度优化「点了无反应/无通知」根因 = **jobId 去重**(同组固定 jobId,06-13 已 completed 的 job 在 BullMQ 留 24h → 重点同组被静默 no-op)。修 [job-queue.ts](packages/queue/src/job-queue.ts) 入队前 remove 旧 job(允许重跑、仍防并发双跑)。新依赖(TS 5.9)下 4 包 typecheck + 24 测试复验过。**端到端实测待开 Docker**;本会话**不提交**,由另一会话(依赖升级)统一提交。
- [x] **🎬 AIGC 上传图识别修 + Seedance 链路深诊 + pnpm start 排障(2026-06-12 win-laptop 四轮)· 用户报**:① AIGC「缺主图」修 — aigc-overview/aigc-bindings 改用 `resolveMediaFetchUrl` 签名(上传图 cdnUrl=null 不再判缺图、缩略正常);② Seedance「moyu 无调用」根因 = **worker 常驻 seedanceDispatcher 被并发失败请求拖垮**(全新进程连 moyu 1.1s OK、跑久 worker 60s 超时),非网络/代码;UI「生成中42%」是假进度;③ pnpm start 本身正常,失败因 :3000 被占 graceful skip,已腾空。**留真打**:seedanceDispatcher 失败自愈 + 视频并发收紧 + 上传图 relay 同步
- [x] **🖼️ 美术上传图「无法预览」修复(2026-06-12 win-laptop)· 用户报**:根因前端多处 `cdnUrl ?? storageKey`,上传图 cdnUrl=null 回退裸 storageKey 致 `<img>` 404。修:抽 media-url.ts `resolveMediaPreviewUrl`(签名 MinIO URL,复用 media.list 机制)+ asset-crud mediaMap 补 previewUrl + 前端 3 显示点改用 previewUrl。图生图重生链路确认本就通(服务端 fetch 参考图字节送 moyu)。typecheck 16/16。**留**:候选卡 cdnUrl-null 边角 / signed url 3600s
- [x] **🏞️ 场景工作流反转:360° 全景设为场景主资产(2026-06-12 win-laptop)· 用户指令**:反转七二第八波(九宫格为主)→ 360° 全景=主(展示图+AIGC默认+面板左侧)、九宫格次(右);生成依赖反转(360°直生·九宫格参考它)。12+ 点/7 文件:pickAssetMediaId/maturity/PRIMARY_SLOT/slot顺序/参考链反转/hero/chip/AIGC缩略全改。schema 无需改。typecheck 16/16。**留**:存量旧场景需视情补 360°
- [x] **🔧 拆解「应用」分批修复(2026-06-12 win-laptop)· 用户报 Failed to fetch**:根因 = dev server 死了致请求打空气(applyBreakdown 后端纯 DB 事务、代码本正确)。修:breakdown-review-dialog「应用」改**分批发送(每 25 条)+ 部分成功可见 + 后端按名去重幂等可安全重试 + Failed to fetch 翻人话**;不加 hook 保 Fast Refresh 不丢草稿。typecheck 16/16、资产区实落 25 人物。**留**:dev server 死因(疑 preview 工具回收)→ 建议本机 `pnpm dev` 自起
- [x] **🎨 风格 prompt 深度优化(2026-06-12 win-laptop)· 用户指令·调研后重写**:seed.ts 三内置风格定向重写 — **2D→日本动漫**(赛璐璐/京阿尼·ufotable·扳机社)· **3D→CG 游戏**(原神/崩铁/Arcane + NPR + 人工 SSS + UE5,替皮克斯/迪士尼)· **AI 真人→细节**(毛孔/SSS/85mm·f1.8/RAW,负面加塑料感·蜡像·过度磨皮)。内置风格纳入 `FORCE_PROMPTS`(`db:sync:prompts` 强更 + 跨机)。**留**:mac-mini/mac-studio 各跑 `db:sync:prompts` 同步 + 真打验证出图
- [x] **🎯 七二第九波(2026-06-12 mac-studio)· 视频尺寸根因 + 4任务 + 换衣/关键帧 + 变装bug + 参考图超限 + DMG**(详见 [PROGRESS](PROGRESS.md)):① **视频尺寸根因** happyhorse 比例字段双写 ratio+aspect_ratio + 前端预览跟随项目 aspect ② **4任务** 过场去seedance/happyhorse 1080p/预览横屏放大 · 立绘三视图合一(16:9 turnaround)· 卡片预览 lightbox · 镜头语言词库优化(storyboard v4) ③ **换衣/变装**(generateImage outfit 模式 + compileOutfitPrompt + 变装面板,可设按集造型)④ **关键帧首尾帧**(首帧尺寸跟项目/confirmKeyframe 自动@+提示词/尾帧门禁+真实帧)⑤ **变装 bug**(gpt-image 去 strength)⑥ **参考图超 9 张**(人物只送主体形象 + provider 上限截断 + 前端预警;音频独立不计入 9)⑦ **图像预览 lightbox 全覆盖**(共享组件接候选卡/槽位/关键帧)⑧ **最新 mac DMG**。回归 typecheck 16/16 · core 277 · api 57 · adapters 59 · 多轮浏览器实证。**留真打**:happyhorse 双写aspect_ratio/换衣保身份/首帧@送达/v4分镜质量。
- [x] **🏞️ 七二第八波(2026-06-12 mac-studio)· 场景工作流改造(用户指令)**:场景下线「主视角」,九宫格(threeView 复用,16:9)为场景主资产 — 生成面板去主视角 tab + 九宫格默认 16:9(原 1:1)+ 一次性文生图直生(不再图生图)、360° 仍参考九宫格;总览 `PRIMARY_SLOT.SCENE`=three_view + 缺主图/hero/状态chip 改九宫格;后端 `pickAssetMediaId` 场景优先九宫格、maturity L3=九宫格/L4=360°、slot-prompt 16:9;场景换装改在九宫格(进取图链生效)。schema `sceneMainMediaId` 保留未删(旧数据惰性兜底)。9 文件 typecheck 16/16 + 浏览器实证(弹窗只剩九宫格+360°、主视角消失)。**留**:存量旧主视角数据可选清理(等点头)
- [x] **🎨 七二第七波(2026-06-12 mac-studio)· relay 素材同步 + UI 方案执行 + 三遍复审**:① **relay 素材同步**(用户①)— generateImage/generateKeyframe 生成图补 syncMediaToRelay 同步 moyu,补 happyhorse/wan 等 R2V/I2V 拉不到本机参考图的最后缺口(事务外做/未配 group_id 静默降级)② **UI 方案执行**(用户②,docs/08)— 语义五族色变量基座 + aigc/art/director 三大用户面裸状态色清零(~38 emoji→lucide·~118 色→语义变量·减嵌套描边),4 并行 workflow + 暗亮双模式实证;**优化修订**:字号 5 级迁移暂缓(与 +2px 系统冲突)/ Button 已完备 / art 多已语义化 ③ **三遍复审**(确保美观无漏洞)— 我 + 4 对抗 agent + typecheck16/16/无 unused lucide/裸色全目录 0,色语义 **100% 正确**,修 3 处 P2 打磨(warning 对比/⊘○→图标/🩺→Stethoscope)。**留**:relay 需填 `relay.assets.default_group_id` 真启用 · UI 批④ admin(35 文件低优)· 字号软约束 token
- [x] **🧩 七二第六波(2026-06-12 mac-studio)· 用户报 5 项 + happyhorse 真打诊断全修**:① **99集幽灵真根因** — archiveEpisode 漏删 script + script.list 没过滤 episode.deletedAt → 修两处+清存量孤儿(1→0)+ episode-cleanup 纵深防御 ② **跨集换装** — AssetVersion 重定义为按集造型(migration 44)+ outfit CRUD + compile 按集覆盖 + 前端造型切换器 ③ 槽位本地上传(全类型)④ 提示词去重(buildGroupShotLine 去维度标签)⑤ 一键生成三视图 ⑥ 自动匹配补 episodes[] ⑦ **happyhorse 防 MOCK**(关键字推断路由真模型)+ **R2V 缺参考图前置硬门**(内部直打实证:真到 moyu、带参考图真出片 ¥8)。生成后弹窗不退修复。全盘复审 2 遍(修 P1 项目级脚本误杀 + P2 SCENE 换装槽位)。~~**留**:relay 素材同步~~ ✅ 七二第七波已完成
- [x] **🎬 七功能 AIGC 增强路线图(M0–M6)主线全清(2026-06-11 七二)**(蓝图 [docs/06](docs/06-feature-plan-2026H2.md))— ✅ M0 基建 / ✅ M1 成片 / ✅ M2′ 配音补强(均六七)/ ✅ M3 全清(六八/六九)/ ✅ M4+F4(六九)/ ✅ F5a(六九)/ ✅ M6a/b(七十)/ ✅ 真打回归 gate 全过(七二)/ ✅ L5 断点续跑(七二)/ ✅ **F5b 并抽/failover/对比卡(七二 第五波)**:同事务双占位双 PREPAY 对决(真打 seedance×wan 双路独立终态)+ provider 健康度±步进 + 备选链自动切换(真打验证切换/通知/成功回写)+ ⚔ 并排对比卡(QC/价格/采纳)。**留运营**:旗舰档对比数据积累(kling 接入照 wan 路径)
- [ ] **🧠 Prompt Mini-Harness(八维知识库 × 装配流水线)**(蓝图 [docs/07](docs/07-prompt-harness.md))— ✅ H0-H3 全落地(七一)/ ✅ **gate 顺验全过(七二)**:✨四路径(happy/乐观锁/硬门/TOKEN_LOST)/✨✨判官八维+定向修复/知识检索对症命中+hitCount 飞轮/权重 -0.05 生产接线/v3 三纪律+音桥教科书级 / ✅ **语义检索解锁**(七二修 embedding batch≤10 真 bug,77/83 向量回填;本机已配,其他机器照 PROGRESS 七二 Gate⑧ 步骤)。**剩**:① 飞轮持续运营(权重演化/蒸馏候选审核,/admin/knowledge)② ~~optimizer meta-prompt 补 @token 强化~~ → **2026-06-13 查清真因**:深度优化「恒挂」不是 LLM 丢 token,是**守卫 token 正则贪婪误判**(`@[一-龥]+` 吞 @图片N 后中文成假 token)→ 已对齐编译器 `@(图片|音频)\d+` 修复(系统级);待真打验证 ✨✨ 真出八维分+写回
- [ ] **🔊 本地 TTS 声线生成(MOSS-TTS-Nano)**— 六七闭环,六八三需求加固;✅ **七二:桌面包权重首跑验证通过**(打包资源+全新数据目录完整复现新 Mac:746MB 下载+推理+样本全链 ~20min 成功 — 故障实为"纯不可观测")+ **可观测安装落地**(进度落盘+后台安装 job+声音面板四态卡:安装/进度条/失败重试+清缓存/就绪)。**留**:win-laptop onnxruntime 真跑 /「从有声视频抽音轨反向采纳声线」
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

- [x] **🎯 真打回归 gate 三连+Harness 五验 — 七二 mac-mini 全过(2026-06-11,Claude 自主驾驶,内账净 ¥13.60)**:①M4 出片/扣费/退差/超时退净/stale-sweep 自愈 ✓ ②QC 出分 72(跑题注入 22)+权重 -0.05 飞轮+QC 全自动触发 ✓ ③批量分流/标签贯穿/**取消退费 7 组净 0** ✓ ④✨四路径(含乐观锁/硬门/TOKEN_LOST)+知识对症命中 ✓ ⑤✨✨判官八维+定向修 SUBJECT ✓ ⑥v3 三纪律+音桥 84 镜 ✓ ⑦A/B 75vs78(n=1 无统计力,管线已通)✓ ⑧语义检索(修 batch bug 后)✓。**残留**:预估偏差按真实账单 14.7% 超标(→计价校齐项);带绑定组本机缺主图打不了(跨机媒体债);推送通知仅验铃铛落库,Bark/飞书 webhook 未配未验
- [ ] **moyu /images/edits ~300s 服务端硬限(六八实证)**:img2img(三视图/九宫格/关键帧带参考)4 次真打全在 284-305s 被掐(EPIPE,gpt-image-2 与 seedream 都一样;文生图通道正常)。临时路:用「从设定生成」(文生图)/错峰重试;根治候选:问 moyu edits 限时 / 火山直连异步任务式 API。客户端三层已修(尺寸/16、超时 600s、per-model 尺寸分档)
- [ ] docx 上传多集切分真打(六五修复后用户未回报)— **七二实锤**:parseEpisodeBoundaries 不识别中文数字集号(「第二集」整段被并进第 1 集导致误覆盖),若剧本用中文数字需补规则
- [ ] 视频生成端到端真打(Seedance 扣费,六四起留;六八已有 1 条真 take 并验通 cache-video 落地缓存)+ 桌面包 Mock 视频端到端
- [ ] **seedance 配音透传真打**(六七卡 moyu token 401,退款已验净 ¥0):更新 token 后打 reference_audio/generate_audio(六八起 voiceRefs 已自动进 refAudioUrls,无需点「自动 @」)。不支持则配音切 kling-v2-6
- [ ] **seedance 首帧约束真打**(M3a 六八新增):admin/providers 给视频商配 supportsFirstFrame:true 后真打 FLF2V(蓝图:seedance-2.0-fast 首尾帧支持存疑,不支持换 happyhorse-i2v)
- [ ] **本地 TTS 桌面打包**(六八半消化:.dmg 四原生依赖已修齐并核验)— 剩:新机装包后 TTS 权重首跑 ModelScope 下载真打 + win-laptop onnxruntime 预编译真跑
- [ ] **跨机模板同步**:storyboard_main v2(四维电影级)— **六九实证缓解**:mac-studio 开工 `db:sync` 按 versionTag 增量把 v2 自动补进了本机 DB(seed-sync 对"新版本行缺失"走 insert-if-missing)→ mac-mini / win-laptop 开工 db:sync 大概率同样自动补,开工后在 /admin/prompts 验证 v2 在即可,手动粘贴仅作兜底
- [ ] 旗舰档二选一(六七定,v3 已确认不在 moyu):`kling-v2-6`(1.2元/s 音画同出) vs `wan2.6`(t2v/i2v 各 1.1元/s)— **七二:wan2.6 已真打通**(SUCCESS 结算 ¥5.5 精确,moyu 线上无 wan2.7),kling 真接时对比后定
- [ ] happyhorse / kling / wan 经 moyu 请求形状逐家真打(M5)— ✅ **七二:wan2.6-t2v + happyhorse-1.0-t2v 双通**(moyu 通用任务信封解析落地+5 形状锁测试;catalog 8 条目带 adapter:relay-video 跨机开箱;同家族 i2v/r2v 同协议)。**留 kling**(catalog 未补 adapter 字段,接入照 wan 路径)
- [ ] 其余模型价格按实际账单校齐(五八-fix 留:haiku/gemini/gpt-5.5/opus/gpt-image-2 仍是旧文档价,用到时核)。~~seedance-2.0-fast~~ ✅ 七二已校:实测 ¥0.803/s(token 计价 37/M)→ unitPriceCny 0.7→**0.81**(本机 DB + catalog 双处,fast 档专属,满血 2.0 各归各价);其他机器开工后在 /admin/providers 手动改 0.81 或重建 provider(catalog 新默认已带)

### 🎨 UI 优化(七二 · 方案见 [docs/08](docs/08-ui-optimization-plan.md),按 P0→P1 排期)

- [x] ~~**P0(半天)**~~ ✅ 七二第五波:导航折行修复(nowrap+lg 以下 icon-only+项目名截断,双态浏览器实证)/ 符号串→lucide mini-chip+tooltip / 「0 场」破案(历史软删场,显示口径改分镜实际引用数,ep1 0→5 场)
- [ ] **P1(3-4 天)**:字号 9 种→5 级 token + lint 禁任意值 / 手写按钮~40 处→Button 组件 / emoji 图标→lucide(保留 ✨系)/ 硬编码状态色~50→语义五族变量(并清工程卫生既有色债)/ AIGC 右栏边框预算整改
- [ ] P2 塞缝:相对时间/tabular-nums/滚动渐隐/统一空态组件(与 a11y 债合并)

### 📦 依赖升级审计(2026-06-14 win-laptop · P0 within-major 全升 + ultracode 稳升矩阵)

> 2026-06-14 重审:P0 已把所有 within-major 安全补丁吃掉(typecheck 16/16 绿)+ RC/alpha 预发布版钉死成稳定版。剩余 major 经 ultracode workflow(15 簇 × 研究+对抗复核 30 agent)逐个研判「破坏性变更 vs 本仓真实用法」,分级如下。

- [x] ✅ **关键雷·已解除**:bullmq/ioredis 双版本撞 typecheck 根因是 **pnpm 解析出双 ioredis**(非 API 破坏)→ root `pnpm.overrides` 钉单版本 ioredis 5.11.1 + bullmq 5.78.0,实测 16/16 绿。**这俩从此随 override 单版本稳升**。
- [x] ✅ **P0 within-major 全升 + RC/alpha 钉稳定**(2026-06-14):react/trpc/tailwind/@types-react 真包 + radix/react-query/aws-sdk/zod3.25/vitest/undici6.26/tsx/superjson 等 `^` 范围内全更新;major 由范围挡住未动。
- [ ] **🟢 可稳定升级(已逐项证伪破坏性风险,建议作一批落地 + typecheck)**:tailwind-merge 2→3(本就该配 tw v4,零改码)· jose 5→6(只用 SignJWT/jwtVerify HS256,旧 token 仍验签)· bcryptjs 2→3(只用 async hash/compare,旧 2a hash 兼容;删 @types/bcryptjs)· recharts 2→3(用得浅不撞)· vitest 2→4(devDep 核心 API 兼容)· mime-types 2→3(代码其实没真用,可升可删)· styled-jsx 5.1.7 / esbuild 0.28.1(patch)
- [ ] **🟡 能升但需改动/验证**:zod 3→4(改 2 处 `z.string().email/.url`→`z.email/z.url` + QA admin 路由 `.default()` 行为变;tRPC v11 已支持 zod4)· next 15→16(无 Pages Router 迁移,但 webpack 钩子/原生 externals/next-intl 插件需分支验)· @types/node →**24.x**(对齐运行时 node24,非最新 25)· undici 6→**先 7.x**(v8 砍 Node20 需 ≥22.19;验三家 provider 长超时)· lucide 0→1(next.config `modularizeImports` 路径需验 build,或删冗余靠 optimizePackageImports)
- [ ] **🔴 押后(违背最稳定)**:typescript 5→6(默认 `types` 改 `[]`,需 tsconfig 加 `types:["node"]` + 全仓爆炸半径验证)· next-intl 4 簇(+@formatjs/intl 4 + intl-messageformat 11;配置 API 重写联动,当前 `^3` 范围内已无待升)· embedded-postgres 18(beta + PG 16→18 大版本需数据迁移)
- [x] ✅ **windows-x64 白名单修复**(独立,已保留进工作树):`@embedded-postgres/win32-x64`→`windows-x64` + rebuild 验证 postinstall 通过

### 🧹 工程卫生(塞缝做 · 2026-06-10 六七核对收拢 — 碰到相关代码顺手清,不单独排期)

- [ ] **服务端 timeout/Retrying 刷屏排查**(2026-06-12 win-laptop 启动时见):web SSR 持续 `Request timed out after 3000ms / Retrying X/3`(登录页不受影响、200+connected)。grep *.ts/tsx 源码无匹配 → 疑依赖库或 worker 探测外部服务(win 无 API key)。查根源 + 收敛日志噪音
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
- [ ] W5 worker 升级残项:L3 concurrency 从 ProviderConfig 动态读 / ~~L5 providerJobId 断点续跑~~ ✅ **七二实装+真打验证**(task_id 创建即持久化(CallContext.onVideoTaskCreated 回调)+ 重入续轮询(process-job resumeVideoPoll,任何带 poll 的适配器免费继承 — relay-video 系自动受益);真打:kill -9 worker mid-poll → 重启 →「续轮询(不重建任务)」→ 同一 task SUCCESS,孤儿任务白烧根除)/ L6 typed Error 失败分类(L4 cancel:QUEUED 态由 M4 cancelQueuedForEpisode 吸收,RUNNING 态取消仍留)
- [x] ~~(P2)批次成员全部在 API 侧终结时通知漏发~~ ✅ 七二修:批次完成判定抽 `batch-notify.ts` 独立模块(幂等),四站点接入(worker followup 原路 / 批量全 denied / submit stale-sweep 后 / boot 恢复后)+ **顺手修组级 sweep 退款归属**(REFUND 记原提交者 createdBy,同六九 cancelQueued 口径);全 denied 场景真打:batch_failed 通知落库 ✓
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
