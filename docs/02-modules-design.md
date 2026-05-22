# 02 · 模块设计

> 15+ 模块的完整设计。每个模块标注 ✅ 已完成 / 🚧 进行中 / 📋 待做 / 🔮 Phase 3+

---

## 模块全景图

```
                         👤 用户
                          │
                          ▼
              ┌───────────────────────┐
              │   Mission Control     │ ✅
              │     项目首页           │
              └───────────────────────┘
                          │
       ┌──────────────────┼──────────────────┐
       ▼                  ▼                  ▼
  ┌──────────┐      ┌──────────┐      ┌──────────┐
  │  Story   │ ✅   │  Asset   │ 📋   │ Workflow │
  │ Compass  │      │  Forge   │      │  Engine  │
  │ 剧本工坊  │      │ 美术工坊  │      │（Agent） │
  └──────────┘      └──────────┘      └──────────┘
       │                  │
       ▼                  ▼
  ┌──────────┐      ┌──────────┐
  │Storyboard│ 📋   │Generation│ 📋
  │  Studio  │ ───▶ │  Engine  │
  │ 分镜工坊  │      │AIGC抽卡 │
  └──────────┘      └──────────┘
                          │
                          ▼
                    ┌──────────┐
                    │Edit Suite│ 🔮
                    │ 剪辑工作台│
                    └──────────┘
                          │
                          ▼
                    ┌──────────┐
                    │Distribute│ 🔮
                    │ Hub 发行  │
                    └──────────┘
        ↑                                ↑
        │                                │
   ┌────┴──────┐  ┌──────────┐  ┌──────┴────┐
   │ Media     │  │ Collab   │  │ Insight   │
   │ Vault 库  │  │  Hub 协作│  │ Cockpit   │
   │  📋      │  │  📋     │  │ 驾驶舱 📋 │
   └───────────┘  └──────────┘  └───────────┘
              ↑                       ↑
              │                       │
        ┌─────┴─────┐         ┌──────┴──────┐
        │Compliance │ 🔮       │ Voice & 🔮 │
        │Sentinel   │         │Audio Studio │
        │   合规     │         │  声音工作台  │
        └───────────┘         └─────────────┘

  ↑ 横向支持模块（被多个核心模块调用）
```

---

# 一、Mission Control · 项目首页 ✅

**状态**：W2.5 已完成
**位置**：`apps/web/app/[locale]/(workspace)/projects/`

### 已实现
- 项目列表（行式紧凑表格，按 type 区分色）
- 单项目详情（KPI 卡 + 4 工作台入口 + 团队）
- 项目 CRUD（create/update/delete/clone）
- 创建项目对话框（含类型/比例/风格）
- 进度条 + 完成度统计

### Phase 2 待做
- 📋 Lightspeed Mode（单人极速：idea → 30s 预告片闭环）
- 📋 Mission Radar（环形热力图显示瓶颈模块）
- 📋 多项目并行总览（跨项目 ROI / 抽卡率排行）
- 📋 模板市场（已完成项目存为模板）

### 输入输出
- 入：用户创建 / Idea
- 出：`Project` 实例（含 style / aspect / budget / members）

---

# 二、Story Compass · 剧本工坊 ✅ 部分

**状态**：W2.7 已完成单集分析；分镜工坊待 W3
**位置**：`apps/web/app/[locale]/(workspace)/projects/[id]/director/`

### 已实现
- `/director/scripts` 剧本列表 + 上传对话框
- `/director/analysis` Story Compass 单集分析页（8 维雷达 + 剧情曲线）
- `scriptRouter.upload / list / analyze / latestAnalysis`
- Claude Sonnet 4.5 同步调用（含三段容错 JSON 解析）

### 8 维评分系统
钩子力度 / 悬念保持 / 反转力度 / 爆点密度 /
冲突集中 / 台词锐度 / 节奏紧凑 / 急停保持

### 已设计未实现
- 📋 三 Agent 对抗评审（Critic + Defender + Judge）— Phase 2
- 📋 制作曲线 = 算力预算分配器 — Phase 2
- 📋 多语言同步分析 — Phase 2
- 📋 平台审核风险预测（接 Compliance Sentinel）— Phase 2
- 📋 历史对标（pgvector 找爆款）— Phase 2

