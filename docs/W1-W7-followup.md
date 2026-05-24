# W1-W7 待完成事项清单 · Phase 1 完结后的留尾

> **生成日期**:2026-05-24(十七次收工)
> **更新**:2026-05-25(二十一次收工)— P0 实战阻塞项全部已完成或迁至 [Phase 1.5 plan v2.1](integrations/phase-1.5-plan.md)
> **背景**:W1-W7 路线图标 "100% 完成",但实际是 **MVP 完成**(核心功能可跑全流程)。本文件列出每个阶段的留尾事项,按**优先级 + 阶段**分类,实战前后参考。
> **维护**:每次有项落地或新增留尾,在本文件勾选 / 追加。

---

## 🔴 P0 实战阻塞项 ~~进入 W8 前必修~~ ✅ **已全部完成(2026-05-24 二十次收工)** — 详见 [phase-1.5-plan.md v2.1](integrations/phase-1.5-plan.md)

> 本节已被 phase-1.5-plan.md v2.1 替代 + 用户授权完整跑通(commit `dda9051` / `8767465` / `2502d3d`)。下表仅保留作为历史 audit trail。

| # | 项 | 所属 | 工作量 | 说明 | 状态 |
|---|---|---|---|---|---|
| **1** | 跑 W5.5 第 3 轮 audit migration | W5.5 | 1 min | `pnpm db:migrate:deploy` — 应用 MediaItem `sourceRef` partial unique 索引(防 idempotency 失败时双写) | ✅ 完成(二十收工累积 19 → 20 migration) |
| **2** | `pnpm install` 拉 `@tauri-apps/cli` 新依赖 | W7 | 30 sec | 十六收工新加 apps/desktop workspace | ✅ 完成(已 install) |
| **3** | 配 Claude API Key | W2.7 / 实战 | 5 min | `/admin/providers` 设 ClaudeTextProvider Key,W2 Story Compass / W3 storyboard.generate / W4 asset.breakdown 才能真跑 | 🔄 **替换为 Phase 1.5 P0-6**(配 1 个中转站 token 覆盖 8 Provider) |
| **4** | 配 Seedance API Key + Volcengine 合规 | W5 / 实战 | 30 min(账号注册 + Key 申请) | `/admin/providers` 设 SeedanceProvider Key,W5.5 异步视频生成才真跑(当前 Mock 兜底) | 🔄 **替换为 Phase 1.5 P0-6**(同上,中转站 token 覆盖) |
| **5** | 验证 W3+W4+W5 真接 Provider 端到端 | 实战前 | 30 min | 上传剧本 → 分析 → 分镜 → 资产生成 → 抽卡 → SSE 进度 → 视频出来 | ✅ 完成(二十收工 relay-real-test.mjs 真触发 testConnection 14.9s + W3 script.analyze 37s) |

---

## 🟡 Phase 1.5 应做项(W8 实战中或紧接着)

### W4 真实 ImageProvider 接入(Mock 替换)
- **现状**:`MockImageProvider`(picsum 占位)全链路跑通
- **Phase 1.5**:接 NanoBanana / GPT Image / 豆包图像中**至少 1 个**,改 `getImageProvider(providerId)` 的 switch 分支
- **工作量**:每个 Provider ~150 行(API client + 错误转换 + 测试)
- **关联**:跟 W5.5 失败白名单分类一致(typed Error)

### W5.5 异步生成 8 项 L1-L8 升级(部分已提前)
| # | 项 | 状态 | Phase 1.5 应做? |
|---|---|---|---|
| L1 | HMAC token 5min TTL → 自动重签 | ✅ 已提前到 Phase 1(十五收工) | — |
| L2 | MediaItem.sourceRef partial unique | ✅ 已提前(十五收工 migration) | — |
| L3 | worker `concurrency: 1` 硬编码 → 从 ProviderConfig 动态读 | ⏸️ | 配 Seedance 后必做(免浪费并发能力) |
| **L4** | **cancel 机制**:`aigc.cancelGeneration(attemptId)` + worker 检查 cancel flag | ⏸️ | 🔴 **真接 Seedance 后必修**(单条 60-180s,用户改主意想取消很常见) |
| L5 | Seedance Provider 内部 poll → worker poll 持久化 providerJobId 断点续跑 | ⏸️ | Phase 1.5 真接时考虑 |
| L6 | 失败分类用 `instanceof ProviderUnrecoverableError`(替代关键词) | ⏸️ | Phase 1.5 真接 Volcengine 后(中文错误关键词可能 miss) |
| L7 | 批量重抽 mutation | ⏸️ | Phase 1.5+(用户用了才知是否需要) |
| L8 | OperationLog 接 OTel | ⏸️ | Phase 2(单实例不必) |

### W4 火山引擎合规接入
- **现状**:`setComplianceManually` 过渡(管理员手动标合规通过)
- **Phase 1.5**:接火山 face check API,生成 complianceId 自动写入 Asset.complianceId(W5.5 视频生成会复用这个 ID)
- **工作量**:~200 行(火山 SDK + 异步轮询 + 失败处理)

