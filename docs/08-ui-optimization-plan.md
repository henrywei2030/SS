# 08 · 全界面 UI 优化方案(设计审查 + 落地路线)

> 七二(2026-06-11)· 基于真实界面走查(导演分镜 / AIGC 工作台 / 美术工坊 / 人物编辑 / 管理后台,桌面 1280 视口截图)
> 性质:**设计系统级整改方案**。问题全部来自实际截图与代码 grep 实证,不是泛泛美学清单。
> 总判断:骨架优秀(信息架构清晰、暗色基调统一、功能密度专业),**败在"碎"** —— 字号 9 种、按钮 3 套、
> 图标 emoji/lucide 双轨、颜色硬编码 ~50 处。整改核心是「收敛」而非「重画」。

---

## 0. 设计原则(整改的四把尺)

1. **收敛优先**:不引入新视觉语言,把现有 9 种字号收成 5 级、3 套按钮收成 1 套。改动越机械越好执行。
2. **层级靠留白与字重,不靠边框**:当前嵌套卡片层层描边(section 卡内再嵌卡),视觉噪音的主源。
3. **专业工具的密度,消费产品的可读**:信息密度是本产品优势,保密度、提对比、加呼吸。
4. **一处定义,处处生效**:全部走 CSS 变量 + Tailwind theme token,主题(亮/暗/品牌色)自动跟随 —— 与既有 THEMING.md 路线合流。

---

## 1. 实证问题清单(走查所见,按严重度)

### P0 — 明显破相,立即修

| # | 问题 | 实证 | 修法 |
|---|---|---|---|
| 1 | **顶部主导航文字竖排折行**:「导演」渲染成`导\n演`两行、「素材库」三行,桌面 1280 视口依然如此 | 分镜页/管理页截图,nav item 被压到 ~24px 宽 | nav item 加 `shrink-0 whitespace-nowrap`;空间不足时按响应式断点折叠为 icon-only + tooltip(lucide 图标已有),`lg:` 以上显示全文 |
| 2 | **左列表"符号串"不可读**:分集段卡 `✓1✕1✎`、`🗄` 一串无间隔符号,新用户无法解码 | AIGC 左列表截图 | 改成带 tooltip 的 mini-chip 组(成功 1 · 失败 1 · 手编),图标用 lucide 12px + 数字,间距 4pt |
| 3 | **「0 场」数据显示疑似 bug**:分集列表所有集都显示 0 场,但分镜按场组织 | 分镜页截图(第1集 0 场 63 镜) | 排查 listEpisodes 的 sceneCount 统计源(疑 join 过滤了软删/版本);属工程修复但用户感知是 UI 不可信 |

### P1 — 系统性碎片,本方案主体

| # | 问题 | 实证 | 修法(详见 §2/§3) |
|---|---|---|---|
| 4 | **字号体系碎片化(9 种)**:`text-[10px]` `text-[11px]` `text-[9px]` `text-xs` `text-[length:0.78em]` `0.82em` `0.85em` `0.95em` `text-sm` 混用 | grep:aigc 组件群 4 种 em 写法 + art 组件群 3 种 px 写法并存 | 收敛为 5 级 type scale(§2.1),全局查换映射表 |
| 5 | **按钮三套并行**:`<Button>` 组件 / 手写 `rounded border px-2 py-1 text-[length:0.78em]` / 裸 `<button>` 文本 | group-detail 一个文件里三种都有(自动@/编辑/✨ 是手写,声音面板是 Button) | 全部收口 `<Button>` 4 变体 × 3 尺寸(§2.2);手写按钮 ~40 处机械替换 |
| 6 | **图标 emoji/lucide 双轨**:🖼 🔊 ✓ ✕ ⋯ ⛔ ♪ ✨ 🗄 ❌ 直接当 UI 图标 | AIGC 状态块(✓/✕/⋯/−)、绑定卡(🖼🔊)、警告行(⛔⚠️ℹ️) | emoji 跨平台字形/基线/颜色不可控 → lucide 等价替换清单(§3.2);**仅保留**「✨优化」这类有品牌情绪的装饰性 emoji |
| 7 | **硬编码颜色 ~50 处**:`emerald-500/rose-500/amber-500/blue-500/red-600/zinc-500` 不走主题变量 | TODO 工程卫生既有记录 + 本次截图里 take 状态块/锁图标/排序按钮全是硬编码 | 语义色 token(§2.3):success/warning/danger/info/neutral 五族,亮暗双值一处定义 |
| 8 | **嵌套描边噪音**:页面卡(border)>section 卡(border)>绑定卡(border)>缩略图框(border),四层边框 | AIGC 右侧详情列 | 层级规则(§2.4):一级容器有边框,二级以下用背景深浅 + 分隔线 + 留白;预计删 1/3 的 border |
| 9 | **小字对比度风险**:10px `muted-foreground` 文字大量用于关键信息(提示/推荐理由/进度) | 声音面板、知识库提示行 | muted 色提亮一档至 ≥4.5:1;10px 仅允许用于纯装饰性标注,关键信息下限 11px |