---

# 三、Storyboard Studio · 分镜工坊 ✅ W3 完成

**状态**:W3.0-W3.7 全部完成,产品就绪
**位置**:`apps/web/app/[locale]/(workspace)/projects/[id]/director/storyboard/`

### W3 范围
- ✅ 三栏 Linear 布局（集列表 / 剧本 / 分镜 tab）
- ✅ AI 生成分镜（按场调 LLM,一次性出齐 framing/angle/content/prompt 含台词 OS）
- ✅ 合并/拆分组（向上/向下/勾选合并 + 拆分回归独立分镜）
- ✅ 多格式剧本上传（docx / txt / md / rtf / html）+ 版本系统
- ✅ 分镜发布 → 触发 `EVENTS.STORYBOARD_PUBLISHED`
- ✅ 行内编辑(shot + group)→ 自动写 PromptEdit 训练集
- ✅ 字号 A-/A+ + 进度条 + CSV 导出
- 📋 Y.js + Hocuspocus 实时协作(Phase 2 试点)
- 📋 草图低成本预览(Nano Banana Fast,延后)

### 已落地的关键基础设施
- ✅ `Scene` 表（剧本场号 1-1/1-2 + 时段/内外/地点/人物）
- ✅ `ShotGroup` 表（合并组,承载组级 prompt + status,可逆 split）
- ✅ `PromptEdit` 表（AI 输出 → 人改的训练样本,framing/angle/content/prompt 字段白名单）
- ✅ `pg_advisory_xact_lock` 串行化 createNextVersion / mergeShots / autoMerge,防 unique race
- ✅ `mergeShots` 算法（packages/core/storyboard/merge.ts,含 8 单测）
- ✅ `parseScriptText` 剧本 parser（packages/core/script/parse.ts,12 单测,场号/对白/旁白/OS 识别）
- ✅ `extractScriptText` 多格式提取（utils/script-extract.ts,11 单测含 RTF 嵌套 + HTML 绕过攻击防御）

### Phase 2/3 升级点
- 🔮 Canvas 视图（Linear ⇄ Canvas 同源切换）— Phase 3 Wireless Canvas
- 📋 Diff Highlight — Phase 2
- 📋 Multimodal 输入（粘贴参考图反推分镜）— Phase 2

---

# 四、Asset Forge · 美术工作台 📋 W4 主题

**状态**：待开发
**位置**（计划）：`apps/web/app/[locale]/(workspace)/projects/[id]/art/`

### W4 子模块
- **人物**：拆解 4 步链（核心/配角/物种/群演 → merge）+ 三视图 + 火山合规通道
- **场景**：4 视图 + 360° 全景
- **道具**：单视图 + 出场绑定

### 资产数据模型亮点
- `Asset.alias[]` — 别名（用于 AIGC 自动 @ 匹配）
- `Asset.threeViewIds[]` / `panorama360Id` — 多视图
- `Asset.complianceId` — 火山引擎返回的合规代码（视频生成时复用）
- `Asset.loraIds[]` — Phase 2 LoRA 挂载点
- `Asset.model3dUrl / gaussianUrl` — Phase 3 3D 一致性

### Phase 3 旗舰
- 🔮 Gaussian Splatting 数字分身（30 秒生成 3D 高斯泼溅人物，任意角度参考）
- 🔮 表情库 & 微表情自动 @
- 🔮 服装资产分离（角色 × 服装组合）
- 🔮 资产关系图谱（人物关系 / 场景空间相邻）

---

# 五、Generation Engine · AIGC 抽卡引擎 📋 W5 主题

**状态**：待开发
**位置**（计划）：`apps/web/app/[locale]/(workspace)/projects/[id]/aigc/`

### W5 范围
- 集卡片入口（沿用 `AIGC-总览.jpg`）
- 分镜级 4 列布局（资产关联 / 原始剧本 / 视频提示词 / 视频预览）
- 自动 @ 资产（W1.6 `auto-match` 算法已就绪 + 9 个单测）
- 单模型抽卡（Seedance 2.0 主、Fast 备）
- 历史记录抽屉 + 重抽 + 采纳/废弃
- BullMQ video-gen worker（异步生成）
- 实时进度推送（WebSocket / SSE）
- Cost HUD（每镜头/集累计成本）

