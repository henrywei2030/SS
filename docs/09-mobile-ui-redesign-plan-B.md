# 手机端 UI 改造 · 方案 B 沉浸暗色工作室(完整备份 · ⏸ 暂缓中)

> 状态:**⏸ 暂缓开发**(2026-06-14 mac-studio 用户指令暂停,转去处理导演模块 v0.2.0)。
> 本文件是该方向的**完整封存**:决策、三方案、研究、已完成、待办、动过的文件、临时密码。恢复开发时从这里接续。
> 设每日提醒(见底部)。

---

## 0. 一句话

把目前桌面优先(零 `@media`、viewport 写死)的 StarsAlign Studio 改造成手机端「一眼舒服、精美、简洁」的体验。用户在三方案中选定 **方案 B 沉浸暗色工作室(电影质感)**。

## 1. 已选定方向:方案 B · 沉浸暗色工作室

- **气质**:电影感 · 高级 · 有氛围。四级抬升表面 + 星垣蓝紫辉光 CTA + 玻璃浮层 + 中置 FAB + 生成中脉冲。
- **参照**:Runway / CapCut / Arc。
- **导航**:底部玻璃 Tab Bar(导演/美术 · 中置辉光 FAB · AIGC/素材库)+ 薄上下文顶栏。
- **为何选它**:贴 AI 影视制作工具身份、长在现有 `#1F1F1F` 暗灰基座上(复用率最高)、辉光只点睛不滥用(同时满足「精美」与「简洁」)。

### 落选的另两案(保留备查)
- **方案 A 极简留白(iOS 原生)**:Grouped inset 清单 + 大留白 + 用光不用阴影。最纯粹简洁。
- **方案 C 卡片化 Bento(活力仪表盘)**:可变尺寸 bento + 模块彩色 accent + 语义色状态角标。一眼读懂、可分三层灰度最快见效。

## 2. 三方案共享的移动地基(选任何方案都要做)

底部 tab bar + 底部 sheet(peek→展开)+ `100vh`→`100dvh`(治 iOS 键盘错位)+ ≥44px 触控热区 + hover-only 操作改触屏常驻/手势 + 复用既有语义五族色/模块五色/lucide/Button/`+2px` 字号系统(不推翻)。

## 3. 关键研究结论(出处)

- 深色用「四级表面」非纯黑反色;以光代影(越抬越亮)非阴影;正文 ~87% 白非纯白;暗底 + 鲜亮强调色。(Muzli / Netguru / Mindinventory / Material Dark)
- Tab bar ≤5 项作主导航;主操作下沉拇指区(屏下 1/3);FAB 仅留新建/撰写;玻璃拟态只用浮层 + 中端机预渲染静态模糊降级。(Mobbin / Muzli / UXPin)
- 底部 sheet peek→展开承载二级内容(带可见 Close + 返回键关,不堆叠);渐进披露;手势配三档 haptic。(NN/g)
- 复杂创作工具移动化:三段式纵向(预览/轨道/底部工具条)、职责收窄 + 跨端接力(移动只做发起/浏览/轻调,复杂编排回桌面)、强默认 + 命令面板。(CapCut/剪映/Runway/Notion/Linear/Figma)
- 排版:正文 ≥16px、5 级以内、字重对比非多字体、8pt 网格、触控 ≥44pt、图标统一线宽。(Toptal / 8pt grid / Material / HIG)

