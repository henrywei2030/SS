# StarsAlign Studio · 主题系统指南

> 适用于：维护现有主题、扩展新主题（高对比 / 色弱友好 / 客户定制色）。

---

## 一、系统总览

```
┌────────────────────────────────────────────────────────────┐
│ Tailwind v4 @theme  (apps/web/app/globals.css)              │
│   --color-background = var(--bg)   ← 不嵌套 hsl()           │
│   ...                                                       │
└────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────┬─────────────────────────────┐
│ :root      (明亮模式)         │ :root.dark  (深夜模式)         │
│   --bg: 0 0% 100%             │   --bg: 0 0% 12%              │
│   --fg: 0 0% 10%              │   --fg: 0 0% 88%              │
│   --card: 0 0% 99%            │   --card: 0 0% 15%            │
│   ...                         │   ...                         │
└─────────────────────────────┴─────────────────────────────┘
                          ↓
                    业务代码中
            bg-[hsl(var(--color-background))]
                          ↓
                  浏览器最终解析为
                  hsl(0 0% 12%)
```

**核心规则**：

1. `@theme` 中的颜色 token 存的是 **HSL 元组字符串**（如 `0 0% 12%`），**不能嵌套 hsl()**。
2. 业务代码使用 `bg-[hsl(var(--color-X))]` 模式，hsl() 在代码侧加。
3. 主题切换只换 `:root.dark` 这一层 CSS 变量，业务代码 0 改动。

---

## 二、添加新主题（如"高对比" / "色弱友好"）

### 步骤 1：在 globals.css 添加 selector 与变量

```css
/* 高对比模式（无障碍） */
:root.high-contrast {
  --bg: 0 0% 0%;          /* 纯黑 */
  --fg: 0 0% 100%;        /* 纯白 */
  --card: 0 0% 8%;
  --border: 0 0% 100%;    /* 全白边框，最高对比 */
  --accent: 60 100% 50%;  /* 亮黄 */
  --muted-fg: 0 0% 95%;   /* 静音文字也几乎全亮 */
  color-scheme: dark;
}

/* 红绿色盲模式 */
:root.colorblind-protan {
  --success: 217 91% 50%;     /* 把绿改成蓝 */
  --warning: 280 65% 60%;     /* 把橙改成紫 */
  --destructive: 30 100% 50%; /* 把红改成橙黄 */
}
```

### 步骤 2：扩展 ThemeToggle 支持 3+ 主题

修改 `apps/web/components/theme-toggle.tsx`：

```tsx
type Theme = 'light' | 'dark' | 'high-contrast';

// 切换逻辑改成循环或下拉
function cycle(): void {
  const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'high-contrast' : 'light';
  ...
}
```

### 步骤 3：更新 THEME_INIT_SCRIPT 支持新值

在 `theme-toggle.tsx` 中：

```js
const VALID_THEMES = ['light', 'dark', 'high-contrast'];
if (VALID_THEMES.includes(stored)) {
  document.documentElement.classList.add(stored);
}
```

---

## 三、修改模块色

模块色用于工作台 6 大入口（导演/美术/AIGC/剪辑/素材/数据）的图标颜色。

```css
@theme {
  --color-mod-director: 217 91% 60%;   /* 蓝 */
  --color-mod-art: 280 65% 60%;        /* 紫 */
  --color-mod-aigc: 180 60% 50%;       /* 青 */
  --color-mod-edit: 142 64% 47%;       /* 绿 */
  --color-mod-library: 38 80% 55%;     /* 琥珀 */
  --color-mod-analytics: 0 65% 55%;    /* 红 */
}
```

业务代码使用：
```tsx
<Icon className="text-[hsl(var(--color-mod-director))]" />
```

---

## 四、Logo 颜色适配主题

Logo 用了 4 个独立变量（在每种主题下重定义）：

| 变量 | 明亮模式 | 深夜模式 | 用途 |
|---|---|---|---|
| `--logo-blue-1` | `217 91% 50%` 深蓝 | `210 80% 65%` 中蓝 | 星系环外圈 |
| `--logo-blue-2` | `217 91% 60%` 中蓝 | `200 90% 75%` 亮蓝 | 星系环中圈 |
| `--logo-blue-3` | `217 91% 75%` 亮蓝 | `200 95% 92%` 冰白 | 星系环高光 |
| `--logo-star` | `0 0% 100%` 白 | `0 0% 100%` 白 | 星核 |

如果要加白色主题（如打印版）：
```css
:root.print {
  --logo-blue-1: 0 0% 0%;
  --logo-blue-2: 0 0% 20%;
  --logo-blue-3: 0 0% 40%;
  --logo-star: 0 0% 0%;
}
```

---

## 五、后台字号系统（admin-pane）

后台区域（`/admin/*`）需要更易读，所以包裹 `<div class="admin-pane">`，自动应用：

| 元素 | 前台默认 | admin-pane |
|---|---|---|
| body | 13px | 14px |
| h1 | 20px | 22px |
| h2 | 16px | 18px |
| input/select 高度 | 32px | 36px |
| button | 13px | 13.5px |
| `text-[12px]` 等 | 原值 | 自动 +1px |

新增前台区域要放大字号？给元素加 `admin-pane` 类即可。

---

## 六、不要做的事

| ❌ 反模式 | ✅ 正确做法 |
|---|---|
| 在 React 组件里写 `style={{ background: '#1F1F1F' }}` | `className="bg-[hsl(var(--color-background))]"` |
| `bg-[hsl(0_0%_12%)]`（硬编码灰度） | `bg-[hsl(var(--color-card))]` |
| @theme 中写 `--color-x: hsl(var(--y))` | @theme 中写 `--color-x: var(--y)`（不要嵌套 hsl）|
| 创建 `.theme-blue` `.theme-red` 等具体颜色类 | 用 `--color-mod-*` 模块色 token |
| 给组件写 `:root.dark .my-component {...}` | 让组件用 token，让 token 在 :root.dark 切换 |

---

## 七、调试与验证

```bash
# 1. 看当前 CSS 变量值
# 浏览器 DevTools → Elements → :root → Computed → 过滤 "--"

# 2. 手动切换主题（浏览器控制台）
document.documentElement.classList.toggle('dark');

# 3. 跑 typecheck 确认无 token 拼写错误
corepack pnpm --filter @ss/web exec tsc --noEmit
```

---

## 八、未来计划（Phase 2）

- [ ] 引入 `next-themes` 替代手写 ThemeToggle，获得 OS 偏好同步、SSR 缓存
- [ ] 添加 ColorPicker 让企业租户自定义品牌色
- [ ] 添加 Reduced Motion 模式（无障碍）
- [ ] 添加 Print 模式（导出工作报告时使用）