### Phase 2 升级点
- 🔮 多模型 Race（Seedance + Veo + Kling 并行抽卡，5s 出 3 候选）
- 🔮 Pre-Flight Check（AI 预测成功率 + Prompt 优化建议）
- 🔮 Auto-Salvage（失败片段自动扫描可用段）
- 🔮 分段抽卡（15s 镜头分前/中/后只重抽失败段）
- 🔮 Diff Highlight + 镜头组关联抽卡

---

# 六、Edit Suite · 剪辑工作台 🔮 Phase 2

**状态**：Phase 1 暂不实现（项目首页显示"即将上线"）
**Phase 2 范围**：
- 内置 Web 时间线（Remotion + WebCodecs）
- AI 一键粗剪（按节奏 + 情绪曲线）
- 智能选片（多候选自动选最佳）
- 达芬奇 / 剪映 / Premiere 工程导出
- AI 配音 + 口型同步（MuseTalk）
- 字幕智能化（ASR + 多语翻译）
- 成片质量评分（Reel Critic）
- 多平台水印 + 一键导出

---

# 七、Media Vault · 素材库 📋 W5 同步

**状态**：待开发
**位置**（计划）：`apps/web/app/[locale]/library/`

### W5 范围
- 上传 / 分类 / 搜索（关键词）/ 收藏 / 多选 / 批量
- 公共库 + 我的素材 + 收藏夹
- 音频波形（wavesurfer.js）
- AI 基础打标（音频 BPM / 时长；图尺寸；视频时长 + 缩略）
- AIGC 生成物自动沉淀

### Phase 2 升级
- 🔮 向量统一检索（pgvector + CLIP + CLAP）
- 🔮 智能 BGM 推荐
- 🔮 版权指纹（Chromaprint）
- 🔮 废片回收池（Auto-Salvage 入库）

---

# 八、Insight Cockpit · 数据驾驶舱 📋 W6

**状态**：admin 入口已搭建，详情待开发
**位置**：`apps/web/app/[locale]/admin/`

### 已实现
- ✅ Admin sidebar + 13 项菜单
- ✅ `/admin/providers` API Key 加密管理（W2.6）

### W6 范围
- 数据总览（4 KPI + 30 天趋势 + 模型分布饼图 + 项目费用 Top5）
- API 用量明细
- 抽卡率 Top10 镜头
- 成员维度工作报告

### Phase 2 升级
- 🔮 三层视角（平台主 / PM / 创作者）
- 🔮 异常检测告警（Slack/邮件）
- 🔮 What-If 模拟（"若改 Fast 模型省 ¥X"）
- 🔮 ROI 反向闭环（拉 Distribution 数据反向喂 Agent）
- 🔮 LangSmith 集成

---

# 九、Collab Hub · 团队协作 📋 W6

**状态**：基础数据模型已就位，UI 待开发
**位置**（计划）：`apps/web/app/[locale]/projects/[id]/team/`

### 已实现（数据层）
- ✅ `ProjectMember` 5 角色 + 6 工作台权限开关
- ✅ `EpisodeAssignment` 3 角色（OWNER/COLLAB/REVIEWER）
- ✅ `OperationLog` 审计日志

### W6 范围
- 成员管理 UI + 邀请审批
- 集数分配看板
- 集数总览进度表
- 工作报告（抽卡率 / 完成率）
- 操作日志 / 回收站

### Phase 2 升级
- 🔮 CRDT 实时协作扩展到资产 / 评论
- 🔮 跨时区调度
- 🔮 AI Coach 自动日报
- 🔮 客户验收门户

---

# 十、Admin · 后台管理 ✅ 部分

**状态**：W2.6 完成 Provider 管理；其他子项 W7
**位置**：`apps/web/app/[locale]/admin/`

### 已实现
- ✅ AI Provider 配置（含加密 API Key 管理）

