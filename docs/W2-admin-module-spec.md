# W2+ Admin 模块详细规范（自建数据库浏览 + API Key 管理）

> ⚠️ **历史规划文档 · 已 100% 实现**(见 docs/03-roadmap-and-progress.md「W7 后台三件套 ✅」)。保留作设计史料,功能现状以代码为准。
>
> 取代 Prisma Studio，提供品牌完全自有的后台管理界面。
> 浏览器标题：`星垣工坊 · 后台管理 / StarsAlign Studio · Admin`
> Changelog / About 全部链接到 SS 自己的仓库。

## 背景

W1 期间我们用了 `pnpm db:studio`（Prisma Studio）作为应急的数据库可视化工具，但它有两个问题：
1. 浏览器标题显示 "Prisma Studio"，品牌不属于我们
2. 设置/Changelog 链接到 Prisma 团队的 GitHub，团队成员会困惑

因此 **W2 起 Prisma Studio 仅作 dev 个人调试用**，**团队使用的后台一律走 SS 自建 Admin**。

---

## Admin 模块路由树（W2 起实现）

```
/admin
├── /                         # Dashboard（总览驾驶舱）
│
├── /providers                # AI Provider 管理 ★ 本次重点
│   ├── /                     #   列表（带 apiKeyMasked / 配置状态 / 单价）
│   └── /[id]                 #   详情：设置/清除 API Key、测试连接、改单价/限流
│
├── /prompts                  # 提示词模板
├── /styles                   # 风格管理
├── /presets                  # 预设模板
│
├── /users                    # 全局成员管理
├── /audit                    # 操作日志
├── /reports                  # 工作报告
│
├── /db-explorer              # ★ 数据库浏览器（替代 Prisma Studio）★
│   ├── /                     #   表清单 + 行数 + 字段定义
│   ├── /:table               #   表详情：分页/筛选/排序/CSV 导出
│   └── /:table/:id           #   单行详情：JSON 视图 + 关联表跳转
│
└── /settings                 # 系统设置（SystemSetting 表）
    ├── /branding             #   品牌名/Slogan
    ├── /security             #   主密钥轮换、操作日志保留天数
    └── /features             #   特性开关
```

---

## DB Explorer 详细设计

### 目标
让团队 owner / admin 能在浏览器里直接看 / 改数据库（替代 Prisma Studio），但全程 SS 品牌。

### 技术方案
**不接入第三方工具，自己写一个轻量的 React 表格 UI。**

- 后端：tRPC `admin.db.*` 路由，基于 Prisma 元数据
- 前端：shadcn/ui Table + TanStack Table + Zod 表单
- 数据：直接走 Prisma Client（已经在用），无需新依赖

### 核心功能

| # | 功能 | 实现要点 |
|---|---|---|
| 1 | 表清单 | `prisma._dmmf.modelMap` 拿到所有 model + 字段定义 |
| 2 | 行列表 | 分页（cursor）+ ILIKE 全字段搜索 + 字段排序 |
| 3 | 行详情 | 关联字段渲染为链接，可跳转 |
| 4 | 编辑行 | Zod schema 验证（来自 @ss/shared/schemas） |
| 5 | 删除行 | 软删除走 deletedAt；硬删除需 owner 二次确认 |
| 6 | 导出 CSV/JSON | 客户端 Blob 下载 |
| 7 | SQL 控制台 | 仅 admin 可用，执行 SELECT-only 查询（防御性 WHERE 检查） |
| 8 | 写操作日志 | 所有 Admin 操作必经 OperationLog 落库 |

### 权限
- `isAdmin=true` 才能进 `/admin/*`
- DB Explorer 写操作额外要求二次密码确认
- 所有动作记 OperationLog

---

## API Key 后台管理 UI（/admin/providers）

### 列表页（`/admin/providers`）