### P2 — 打磨项

| # | 问题 | 修法 |
|---|---|---|
| 10 | 日期 `toLocaleString()` 全串(2026/6/11 09:53:52)占行 | 相对时间(3 分钟前)+ hover 全量;>24h 显示 `6/11 09:53` |
| 11 | 数字不等宽,列表对不齐(¥、时长、QC 分) | 数字场景统一 `tabular-nums` |
| 12 | 滚动容器无视觉提示(历史窗/分集列表) | 统一细滚动条样式 + 底部渐隐遮罩示意"还有内容" |
| 13 | 弹窗/抽屉无 ESC/focus-trap(已知 a11y 债) | 与 a11y 债合并处理 |
| 14 | 空态文案样式不统一(纯文字/虚线框/图标+文字三种) | 统一空态组件:icon(24px muted)+ 一句话 + 主操作按钮 |

---

## 2. 设计 Token 规范(收敛目标)

### 2.1 字号 — 5 级封顶

| Token | 值 | 用途 | 替换映射 |
|---|---|---|---|
| `text-2xs` | 11px / lh 1.35 | 标注、徽章、token chip(**最小字号,10px 及以下全部上调**) | text-[9px] text-[10px] 0.78em→此级 |
| `text-xs` | 12px / lh 1.4 | 辅助说明、表格次要列、时间戳 | text-[11px] 0.82em |
| `text-sm` | 13px / lh 1.5 | **正文默认**(提示词、表单、列表主文字) | 0.85em text-xs(原正文用法) |
| `text-base`| 14px / lh 1.5 | 区块标题、强调正文 | 0.95em |
| `text-lg` | 16px / lh 1.4 | 页面标题 | 现 text-xl 部分降级合并 |

> tailwind.config `fontSize` 覆写这 5 级;CI 加 lint(禁 `text-[..px]` 任意值,白名单豁免)。

### 2.2 按钮 — 1 套组件收口

- 变体:`primary`(主操作,每视图≤1)/ `secondary`(常规)/ `ghost`(工具条高频)/ `destructive`
- 尺寸:`sm`(h-7,工具条)/ `md`(h-8,默认)/ `lg`(h-9,弹窗主按钮)
- 统一:radius `rounded-md`、focus-visible 双层环(`ring-2 ring-accent/60 ring-offset-1`)、disabled 透明度 50 + cursor
- 现有 `<Button>`(shadcn 系)即基座,补 `sm` 高度与 ghost 边框规则即可;**手写按钮全部机械替换**

### 2.3 颜色 — 语义五族(全走 CSS 变量)

```css
:root / .dark {
  --color-success / --color-success-bg     /* 替 emerald/green-600 系 */
  --color-warning / --color-warning-bg     /* 替 amber-500 系 */
  --color-danger  / --color-danger-bg      /* 替 red/rose 系 */
  --color-info    / --color-info-bg        /* 替 blue-500 系 */
  --color-neutral-strong / --color-neutral /* 替 zinc 系状态 */
}
```
- 已有 `--color-accent/border/muted...` 体系不动,本次只是把**状态色**并进来
- 落地即顺手清掉 TODO 里 ~50 处硬编码债;替换表逐文件给(机械可执行)