## 4. 已完成(代码在 mac-studio 工作树,**未提交**)

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 0 基座 | `globals.css` 追加:第四级表面 `--surface-raised`、辉光基色 `--glow`、`.min-h-dvh`/`.h-dvh`、`.pt-safe/.pb-safe/.pb-safe-bar/.pb-tabbar`、`.tap-44`、`.glass-bar`(含无 backdrop-filter 降级)、`.glow-accent/.glow-soft/.glow-module`、`@keyframes glow-pulse`/`.animate-glow-pulse`、`.bg-studio-glow`、`prefers-reduced-motion` 降级。`app/layout.tsx` viewport 加 `viewport-fit=cover` + themeColor 改 `#1F1F1F`。 | ✅ 完成 |
| Phase 1 登录页 | `login/page.tsx`:`min-h-dvh` + `bg-studio-glow` 片场暗房辉光 + 顶部安全区 + **footer 溢出修复**(tagline `<sm` 隐藏 + 安全区底距)。`login-form.tsx`:输入框 `h-11`(44pt)+ 蓝色辉光主 CTA(`bg-accent + glow-soft`)。 | ✅ 完成 + 浏览器已验证 |
| Phase 1 Tab Bar/Header | 新建 `components/mobile-nav.tsx`(薄顶栏 + 底部玻璃 Tab Bar + 中置辉光 FAB,复用 rememberedId)。`(workspace)/layout.tsx` 渲染 `MobileNav` + main 加 `.pb-tabbar`。`top-nav.tsx` 加 `hidden md:block`(桌面专属)。 | ✅ 代码完成,**验证被打断**(eval 确认 nav 已 fixed 渲染 5 tab+FAB;视觉截图待复验) |

**动过的文件清单**(恢复时 review 这些):
- `apps/web/app/globals.css`
- `apps/web/app/layout.tsx`
- `apps/web/app/[locale]/login/page.tsx`
- `apps/web/app/[locale]/login/login-form.tsx`
- `apps/web/components/mobile-nav.tsx`(新建)
- `apps/web/components/top-nav.tsx`
- `apps/web/app/[locale]/(workspace)/layout.tsx`

## 5. 待办(恢复后接着做)

- [ ] **复验 Tab Bar/Header**:浏览器 390px 截图确认底栏 + FAB 可见;进项目验证项目内态(顶栏显项目名+返回、导演/美术/AIGC 激活态、FAB 跳灵感创作)。
- [ ] **Phase 1 项目首页 Hero + Bento + 辉光**:`project-overview.tsx` 移动重排(Hero 项目卡 + grid-cols-2 Bento 工作台入口 + 团队折叠行)。
- [ ] **Phase 2 AIGC 工作区三段式重排**(最难屏):`grid-cols-[192px_1fr]` + group-detail 三列 → 三段式纵向 + 底部 sheet。
- [ ] **Phase 2 美术 / 素材库 / 项目列表移动重排**:美术 10+ 按钮顶栏 → segmented + 更多 sheet;素材库 6 列 → 2 列 + 筛选吸顶 sheet;项目列表 7 列栅格 → 卡片流;asset-card 角标减负。
- [ ] **收尾**:底部 sheet 组件(peek→展开,手柄+Close+返回键)、blur 预渲染降级 + reduce-motion 关脉冲、WCAG 辉光对比核验、typecheck 16/16 + 多屏实证。
- [ ] 工作区页 `h-[calc(100vh-2.75rem)]` 在移动端的高度按移动 header(h-12)重算 / 改 dvh。

## 6. ⚠️ 临时改动须知(恢复或随时处理)

- **本机 admin 密码**:验证期曾临时改密,**2026-06-14 收工已恢复 seed 默认 `admin123!@#`**。各机 DB 独立,仅 mac-studio 受影响。
- 手机端代码改动**未提交**,在 mac-studio 工作树。若收工会与导演模块改动混在一起 —— 建议恢复/收工时把手机端改动单独成 commit(`feat(mobile-ui-B): ...`)。

## 7. 可视化参照

三方案的项目首页手机端 mockup 已在会话中渲染对比(方案 A 极简留白 / B 沉浸暗色工作室 / C 卡片化 Bento)。恢复时可重新生成。

---

> 恢复指令参考:「继续手机端方案 B」→ 读本文件 → 从 §5 第一项「复验 Tab Bar」接续。
