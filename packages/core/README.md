# @ss/core · 业务算法纯函数

> 生成日期:2026-05-24(第 19 轮 audit Sprint D-4)

## 用途

把可单测的业务算法跟 router/adapter 隔离:
- 剧本解析(script.parse)
- 资产拆解(asset.breakdown)
- 提示词编译(asset.compile-prompt / storyboard.video)
- 分镜生成 + 合并(storyboard.generate / mergeShots)
- 成本计算(cost.ledger Decimal.js 精度)

**纯函数优先**:无 side effect,无 db / fs / network 直调,所有依赖通过参数传入。例外:`provider.generate()` 调外部 API 时通过 `@ss/adapters/provider` 注入。

## 模块边界

**依赖**:
- `@ss/shared`(SsError / events / TRAINABLE_TEXT_FIELDS / MAX_LENGTHS)
- `@ss/adapters/provider`(TextProvider / ImageProvider / VideoProvider 调用)

**被依赖**:
- `@ss/api`(所有 router)
- `apps/workers/video-gen/processor`(部分 — 当前直接调 provider,不走 core)

**绝不**:依赖 `@ss/api` / `@ss/db`(违反层次,业务算法不应该知道 router 或 schema)

## 核心入口

| 子模块 | 出口 | 关键 API |
|---|---|---|
| `script/parse.ts` | `parseScriptText(text)` | 场号/时段/内外/人物/动作/对白/旁白 parse |
| `asset/breakdown.ts` | `breakdownAssets(scriptText, opts)` | LLM 调用,拆出 character/scene/prop/effect |
| `asset/compile-prompt.ts` | `compileAssetPrompt(asset, slot)` | 拼接图像生成 prompt |
| `storyboard/generate.ts` | `generateStoryboard(scene, opts)` | LLM 调用,生成单场镜头 |
| `storyboard/merge.ts` | `mergeShots(shots, maxDurationS)` | 按时长自动合并组 |
| `storyboard/video.ts` | `compileShotGroupVideoPrompt(group, ctx)` | 视频抽卡 prompt 拼接 + token 替换 |
| `cost/ledger.ts` | `recordCost(...)` | Decimal.js 累加,防 IEEE-754 漂移 |

## 升级 hook

| 场景 | 改哪里 |
|---|---|
| 加新 LLM Prompt | 加新文件 `<module>/<name>.ts`,导出纯函数 |
| 提升 LLM 解析准确率 | 调 prompt template,但**不改函数签名**(否则全 router 要改) |
| 加新算法(Phase 2 Auto-Salvage) | 新 file in `generation/`,纯函数 |
| 改成本计算精度 | `cost/ledger.ts` Decimal.js 配置 |

## 独立测试

```powershell
pnpm --filter @ss/core typecheck
pnpm --filter @ss/core test   # vitest:script.parse / asset.breakdown / compile-prompt / storyboard.generate / merge / video / ledger
```

## 已知约束

- 所有 LLM 调用必须接受 `{ skipLedger?: boolean }` 选项(允许 router 单点写 ledger,防 Provider 内置 + router 双写)
- 所有 prompt 编译必须输出 `{ positive, negative, references, warnings }`,warnings 让 router 决定是否拒
- compile 函数应可单测(传纯数据 in / 纯字符串 out,不调 provider)
- 任何字段命名变更必须同步 `@ss/shared/constants.ts` TRAINABLE_TEXT_FIELDS / MAX_LENGTHS(单一真相源)