### Tauri 桌面端真编译
- **现状**:十六收工 apps/desktop 骨架就绪
- **Phase 1.5**:
  - 装 Rust toolchain(`rustup-init`)+ Tauri 系统依赖
  - 装 `@tauri-apps/cli`(已加 deps)
  - `pnpm tauri:dev` 跑通(local dev)
  - Icon 生成(`pnpm tauri:icon ./icon.png`)— 占位 icon 已声明在 tauri.conf.json,需准备 png
  - `pnpm tauri:build` 跑 production bundle(msi/dmg/appimage)
  - 自动更新通道(GitHub Releases 或自建 update.json endpoint)
  - 代码签名(macOS notarization + Windows EV 证书)
  - CI/CD GitHub Actions matrix 跑跨平台 build

### Invitation 邀请流程 UI(数据层已就绪)
- **现状**:`Invitation` 表 schema 完整(token + expiresAt + status),但没 router/UI
- **Phase 1.5+**:加 `invitationRouter`(create/list/accept/cancel)+ /team 邀请审批区(当前用 addMember 直接加)
- **工作量**:~300 行(router + UI + 邮件发送 hook)

---

## 🟢 Phase 2 留项(规划清晰,待启动)

### W3 升级
- Y.js + Hocuspocus 实时协作(分镜表多光标 + Presence)
- 草图低成本预览(Nano Banana Fast / Lucid-Origin,每张 ¥0.01)
- Diff Highlight(版本对比)
- Multimodal 输入(粘贴参考图反推分镜)
- Canvas 视图(Linear ⇄ Canvas 同源切换)— ADR Wireless Canvas

### W4 升级
- 资产关系图谱(人物关系 / 场景空间相邻)
- 表情库 & 微表情自动 @
- 服装资产分离(角色 × 服装组合)
- Phase 3:Gaussian Splatting 数字分身

### W5 升级(W5.5/W5.6 进阶)
- W5.6 进阶:
  - 音频波形(wavesurfer.js)
  - AI 自动打标(音频 BPM/时长;图尺寸;视频缩略)
  - pgvector + CLIP + CLAP 向量统一检索
  - 智能 BGM 推荐
  - 版权指纹(Chromaprint)
  - 废片回收池(Auto-Salvage 入库)
- 多模型 Race(同 group 同时 Seedance + Veo + Kling 并行抽卡)
- Auto-Salvage(失败片段自动扫描可用段)
- Pre-Flight Check(AI 预测成功率 + Prompt 优化建议)
- 分段抽卡(15s 镜头分前/中/后只重抽失败段)

### W6 升级
- CRDT 实时协作扩展到资产 / 评论
- 跨时区调度
- AI Coach 自动日报
- 客户验收门户
- 三层 Insight 视角(平台主 / PM / 创作者)
- 异常检测告警(Slack/邮件)
- What-If 模拟("若改 Fast 模型省 ¥X")
- ROI 反向闭环(拉 Distribution 数据反向喂 Agent)

### W7 polish(留 Phase 2)
- **34 处硬编码颜色**(emerald/rose/amber 等)→ CSS 变量(主题切换不一致)
- **a11y 散布修复**:focus trap / aria-label / ESC 关闭(ConfirmDialog 已有,其他 dialog 还在散布)
- **listBindings batch** 防 N+1(art-workspace 100 张卡 N+1 性能问题,Mock 阶段不卡)
- **OperationLog action 命名规范化**(asset.create / asset.binding.create / image.generate 混风)
- DB Explorer:
  - inline edit 模式(当前只读)
  - 自定义 SQL 查询模式(read-only,白名单 SELECT 防 injection)
- EN 文案**深度 review**(当前 key 已对齐,但 value 待母语者润色)
- DateTime 国际化升级:补 `useLocale` hook + 时区处理(当前用浏览器 default)

### 跨模块横向
- **ADR-26 Agent 联动接口落地**(Mastra 启动时):
  - 13 个核心 mutation 加 `.meta({ agentTool: { description, sideEffects, examples, costEstimate } })` 元数据
  - 新建 `packages/agent/tools.ts` 收集所有 `.meta.agentTool` → 自动注册 Mastra tool registry
  - `agentTool.requireConfirm: true` 给 reject 类 mutation(reject 类需 human-in-loop)
- 引入 LiteLLM 后统一所有 Provider 调用接口(W5.5 / W4 多 Provider 统一)
- 引入 `next-themes` 替代手写 ThemeToggle(OS 偏好自动同步)
- ColorPicker 让企业租户自定义品牌色
- 高对比 / 色弱友好 主题(无障碍)

---

## 🔮 Phase 3 远期(Schema/字段已预留)

