# moyu.info 二次校验 + 设计元素归档

> 日期:2026-05-24
> 方式:Claude in Chrome 扩展真浏览(已登录态)
> 范围:docs/pricing 二次校验 + 后台 console 全部页 + 设计要素

---

## § 1. 二次校验结果 ✓

### 文档(docs/integrations/moyu-full-docs.md)
| 章节 | 实测长度 | 归档长度 | ✓ |
|---|---|---|---|
| 素材库接口文档 | 24106 | 24106 | ✓ |
| Seedance 2.0 视频 | 8904 | 8904 | ✓ |
| 24 章 nav-item | 全部 click 验证 | 全部归档 | ✓ |

**结论**:全部 24 章 docs + 4 个 has-submenu 主项内容与归档一致,无丢失。

### 价格(docs/integrations/moyu-pricing.md)
- 文本: 95 / 期望 95 ✓
- 图片: 12 / 期望 12 ✓
- 视频: 35 / 期望 35 ✓
- 总: 142 + 6 暂未分配 = 148 ✓

**结论**:148 模型完整,价格 + 描述 + 标签全到位。

---

## § 2. 站点设计要素(配色 / 布局)

### 整体风格
- **品牌色**:紫色渐变(`#7c3aed` 紫主 + `#a855f7` 渐变)
- **强调色**:橙红 #f97316(CTA 按钮:联系客服购买)、绿色(成功)、红色(危险:删除/禁用)
- **背景**:浅紫渐变(顶部 header)+ 白底卡片
- **字体**:中文无衬线 + 数字 Inter / 系统字
- **图标**:emoji + lucide-style 线条 icon 混用
- **圆角**:卡片 12-16px,按钮 8px(柔和)

### 顶部 Header(全站统一)
```
[Logo魔芋AI] [Tag: 安全第一财务合规的企业级模型平台]
                       [首页] [模型广场] [Token优惠套餐] [智能应用广场] [开发文档] [联系客服]
                                                          [🔔通知] [🌗主题] [中/EN] [💼 控制台] [用户头像]
```
- 一行,中线对称
- 用户头像 + 下拉
- 通知 / 主题 / 语言 / 控制台 4 个常驻 icon

### 主题切换
- "切换主题" button(我们项目目前未做亮/暗双主题)
- 配色变量化,主题切换无刷新

### Footer
```
© 2026 武汉市魔芋数字科技有限公司. 版权所有 | 鄂ICP备2026006748号
```
- 极简,只有公司信息 + ICP

---

## § 3. 后台 console 结构(强借鉴价值)

### Sidebar 分区(我们项目 admin 可参考)
```
体验中心
  📝 文本对话(playground)
  🎨 图片生成
  🎬 视频创作 ▼

个人中心
  📊 数据看板  ← /console 默认页
  🔑 令牌管理  ← API key CRUD
  📈 消费日志  ← cost ledger 明细
  💰 钱包管理  ← 充值
  ⚙️ 个人设置

优惠中心
  🎁 我的套餐
  📃 套餐日志

报表中心
  📄 用户账单
```

**对比我们项目**:
- 我们 `/admin` 是平台主视角(用户管理 / 报告 / 审计)
- moyu console 是**租户视角**(我个人余额 / 我个人 token / 我个人消费)
- Phase 2 我们 SaaS 化时,租户视角应学 moyu console 分区

### 数据看板(/console)— KPI 卡 + 图表
**4 KPI 卡(横向)**:
1. 账户数据: 当前余额 ¥312.94 / 历史消耗 ¥214.79 / [充值] 按钮
2. 使用统计: 请求次数 52 / 统计次数 7
3. 资源消耗: 统计额度 ¥3.99 / 统计 Tokens 252,646
4. 性能指标: 平均 RPM 0.005 / 平均 TPM 168.431

**4 个图表(2x2 grid)**:
- 消耗分布(stacked bar,时间轴 × 模型)
- 消耗趋势(折线,时间序列)
- 调用次数分布(donut pie)
- 调用次数排行(vertical bar)

**对比我们**: `/insights` 已有 KPI 4 卡 + 日趋势 + 模型分布 + Top10。基本对齐 ✓,可加 RPM/TPM 指标。

### 令牌管理(/console/token)— API Key 设计参考
**表格字段**:
| 名称 | 状态(已启用/禁用) | 剩余额度/总额度 | 分组 | 智能体 | 密钥(`sk-xxx****yyyy` + 👁 + 📋) | 可用模型 | 创建时间 | 过期时间 | 操作(禁用/编辑/删除) |