### 2.4 层级与留白

- 间距走 4pt 网格:组件内 4/8、组件间 12、区块间 16、页面边距 24
- **边框预算**:每个视觉栈最多 1 层 border;二级容器用 `bg-secondary/30` 区分,三级用缩进+分隔线
- 卡片内边距统一 `p-3`(紧凑型)/`p-4`(常规),弃用 p-2 卡

### 2.5 图标

- lucide 统一三档:12(行内标注)/14(按钮内)/16(区块标题);`stroke-width 1.75`
- emoji→lucide 替换清单(节选):🖼→`Image` 🔊→`Volume2` ✓→`Check` ✕→`X` ⋯→`Loader2/Ellipsis` ⛔→`OctagonAlert` ⚠️→`TriangleAlert` ℹ️→`Info` ♪→`Music` 🗄→`Archive` 🔒→`Lock`(已是 lucide ✓)
- 保留品牌情绪 emoji:✨(AI 优化)✨✨(深度)— 它们已是功能命名的一部分

---

## 3. 分界面专项(走查笔记)

### 3.1 顶部导航(全局)
- P0 折行修复(§1-1)外:当前 8 个一级入口 + 搜索 + 主题 + 语言 + 铃铛 + 头像 = 13 个目标,**超过认知负荷**
- 建议:`素材库/数据/团队` 在 `lg` 以下并入「更多」;搜索(⌘K 未实装)在实装前隐藏占位,避免"死按钮"

### 3.2 导演 · 分镜工作台
- 表格三列(镜号/角度景别·音效/剧本内容)信息密度好;但「3.0s」「2.0 s」时长 chip 样式三种、♪ 行与正文无视觉区分
- 改:时长统一 `text-2xs tabular-nums` 圆角 chip;♪ 音效行加 `text-info` + 左侧 2px 色条;镜号列定宽防抖
- 左侧分集卡:状态徽章(已发布/分镜已生成)颜色语义化(§2.3),进度数字 tabular-nums

### 3.3 AIGC 工作台(本次新功能落点,优先打磨)
- 右栏 section 四层描边问题最重(§1-8);体检卡八维 chips 是亮点,保留但 chip 配色走语义 token
- 历史窗(本次已改 2 条高)补 §1-12 渐隐遮罩;take 状态块 ✓/✕/⋯ → lucide + 语义色
- 「自动 @ / 编辑 / ✨AI 优化 / ✨✨深度」工具条 → ghost-sm 按钮统一,当前手写样式即将被替换的典型样本

### 3.4 美术工坊
- 人物卡:底部渐变上的状态 chips 可读性好;右上绿点(本次新增)与锁定图标并排时加 2px 间距;卡片标题 12px→13px
- 编辑抽屉:左表单/中生成/右已确认 三栏结构清晰;「已通过合规审查」绿字徽章样式可直接进组件库当 `OverlayBadge`

### 3.5 管理后台
- 侧栏分组(OVERVIEW/AI & CONTENT/TEAM/SYSTEM)是全站最规范的导航,**以它为基准向外推广**
- binding 行的红色警告(moyu-gpt-5-4 不在已注册 Provider)样式好;但 key 名 `binding.xxx` 等宽字体缺失 → `font-mono text-2xs`
- 下拉 select 原生样式与暗色主题割裂 → 换 shadcn Select(一次性,~10 处)

---

## 4. 落地路线(可直接排期)

| 阶段 | 内容 | 工作量 | 验收 |
|---|---|---|---|
| **P0(半天)** | 导航折行修复;左列表符号串→chip;「0 场」计数排查 | 3 个点改 | 1280/1440/桌面壳三视口截图无折行;新人能读懂列表 |
| **P1-a(1 天)** | token 落地:fontSize 5 级 + 语义色变量 + 按钮组件补全;lint 规则上线 | tailwind.config + globals.css + button.tsx | typecheck/lint 过;新代码无法再写任意字号 |
| **P1-b(2 天)** | 机械替换:字号映射 / 手写按钮→Button / emoji→lucide / 硬编码色→token,按目录分 4 批(aigc→art→director→admin),每批截图对比回归 | ~40 文件批量 | grep 零残留(`text-\[\d+px\]`、状态色裸类名);视觉回归截图对照 |
| **P1-c(半天)** | 边框预算整改(AIGC 右栏先行)+ 留白网格 | 重点 5 个组件 | 同屏 border 数减 ≥1/3 |
| **P2(后续塞缝)** | 相对时间/tabular-nums/滚动渐隐/空态组件/a11y(与既有债合并) | 零散 | 各点独立验收 |