### W7 范围
- 📋 Prompt 模板编辑器（含版本树）
- 📋 风格管理 UI（AI 真人 / 3D 国漫 / 2D 动漫）
- 📋 预设模板（景别 / 机位 / 运镜 / 光线）
- 📋 系统设置（SystemSetting 表）
- 📋 自建数据库浏览器（替代 Prisma Studio，详见 `docs/W2-admin-module-spec.md`）

### 已 seed 内容
- 3 个内置风格（AI 真人 / 3D 国漫 / 2D 动漫）
- 7 个 Provider 配置（Seedance × 2、豆包、Nano Banana、GPT Image、Claude、火山合规）
- 3 个核心 Prompt 模板
- 6 条系统设置

---

# 十一、Compliance Sentinel · 合规哨兵 🔮 Phase 2

**状态**：基础 Schema 已预留，模块未实现
**Phase 2 范围**：
- 三阶段合规：剧本预审 + 生成期画面/音频/字幕扫描 + 发布前终审
- 多平台合规网关（火山 + 抖音 + 快手 + 海外）
- 修改建议引擎（AI 改写文案 / 替换镜头 / 模糊处理）
- 合规审计 timeline
- 合规 Asset 中央库（人脸 ID / 视频 code / 版权证明）
- 国别敏感词库（出口日韩自动多检"军国/战争"）

**已就位**：
- ✅ `packages/shared/src/schemas/compliance.ts`
- ✅ `Asset.complianceId / complianceStatus` 字段

---

# 十二、Voice & Audio Studio · 声音工作台 🔮 Phase 2

**状态**：基础 Schema 已预留
**Phase 2 范围**：
- 角色声音克隆（ElevenLabs / MiniMax / Cosyvoice）
- 情感化配音（剧本台词 + 情绪标签）
- 多语言一键配音（音色保持）
- ADR 工作流（补录 / 对口型）
- BGM 生成（Suno / Udio）
- 音效自动埋点（剧本动作描述匹配）

**已就位**：
- ✅ `packages/shared/src/schemas/voice.ts`
- ✅ `Asset.voiceMediaId` 字段

---

# 十三、Wireless Canvas · 无线画布 🔮 Phase 3 旗舰

**状态**：Schema 字段已预留（`Shot.positionX/Y`）
**Phase 3 范围**：
- 三种 Canvas 模式：剧情脑暴 / 角色关系图 / 自由故事板
- 与 Linear 视图同源（拖动同步）
- AI 副驾驶（聚类便签 / 建议关系冲突）
- CRDT 多光标
- 自定义节点类型（未来扩"投流计划""分账"节点）

**技术储备**：
- ✅ tldraw v3 可二次开发
- ✅ Shot.positionX / Y 字段已预留

---

# 十四、Distribution Hub · 发行回流 🔮 Phase 3

**状态**：未启动
**Phase 3 范围**：
- 多平台发布器（抖音/快手/YouTube/TikTok）
- 数据回流（播放/留存/充值/广告收益）
- ROI 分析（投流成本 vs 自然流 vs 收益）
- 投流策略 AI 建议
- 分账透明对账

---

# 十五、Plugin SDK + Marketplace · 🔮 Phase 3

**状态**：未启动
**Phase 3 范围**：
- 插件开发 SDK
- 模板市场（项目模板 / 角色模板 / 风格模板）
- 用户社区分享
- 第三方 Provider 注册

**已就位**：
- ✅ ProviderRegistry 注册中心（`packages/adapters/provider/index.ts`）— 已支持运行时新增

---

## 跨模块通信

所有模块间通信通过 `@ss/shared/events.ts` 的 46 个 EventBus topic，具体定义见 `docs/01-architecture.md § 4.1`。

### 关键事件流示例

**「剧本上传 → 分析 → 分镜 → 抽卡」串联**：
```
script.uploaded
  → script.analysis.queued
  → script.analysis.completed
  → (用户审阅)
  → storyboard.generated
  → storyboard.published  ← 触发 AIGC
  → generation.queued
  → generation.completed
  → generation.adopted
```

每个 topic 在 `events.ts` 都有类型化 Payload，订阅时自动 TS 类型推断。