**关键设计**:
- 密钥**默认隐藏**,点 👁 显示明文,点 📋 复制
- 显示后 4 位 + 前 5 位 `sk-jsfR**********WnDA`(我们 maskSecret 只显示后 4 位,可学这个**前 5 + 后 4**风格)
- 顶部:添加令牌 / 复制所选 / 删除所选
- 筛选:搜索关键字 + 密钥 + 查询/重置
- "可用模型":每个 token 限定能用哪些 model(我们 Phase 2 加 token 范围控制)
- "智能体" 字段(Phase 2 Mastra 接入,token 跟 agent 绑定)

**对比我们 `/admin/providers`**: 设计已对齐,但缺:
- token 显示前 5+后 4(只显示后 4)
- "可用模型" 范围控制(Phase 2 加)
- "智能体绑定"(ADR-26 落地时加)

### 消费日志(/console/log)— 关键发现 ⚠️

**表格字段**:
| 时间 | 令牌 | 分组 | 类型(消费) | 模型 | 输入 | 输出 | 花费 | 备注 | 智能体 | 详情 |

**真实数据看到的设计**:
- 视频生成 = **预扣费 + 退还多扣**
  - 16:33:35: `doubao-seedance-1-0-pro` 预扣 ¥10
  - 16:34:48: `doubao-seedance-1-0-pro` 退还 ¥-6.297 备注"退还多扣"
  - 实际净消耗 = ¥10 - ¥6.297 = ¥3.703
- 文本/图片 = **后扣费**(完成后按真实 token 算)
- 详情列:`模型: 12.232 * 分组倍率: 1`(显示分组倍率乘法)
- 导出 CSV ✓ + 时间范围 + 令牌名 + 模型名 + 分组 三段筛选 + 列设置(自定义显示哪些列)

**对比我们 `/admin/api-usage`**: 已有日志但**缺**:
- 预扣 + 退还机制(Phase 1.5 真接 Seedance 必修)
- 分组倍率(我们没分组概念,先不加)
- 导出 CSV(Phase 2 留尾)
- 列设置(可隐藏部分列)— Phase 2 polish

### 钱包管理(/console/topup)— 支付集成参考

**4 KPI**:
- 当前余额 ¥312.94
- 历史消耗 ¥214.79
- 请求次数 52
- **邀请人数 0**(裂变营销)

**充值方式**:
- 支付宝
- 微信支付
- 自定义 1(企业开票通道?)
- **Stripe**(海外支付!)

**预设额度**: 10 / 20 / 50 / 100 / 200 / 500 元

**兑换码充值**(运营活动)

**对比我们**: Phase 1 无充值(项目自用)/ Phase 2 SaaS 化时可学:
- Stripe 国际化必须
- 预设额度(降低决策成本)
- 兑换码(运营拉新)

### 个人页面(/console/personal)
**用户运营技巧** — **每日签到**:
- 累计签到次数
- 本月获得额度
- 累计获得额度
- 日历视图(签到的日期高亮 + 显示当日获得)

**关键学习**:Phase 2 用户黏度低时,可加签到送 AIGC 额度,鼓励每日打开。

---

## § 4. 计费机制深度学习(W5 Phase 1.5 必读)

### 预扣费 + 退还多扣(视频生成)
**流程**:
1. 用户调 `POST /v1/video/generations` 创建 task
2. **服务端立即预扣** ¥10(按 max_duration × 单价 估算)
3. Worker 真生成 + 拿到实际 duration
4. **退还差额**: 实际消耗 ¥3.7,退 ¥6.3 入 ledger 一条"退还多扣"行
5. 用户日志显示两条:`-¥10(预扣)` + `+¥6.297(退还多扣)`

**为什么这样设计**:
- 防止短余额用户挂任务后欠费
- 透明计费(用户看到完整过程)
- 失败时直接退满 ¥10(原路退回,而非"减一笔失败 entry")

**对比我们当前**: 失败时 `costLedgerEntry(success:false, costCny:0)`,可统计但不"退钱"(因为我们没真用户余额)。Phase 2 SaaS 化时必加预扣机制。

### 分组倍率(price × multiplier)
- "Lite-Claude 分组"、"Lite-GPT 分组"、"default(pro) 分组"
- 默认价 × 分组倍率 = 用户实付价
- 不同 user group 不同倍率(VIP / 新客 / 默认)

**对比我们**: 当前固定 `unitPriceCny`,无 group 概念。Phase 2 加 user_group 表可学。

---

## § 5. 模型命名规范(参考)

moyu 全部模型走 OpenAI 兼容,supported_endpoint_types 区分协议:
- `["openai"]` — POST /v1/chat/completions
- `["anthropic", "openai"]` — 双协议
- `["gemini", "openai"]` — 双协议
- `["video"]` — POST /v1/video/generations
- `["image-generation", "openai"]` — POST /v1/images/generations

