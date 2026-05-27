# R1 设计文档 · `aigc-workspace.tsx` 重构

> 状态:**待拍板**(三十二收工 design)
> 工作量预估:**3-5h**(含验证 + 视觉测试)
> 风险:**中**(改前端核心交互,需要真打浏览器逐步验证)

---

## 1. 现状

**文件**:`apps/web/app/[locale]/(workspace)/projects/[id]/aigc/[episodeId]/aigc-workspace.tsx`

| 维度 | 数字 |
|---|---|
| 总行数 | **1949** |
| 改动累积 | **3335 行 patch + 7 commits**(单文件历史最高累积) |
| useState 数量 | **13** |
| dialog / confirm 态 | **19 处** |
| 主要依赖 | tRPC × N + useAigcProgress + 多个 mutation |

**核心痛点**:
1. 单组件管理太多状态(autoSelect / bindDialog / promptDialog / confirmDialog / fontSize / draftPrompt / selectedTake / aspectRatio / durationS / resolution / audio / watermark / webSearch / refUrl),状态间逻辑耦合
2. 子组件 `GroupDetail` 嵌套深,memoization 边界不清
3. 用户每次新增 AIGC 交互必改这个文件,git conflict 频繁

**已做的优化**(本次重构前的 baseline):
- ✅ 三十收工 S1:抽 `<InflightProgressPanel>` 子组件(timer 隔离,父级不再每秒 re-render)
- ✅ 二十五收工 R7:`selectedGroupId` 用 useMemo + 8 个 GroupDetail handler 用 useCallback

---

## 2. 拆解方案

### 总体结构

```
aigc-workspace.tsx (主壳,~400 行)
├── hooks/
│   ├── use-generation-ui.ts       // dialog + confirm 态聚合
│   ├── use-video-settings.ts      // resolution/audio/watermark/webSearch/refUrl 聚合
│   └── use-aigc-takes.ts          // take 选中 + polling 联动
├── components/
│   ├── group-detail-panel.tsx     // 单 group 的详情面板(从主体抽)
│   ├── take-history-panel.tsx     // 历史 take 列表 + 当前预览
│   ├── binding-dialog.tsx         // 资产绑定 modal
│   ├── prompt-edit-dialog.tsx     // 视频提示词编辑 modal
│   └── inflight-progress-panel.tsx // (已存在)
└── lib/
    └── aspect-helpers.ts          // ASPECT_LABEL/CLASS 常量(从主体抽到共享)
```

### Hook 拆分

**`useGenerationUI`** — 管理对话框 + 确认态:
```ts
function useGenerationUI() {
  const [bindDialogGroupId, setBindDialogGroupId] = React.useState<string | null>(null);
  const [promptDialogGroupId, setPromptDialogGroupId] = React.useState<string | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<ConfirmAction | null>(null);
  return { bindDialogGroupId, setBindDialogGroupId, /* ... */ };
}
```
**收益**:13 useState → 1 hook,主组件 props/state 减半。

**`useVideoSettings`** — 视频生成参数聚合 + 跟随 capabilities:
```ts
function useVideoSettings(capabilities: ProviderCapabilities | null, groupDetail: GroupDetail | null) {
  const [aspectRatio, setAspectRatio] = React.useState<AspectRatio>('16:9');
  const [durationS, setDurationS] = React.useState(5);
  const [resolution, setResolution] = React.useState('720p');
  const [audio, setAudio] = React.useState(true);
  // ... 跟随 capabilities 变化的 useEffect 集中到这里
  return { aspectRatio, setAspectRatio, /* ... */ };
}
```
**收益**:capabilities 切换时 5 个 useEffect 收敛到 1 个 hook。

**`useAigcTakes`** — take 选中 + RUNNING polling 联动:
```ts
function useAigcTakes(takes: Take[]) {
  const [selectedTakeId, setSelectedTakeId] = React.useState<string | null>(null);
  const inflightTake = React.useMemo(() => takes.find(...), [takes]);
  // SSE attemptId 联动
  return { selectedTakeId, setSelectedTakeId, inflightTake };
}
```

### 组件拆分

**`<GroupDetailPanel>`** — 单个 group 完整面板(4 区:资产 / 剧本 / 提示词 / 视频):
- 接 `groupId / project` props
- 内部:listGroupDetail + listBindings + binding cell + 提示词卡 + take 历史
- **关键**:每个 GroupDetailPanel 独立 useQuery,父组件不再传 8 个 callback

**`<TakeHistoryPanel>`** — 当前预览 + 历史 take 列表 + 自动播 + 删除:
- 接 `takes / selectedTake / onSelectTake / onDelete` props
- 内部:`<video>` 元素 + onLoadedMetadata 自动播 + 历史 grid

**`<BindingDialog>` / `<PromptEditDialog>`** — modal 抽出(原本 inline JSX):
- 各自独立 component,父组件只管 open/close 状态

---

## 3. 实施步骤(原子化 + 可中断)

按"先小后大,每步可独立 commit"的原则:

### Phase A:抽 hooks(零风险,纯重构)
1. **`use-generation-ui.ts`**(20min)
   - 把 4 个 dialog state 抽到 hook
   - 主组件用 `const ui = useGenerationUI()` 替原 13 个 useState 中的 4 个
   - typecheck + 浏览器实测 dialog 开关 OK
2. **`use-video-settings.ts`**(30min)
   - 抽 6 个 video setting state + 5 个 useEffect
3. **`use-aigc-takes.ts`**(20min)

### Phase B:抽组件(中风险,改 JSX 树)
4. **`<BindingDialog>` 抽出**(30min,最简单)
5. **`<PromptEditDialog>` 抽出**(30min)
6. **`<TakeHistoryPanel>` 抽出**(45min,JSX 量大)
7. **`<GroupDetailPanel>` 抽出**(60-90min,最难,涉及 8 个 callback 改 prop)

### Phase C:验证(关键)
8. typecheck 16/16 + tests 95/95
9. **浏览器实测**:
   - 创建 group → 资产绑定 → 编辑 prompt → 生成视频 → 自动播 → 删除 → 重抽
   - 切换 group(URL 锚点)
   - 切 provider 看 aspectRatio fallback
10. commit 一次大 PR(7 phase 可拆 commit 或合一,看个人偏好)

---

## 4. 风险与缓解

| 风险 | 概率 | 缓解 |
|---|---|---|
| Hook 依赖项漏(useEffect 闭包陈旧 state) | 中 | 每抽一个 hook 立即浏览器跑一遍 |
| `<GroupDetailPanel>` 拆分时 callback 漏传 | 高 | 用 TypeScript 严格 props,prop 漏传必报错 |
| memoization 边界变化导致额外 re-render | 低 | 抽完后 React DevTools Profiler 量 |
| 用户在改造期间使用主分支 | 中 | 在 feature branch 做,合并前 stage rebase |

---

## 5. 验收标准

- [ ] typecheck 16/16
- [ ] tests 95/95
- [ ] 主组件 `aigc-workspace.tsx` ≤ 500 行
- [ ] 浏览器实测 AIGC 全链路通过(创建 group → 抽卡 → 选 → 历史 → 删 → 重抽)
- [ ] React Profiler:父组件渲染次数 ≤ 改造前的 50%

---

## 6. 不在范围(留下次 design)

- AIGC 数据流改造(继续用 tRPC,不引入 Zustand)
- SSE 协议重构(已 work,不动)
- 性能 hot-reload(改组件结构后视觉测试已经够)