### W3 Wireless Canvas(旗舰)
- 三种 Canvas 模式(剧情脑暴 / 角色关系图 / 自由故事板)
- 与 Linear 视图同源(拖动同步)
- AI 副驾驶(聚类便签 / 建议关系冲突)
- CRDT 多光标
- 字段:`Shot.positionX/positionY` 已预留(W1.2 schema)

### W4 3D 一致性
- Gaussian Splatting 数字分身(30 秒生成 3D 高斯泼溅人物)
- 任意角度参考图生成
- 字段:`Asset.model3dUrl / gaussianUrl` 已预留

### Distribution Hub
- 多平台发布(抖音 / 快手 / YouTube / TikTok)
- 数据回流(播放 / 留存 / 充值 / 广告)
- ROI 分析 + 投流策略 AI 建议

### Plugin SDK + Marketplace
- 第三方插件 SDK
- 模板市场(项目 / 角色 / 风格)
- `ProviderRegistry` 注册中心已就位

### 海外平台合规网关
- TikTok / YouTube / Sora 适配
- 国别敏感词库

---

## 📝 文档 / 协作留尾

### 每次收工后必做(用户操作)
- ✅ 重传 Project 知识库(claude.ai 的 SS Project):
  - `TODO.md`
  - `PROGRESS.md`
  - `README.md`(本次新写)
  - `CHANGELOG.md`(本次新建)
  - `docs/W1-W7-followup.md`(本次新建)
  - `docs/*.md` 若有变更

### 跨设备验证
- ❓ 家里 Mac Studio:`git pull` + 说 `开工,在 mac-studio` 验证 V2 协议接续(已做过 1 次,本批改动后未验证)
- ❓ 出差 Win 笔记本:已主力使用,V2 协议跑顺
- ❓ GitHub 账户对齐(`user.name` / `user.email` 全局固化)+ `gh auth login` 一次性登录(跨设备 push 凭证)

---

## 📊 当前完成度精确盘点

| 阶段 | MVP 完成 | Phase 1.5 留尾 | Phase 2 留尾 | Phase 3 |
|---|---|---|---|---|
| W1 地基 | ✅ 100% | 跨设备验证 / GitHub auth | — | — |
| W2 应用层 | ✅ 100% | Claude Key 真接 | — | — |
| W3 Storyboard | ✅ 100% | 集成测试 / parse 边界 | CRDT / 草图预览 / Canvas | Wireless Canvas |
| W4 Asset Forge | ✅ 100% | **真 ImageProvider** / **合规 API** | 资产关系图谱 | 3D 一致性 |
| W5 Generation | ✅ 100% | **真 Seedance** / cancel 机制(L4) | Multi-model Race / Auto-Salvage | — |
| W5.5 异步 worker | ✅ 100% | L3 concurrency / L5 worker poll / L6 typed Error | L7 批量重抽 / L8 OTel | — |
| W5.6 Media Vault | ✅ MVP | — | 音频波形 / pgvector / BGM 推荐 | — |
| W6 Insight+Collab | ✅ 100% | Invitation UI | CRDT 资产 / What-If | — |
| W7 收尾 | ✅ MVP | **Tauri 真编译** | **34 硬编码颜色** / a11y / N+1 | — |
| W8 实战 | 📋 待启动 | 5 人冷启动 + 1 集实战 | — | — |

**总结**:**W1-W7 MVP 100% 全跑通,核心全流程可演示**。Phase 1.5 关键阻塞:**Tauri 真编译 + 真 Provider 接入 + cancel 机制**。其余 polish + 高级功能留 Phase 2/3。

---

## 🎯 W8 启动 checklist(打勾顺序)

```
[ ] 1. git pull origin main(跨设备同步)
[ ] 2. pnpm install(拉 @tauri-apps/cli 新依赖)
[ ] 3. pnpm db:migrate:deploy(应用 19 migration,含 media partial unique)
[ ] 4. pnpm infra:up(Postgres + Redis + MinIO)
[ ] 5. pnpm dev + pnpm worker:dev(2 个进程)
[ ] 6. /admin/providers 配 Claude Key(剧本分析 + 分镜生成 + 资产拆解必需)
[ ] 7. /admin/providers 配 Seedance Key(视频生成必需,无 Key 时 Mock 兜底)
[ ] 8. /admin/providers 配 NanoBanana Key(资产真出图,Phase 1.5 决定要不要)
[ ] 9. 创建第二个 user(/login 注册 → 给 /admin/users 设为 ADMIN)
[ ] 10. 跑一遍完整流程:
      上传 docx 剧本 → 分析 → 生成分镜 → 加资产 → 自动 @ → 抽卡(真出视频)
      → /admin/api-usage 看 cost 累计
      → /admin/audit 看 OperationLog
      → /library 看 AIGC 自动沉淀的视频
      → /team 拉第二个 user 进项目 + 分配集
      → /admin/reports 看 2 个用户的工作报告
[ ] 11. 跑通无致命 bug → 5 人冷启动会议邀请
[ ] 12. 实战 1 集 7 镜头 → 收集 P0/P1 bug → 紧急 sprint 修
```