```
┌─────────────────────────────────────────────────────────────────────────┐
│ AI Provider 配置                                       [+ 新建 Provider] │
│ 在此统一配置所有 AI 模型的 API Key，加密存储到数据库                       │
├─────────────────────────────────────────────────────────────────────────┤
│ ☐  Provider                类型     状态        Key             单价      │
│ ☐  Seedance 2.0           视频    ● 已配置     ••••XYZ7        ¥1.00/秒  │
│ ☐  Seedance 2.0 Fast      视频    ● 已配置     ••••XYZ7        ¥0.67/秒  │
│ ☐  Nano Banana Pro        图片    ○ 未配置     —               ¥0.53/张  │
│ ☐  GPT Image 2            图片    ○ 未配置     —               ¥0.04/张  │
│ ☐  豆包 1.5 Pro            文本    ○ 未配置     —               ¥0.005/k │
│ ☐  Claude Sonnet 4.5      文本    ● 已配置(env) ENV: ANTHRO... ¥0.022/k │
│ ☐  火山引擎合规             合规    ○ 未配置     —               ¥0.10/次 │
└─────────────────────────────────────────────────────────────────────────┘
```

### 单个 Provider 详情（`/admin/providers/seedance-2.0`）

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Seedance 2.0（视频 · 标准）                                              │
│ providerId: seedance-2.0  ·  kind: VIDEO                                  │
├─────────────────────────────────────────────────────────────────────────┤
│ ▸ API 配置                                                                │
│   API URL:    [https://ark.cn-beijing.volces.com/api/v3      ]            │
│   API Key:    ••••XYZ7   [设置 Key]  [清除 Key]  [测试连接]              │
│                上次更新：2026-05-21 15:30 · 操作人 admin                   │
│                来源：数据库（加密存储）                                     │
│                                                                          │
│ ▸ 计费规则                                                                │
│   单价:       [1.000000  ] CNY / [second▾]                                │
│                                                                          │
│ ▸ 并发与限流                                                              │
│   最大并发:   [5  ]                                                       │
│   每分钟限流: [30 ]  RPM                                                  │
│                                                                          │
│ ▸ 默认参数                                                                │
│   {"maxDuration": 10, "defaultDuration": 5}                              │
│                                                                          │
│ ▸ 健康度                                                                  │
│   评分: 1.0/1.0  ·  上次失败: 无                                          │
│                                                                          │
│             [保存]                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 设置 Key 弹窗

```
┌──────────────────────────────────────────────┐
│ 设置 API Key                          [X]    │
├──────────────────────────────────────────────┤
│ Provider: Seedance 2.0                       │
│                                              │
│ API Key:  [_________________________]   👁     │
│                                              │
│ ⚠️ 该 Key 将通过 AES-256-GCM 加密存储到数据库 │
│    解密密钥来自 APP_MASTER_KEY，请妥善保管。  │
│                                              │
│              [取消]    [测试并保存]           │
└──────────────────────────────────────────────┘
```

操作 = 调 tRPC `admin.provider.setApiKey({ providerId, apiKey })`
→ 后端 `setProviderApiKey()` (已在 `packages/adapters/provider/index.ts` 实现)
→ 加密 → 数据库 → 失效缓存
→ 自动跑一次 testConnection() 验证连接
→ 写 OperationLog

---

## 其他需要鲜明品牌化的点

### 浏览器标签 / 网站元信息

`apps/web/app/layout.tsx` 在 W2 起手时设置：

```ts
export const metadata = {
  title: {
    default: '星垣工坊 · StarsAlign Studio',
    template: '%s · 星垣工坊',
  },
  description: '群星垒垣，万剧汇聚 — AI 短剧生产平台',
  applicationName: '星垣工坊',
  icons: { icon: '/favicon.svg', apple: '/apple-touch-icon.png' },
};
```

### Settings / About 页

`/admin/settings/about` 需提供：

- 当前版本号
- ChangeLog（指向 SS **自己**的 GitHub repo，**不是** Prisma / 其他作者）
- 数据库连接信息（脱敏）
- 已激活 Provider 数量
- License 信息
- 团队联系方式

---

## W2 实施顺序

1. **W2 Day 1-2**：apps/web 起手 + 鉴权登录 + 后台壳子
2. **W2 Day 3**：tRPC `admin.provider.*` 路由（list / setApiKey / clearApiKey / testConnection）
3. **W2 Day 4**：Provider 列表页 + 详情页 + 设置 Key 弹窗
4. **W2 Day 5**：SystemSetting 设置页
5. **W3 起**：DB Explorer 模块（可分步迭代）

完成后即可在 QUICKSTART 中把 `pnpm db:studio` 标记为"dev 个人调试用"，团队入口统一指向 `https://[host]/admin`。