**model id 命名约定**:
- 厂商前缀:`doubao-` / `claude-` / `gpt-` / `gemini-` / `deepseek-` / `flux-`
- 版本号:`-4-5-20250929`(日期版本)/ `-v3.2`(语义版本)
- 用途后缀:`-codex`(代码)/ `-pro` / `-fast` / `-mini` / `-nano`
- 模式后缀:`-i2v`(image-to-video)/ `-t2i`(text-to-image)

---

## § 6. 我们项目可借鉴清单(优先级)

### 🔴 Phase 1.5 必做(W8 真接 Provider 后)
1. **预扣 + 退还机制**(视频生成)— costLedger 加 `entryType` 字段(prepay/refund/normal)
2. **token 显示前 5+后 4 风格**(我们当前只后 4)— `••••`改成 `sk-XXXX••••••••YYYY`
3. **导出 CSV**(/admin/audit + /admin/api-usage)— 一个 helper utility

### 🟡 Phase 2 可借鉴
4. **充值 + 支付集成**(SaaS 化时):支付宝/微信/Stripe + 预设额度 + 兑换码
5. **签到送额度**(用户黏度)
6. **token 范围控制**(可用模型白名单 + 智能体绑定)
7. **分组倍率**(user_group × price multiplier)
8. **主题切换**(亮/暗 + 主题色)
9. **RPM/TPM 性能指标**(KPI 卡)
10. **列设置**(表格自定义列)

### 🟢 Phase 3 进阶
11. **租户视角 console**(SaaS 化必要)
12. **报表中心 用户账单**(发票合规)
13. **裂变邀请**(邀请人数 KPI + 奖励机制)

---

## § 7. 探索过的页面清单(避免重复)

| URL | 价值 | 已截图 |
|---|---|---|
| `/` | 主页(已在 token-plan 看到 header) | - |
| `/pricing` | 148 模型定价 | ✓ |
| `/token-plan` | 4 类套餐(爆款/新客/新老/充值) | ✓ |
| `/agent-market` | 仅 1 应用 OpenClaw | ✓ |
| `/docs` (iframe → /developer-docs/index.html) | 24 章 API + SDK + Seedance2 | ✓ |
| `/about` | 联系客服 | 未访问(价值低) |
| `/console` | 数据看板(4 KPI + 4 图表) | ✓ |
| `/console/personal` | 个人 + 签到 | ✓ |
| `/console/token` | 令牌管理 | ✓ |
| `/console/log` | 消费日志(预扣+退还机制!) | ✓ |
| `/console/topup` | 钱包/充值(支付宝/微信/Stripe) | ✓ |
| `/console/midjourney` | MJ 专项 | 跳过(我们不用 MJ) |
| `/console/my-plans` | 我的套餐 | 跳过(无套餐数据) |
| `/console/plan-logs` | 套餐日志 | 跳过 |
| `/console/report/personal` | 个人报表 | 跳过(数据少) |

---

## § 8. 没拿到的(权限/无数据)
- `/api/option/` 站点配置(admin 才能调,我们 token 是普通用户)
- `/api/pricing` 程序化 pricing JSON(可能需更高权限)
- `/api/notice` 公告(返回"公告通知。"占位)
- 系统公告 popup(`button "系统公告"`)— 可能含产品更新,但我们已有 docs/pricing 已覆盖

---

## § 9. 关键安全提醒

⚠️ **测试 token 仍在 /console/token 列表显示"已启用"**:
- 名称:test
- 状态:已启用,过期 2026-05-24 17:30:41(1h 后自动过期)
- 当前已**消耗 ¥3.99 / 251k tokens**(claude-sonnet:¥0.0858 + 视频预扣¥10退¥6.297 + image¥0.20 + 其他)
- **建议立即去 moyu 后台手动点"禁用"或"删除"**(防过期前误用)

---

## § 10. 结论

**moyu 站点深度学习收获**:
1. ✅ 二次校验:docs 24 章 + pricing 148 模型与归档**一致**,无丢失
2. ⭐ **新增高价值发现**:
   - 视频**预扣 + 退还多扣**机制(Phase 1.5 必做)
   - 钱包/支付集成 + Stripe(Phase 2 SaaS 化)
   - 签到送额度(用户运营)
   - 分组倍率(SaaS 多租户)
3. ⭐ **设计借鉴**:
   - 紫色品牌 + 圆角卡片
   - sidebar 4 区分(体验/个人/优惠/报表)
   - KPI 4 卡 + 2×2 图表(我们 /insights 已对齐)
   - token 表格 9 字段(详细且不冗余)

下次开工可考虑实现的 P0:
- costLedger 加 entryType 字段(prepay/refund/normal)
- maskSecret 改 `sk-XXXX••••••••YYYY` 风格
- 加 `/admin/api-usage` 导出 CSV