**不做清单**(防过度设计):不换字体家族(系统栈够好)、不加动效体系(工具产品克制)、不做亮色主题重设计(变量化后自然受益)、不重排信息架构(现有 IA 是优势)。

---

## 5. 度量与回归

- 整改前后各留一套六视图截图(分镜/AIGC/美术/编辑抽屉/素材库/admin)进 docs/ui-baseline/
- 量化目标:任意值字号 0 处(白名单外)/ 硬编码状态色 0 处 / 手写按钮 0 处 / emoji 图标≤2 种(✨系)
- 桌面壳(.dmg)与 web 双形态各过一遍 P0 项(导航折行在窄窗桌面壳更易复现)

---

## 6. 执行记录(七二第六波 · 2026-06-12 mac-studio)

> 记录方案实际执行进度 + 落地中发现的「优化修订」(对原方案的纠偏)。

### 已落地
- **P0**(七二第五波):导航折行 / 符号串→chip / 「0场」破案 — 全部已修。
- **P1-a token 基座**:
  - ✅ **语义五族色变量**:globals.css 新增 `--color-{success,warning,danger,info,neutral}` + `-bg` 淡底,亮/暗双值(base success/warning/info 此前已有,本次补 `-bg`/danger/neutral)。
  - ✅ **Button 组件**:核对发现**已完备**(default/secondary/outline/ghost/destructive + sm `h-7`/default/lg/icon)— 原方案「补 sm 高度与 ghost 规则」**无需做**。
- **P1-b 批①(AIGC 工作台)+ P1-c(AIGC 边框)**:
  - `group-detail.tsx`:14 emoji→lucide · 12 色→语义变量 · 4 处去嵌套描边
  - `video-preview-section.tsx`:11 emoji→lucide · 20 色→语义变量
  - `aigc-workspace.tsx`:5 色→语义变量
  - 浏览器实证:lucide 图标渲染正常、语义色生效、✨系保留、**零 console 错误**、typecheck 16/16。

### 优化修订(落地中纠偏)
1. **⚠️ 字号 5 级 token 迁移暂缓(重要纠偏)**:globals.css 已有一套**上线的全局 +2px 字号系统**(2026-06 用户需求「所有文字增大约 2px」:把 `text-[Npx]` 任意值整体映射 +2,admin-pane 专属再放大)。原方案的「9 种→5 级 + 禁任意值」与之**直接冲突** —— naive 迁移会推翻用户的 +2px 诉求,且 ~428 处高 churn 回归风险大。**修订**:保留 +2px 系统;字号收敛降级为「软约束」(新代码用语义级 `text-2xs/xs/sm/base/lg`,旧代码随 +2px 映射保留,lint 仅警告不阻断)。
2. **语义色非从零建**:base 已有,本次是补全 `-bg`/danger/neutral + 机械接入。
3. **Button 已完备**:P1-a 该项跳过。
4. **relay 素材同步**(本波顺带):`asset-generate`/`aigc-keyframe` 生成图补 `syncMediaToRelay`(详见 PROGRESS)。

### 待续(机械重复 AIGC 模式,每批截图回归)
- **批② 美术工坊**(`art/`,17 文件)· **批③ 导演分镜**(`director/`,18 文件)· **批④ 管理后台**(`admin/`,35 文件,内部工具优先级低)。
- **lint 守卫**(禁裸状态色类名 + 字号软警告)待批次清完再上,避免存量噪音。
- P2 打磨项(相对时间/tabular-nums/滚动渐隐/空态组件)按原计划塞缝。
