# Provider 后台录入设计 · 4 类入口统一抽象

> 设计日期:2026-05-24(W8 真接 moyu 后总结)
> 实施目标:让 admin 在 `/admin/providers` 后台一次性录入**任意** API,业务零改动

---

## § 1. 用户场景(支持的 4 类 API 入口)

### 类型 A:OpenAI 兼容中转站
- **代表**:moyu.info / OpenRouter / OneAPI 自部署 / 火山引擎方舟 / 阿里 DashScope / 腾讯混元
- **协议**:`/v1/chat/completions` + `/v1/images/generations` + `/v1/video/generations`(可选)
- **特点**:1 个 token → 一堆模型(claude/gpt/gemini/deepseek/豆包/seedream/seedance)
- **入场成本**:低,一个站搞定多 Provider
- **示例**:`apiUrl=https://www.moyu.info/v1`,`apiKey=sk-xxx`,`model=claude-sonnet-4-5-20250929`

### 类型 B:Poe 订阅
- **代表**:poe.com
- **协议**:`/v1/chat/completions`(OpenAI 兼容)
- **特点**:按月订阅 + 包月 token / API 额度
- **入场成本**:中,需要订阅
- **示例**:`apiUrl=https://api.poe.com/v1`,`apiKey=<Poe token>`,`model=claude-3-7-sonnet`

### 类型 C:Provider 直连(个人订阅)
- **代表**:OpenAI 官方 / Anthropic 官方 / Google AI Studio / 火山引擎 ARK 直连
- **协议**:各自原生(OpenAI 是 /chat/completions,Anthropic 是 /messages,Gemini 是 /generateContent)
- **特点**:**最贵但最稳**(无中转商风险)+ 计费精确 + 限速最宽松
- **入场成本**:高(国内访问 OpenAI/Anthropic 需要解决网络)
- **示例**:`apiUrl=https://api.anthropic.com/v1`,`apiKey=sk-ant-xxx`(走 ClaudeTextProvider 原生)

### 类型 D:本地模型
- **代表**:Ollama / vLLM / LM Studio / LocalAI / Llama.cpp server
- **协议**:OpenAI 兼容(几乎所有本地推理 server 都模拟 OpenAI)
- **特点**:**零成本**(只费电)+ 隐私 + 离线 + 速度限本机 GPU
- **入场成本**:中(装 Ollama / 拉模型)
- **示例**:`apiUrl=http://localhost:11434/v1`,`apiKey=ollama`(占位),`model=qwen2.5:32b`

---

## § 2. 统一抽象模型

### 2.1 4 类入口在 ProviderConfig 表的字段映射

| 字段 | A: 中转站 moyu | B: Poe | C: 直连 Claude | D: 本地 Ollama |
|---|---|---|---|---|
| `providerId` | `relay-claude-sonnet-4-5` | `poe-claude-3-7-sonnet` | `claude-sonnet-4-5` | `local-qwen-32b` |
| `displayName` | Claude S4.5 via moyu | Claude S3.7 via Poe | Claude S4.5 直连 | Qwen 32B 本地 |
| `kind` | TEXT | TEXT | TEXT | TEXT |
| `apiUrl` | `https://www.moyu.info/v1` | `https://api.poe.com/v1` | `https://api.anthropic.com/v1` | `http://localhost:11434/v1` |
| `apiKeyEnc` | (sk-xxx 加密) | (Poe token 加密) | (sk-ant-xxx 加密) | (`ollama` 占位 加密) |
| `unitPriceCny` | 0.025 | 0(订阅制) | 0.108(精确) | 0 |
| `defaultParams.protocol` | `openai-compat` | `openai-compat` | `anthropic-native`(默认) | `openai-compat` |
| `defaultParams.defaultModel` | `claude-sonnet-4-5-20250929` | `claude-3-7-sonnet` | `claude-sonnet-4-5-20250929` | `qwen2.5:32b` |
| `defaultParams.source` | `relay`(中转) | `subscription`(订阅) | `direct`(直连) | `local`(本地) |
| `isActive` | admin 启用时 true | 同 | 同 | 同 |
| `maxConcurrent` | 10 | 5(订阅一般慢) | 10 | 1-2(本地慢) |
| `rateLimitRpm` | 100 | 60 | 100 | 999(本地无限) |

### 2.2 关键洞察:**A/B/D 都走 OpenAICompatProvider,只有 C 用原生**
- A/B/D 全是 OpenAI Chat Completions 兼容,**复用同 1 个 `OpenAICompatTextProvider` 类**,只配 apiUrl 不同
- C 用 `ClaudeTextProvider`(Anthropic 原生 /messages)/ 未来的 `OpenAITextProvider`(OpenAI 直连)等

**意味着**:Phase 1.5 真接入只需要:
- ✅ `OpenAICompatTextProvider` 已就位(本轮)
- ✅ `ClaudeTextProvider` 已就位(W2)
- ⏳ 未来 `OpenAITextProvider` / `GeminiTextProvider`(可选,Phase 2)

---

## § 3. 后台 UI 改进设计

### 3.1 当前 /admin/providers UI(已实装)
```
┌─────────────────────────────────────────────────────────────┐
│ AI Provider 配置                                            │
├─────────────────────────────────────────────────────────────┤
│ providerId          kind   API Key         活跃   操作     │
│ relay-claude-...     TEXT   ••••xzRr        ✓     [测试]   │
│ relay-seedance-...   VIDEO  (未配)          ✗     [测试]   │
│ claude-sonnet-4-5   TEXT   ••••(env)       ✗     [测试]   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 推荐改进(Phase 1.5)— 按 source 分组 + 一键启用一类
```
┌─────────────────────────────────────────────────────────────┐
│ AI Provider 配置                  [+ 添加自定义 Provider]   │
├─────────────────────────────────────────────────────────────┤
│ 📦 中转站 (relay)                                            │
│   moyu / OpenRouter:1 个 token 覆盖多模型                   │
│   ┌──────────────────────────────────────────────┐           │
│   │ [设中转站 token]  套用到 8 个 Provider [启用]│           │
│   └──────────────────────────────────────────────┘           │
│   ✓ relay-claude-sonnet-4-5   25 元/Mtoken  ✓启用 [测试]    │
│   ✓ relay-seedance-1-0-pro    1 元/秒        ✓启用 [测试]    │
│   ☐ relay-seedream-4-0        0.10 元/张     ✗未启 [测试]    │
│                                                             │
│ 🎁 Poe 订阅(包月 token,model 范围 PoE 决定)                 │
│   ☐ [+ 添加 Poe Provider]                                    │
│                                                             │
│ 🏢 个人订阅 / 官方直连                                       │
│   ☐ claude-sonnet-4-5 (Anthropic 直连)  108 元/Mtoken       │
│   ☐ gpt-4o (OpenAI 直连)                                     │
│                                                             │
│ 🏠 本地模型(localhost / 内网)                                │
│   ☐ [+ 添加 Ollama]                                          │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 "+ 添加自定义 Provider" 表单
```
新增 Provider:
  [类型 ▼ 中转站|Poe|直连|本地]
  providerId:  custom-my-poe-claude        (kebab-case,前缀代表来源)
  displayName: Claude via Poe (个人订阅)
  kind:        [TEXT|IMAGE|VIDEO ▼]
  apiUrl:      https://api.poe.com/v1
  apiKey:      ····················         [测试连接]
  
  defaultModel: claude-3-7-sonnet
  protocol:    [openai-compat ▼]  (中转/Poe/本地都用 openai-compat;直连 Claude 用 anthropic-native)
  
  unitPriceCny: 0       (订阅制设 0;直连 0.025 这种;本地 0)
  unitName:    ktoken
  maxConcurrent: 5
  rateLimitRpm: 60
  
  [取消]  [保存 + 测试]
```

---

## § 4. 安全机制完整清单(已实装 + Phase 1.5 加强)

### 4.1 ✅ 已实装(本轮 + 之前)
- **AES-256-GCM 加密**:`packages/adapters/src/crypto.ts` encryptSecret/decryptSecret
- **APP_MASTER_KEY 派生**:64 字符 hex(openssl rand -hex 32),非 hex 时 SHA-256 派生 + warn
- **maskSecret 遮罩**:UI 只显示后 4 位 `••••xzRr`
- **adminProcedure 守门**:仅 isAdmin 可查/改/测
- **rateLimit per-admin**:setApiKey 默认无限(改 admin 不应频繁);testConnection 5 次/分(防误点刷 token)
- **OperationLog 全审计**:setApiKey / clearApiKey / setActive / updatePricing / testConnection 全入库
- **OperationLog 不含 plain key**:`keyMasked: '••••xxxx'` 入 audit log,绝不入 plaintext
- **sanitizeErrorMsg**:testConnection 错误响应脱敏,防 Provider URL/token 泄漏
- **dryRun 默认 true**:image/video testConnection 不真生成,防点击刷钱

### 4.2 ⏳ Phase 1.5 加强建议
- **预算护栏**(已有 cost ledger BudgetExceededError,加强 Provider-level)
  - 每个 Provider 月度 token / cost 上限(`defaultParams.monthlyBudgetCny`)
  - 超限自动 setActive=false + 推 EventBus PROVIDER_BUDGET_EXCEEDED
- **token 自动 rotate 提醒**
  - `apiKeyUpdatedAt` > 90 天 → admin/health 页面警告"建议 rotate"
- **多 token 故障转移**
  - 一个 Provider 配多个 key(主 + 备),429 自动切备份
- **/admin/health 加 Provider 余额**
  - 调中转站 /api/user/quota 等显示剩余额度(各站接口不同)
- **导出 / 导入 Provider 配置**
  - admin 备份 .env 风格(加密 key 走二级加密)
  - 跨设备同步(Phase 2 云端化前的过渡)
- **审计页面查询接口**
  - filter by action='provider.setApiKey' 看谁改了什么时候
  - 集成 trace requestId 跨链路

### 4.3 🔒 红线(永不做)
- ❌ 明文存 apiKey 任何字段
- ❌ apiKey 写入任何 log / OperationLog / sentry / 监控
- ❌ apiKey 从 API 返回(get 只返 masked)
- ❌ apiKey 走 query string(只 POST body 加密 TLS)
- ❌ 允许非 admin 看 apiKey(adminProcedure 守门)

---

## § 5. 测试矩阵(已 verify)

| 用例 | 命令 | 状态 |
|---|---|---|
| admin login | login API | ✅ smoke 18/18 |
| setApiKey 加密存 | trpc admin.provider.setApiKey | ✅ relay-real-test |
| setActive | trpc admin.provider.setActive | ✅ |
| list 显示 masked | trpc admin.provider.list | ✅ `••••xzRr` |
| testConnection text 真调 | trpc admin.provider.testConnection | ✅ 24ms + tokens=15+5 |
| testConnection image dryRun | dryRun=true | ✅ 配置 OK |
| testConnection video dryRun | dryRun=true | ✅ 配置 OK |
| **script.analyze 真调 LLM** | trpc script.analyze + 中转站 Provider | ✅ 24s + 真返回 |

---

## § 6. 推荐入场顺序(给 admin)

### 第 1 步(¥10 内验证全链路)
1. 在你选的中转站(如 moyu.info / OpenRouter / Poe / OneAPI 自部署)申请 1 个 token,设额度 ¥10 / 月
2. 录入 `relay-claude-sonnet-4-5`(剧本分析)→ 把 apiUrl 改成你的中转站 → setActive → testConnection
3. 上传 1 集短剧本(< 5000 字)→ analyze → 看 8 维评分出来

### 第 2 步(¥50 内跑全模块)
4. 录入 `relay-doubao-seedance-1-0-pro`(视频)+ `relay-doubao-seedream-4-0`(图像)
5. 真触发 1 个资产 breakdown + 1 个 AIGC 抽卡
6. 看 /admin/api-usage / /insights 真有数据

### 第 3 步(¥500 内 W8 实战)
7. 5 人冷启动会议
8. 真做 1 集 7 镜头
9. 收集 P0/P1 bug

### Phase 2 升级(¥5000+/月)
10. 加 Poe(包月)/ OpenAI 直连(高质量)/ Ollama(隐私关键场景)
11. binding 系统:不同 Episode 用不同 Provider(成本/质量平衡)
12. 加预算告警 + 多 token 故障转移

---

## § 7. 参考资料(其他技术人员的设计)

- **new-api / one-api**(github.com/Calcium-Ion/new-api):channel 概念 + 多 Provider 聚合 + 用量统计 + 限速 + 充值 + 兑换码
  - 我们简化:不做"渠道权重路由"(Phase 1 用户手动选),不做支付/兑换码(项目内不涉及计费)
- **LiteLLM**(github.com/BerriAI/litellm):统一 OpenAI 接口,任意 Provider 转译
  - 我们替代方案:OpenAICompatProvider + 各 Provider 各写 Adapter(更轻量,代码可控)
- **Vercel AI SDK**(`@ai-sdk/anthropic` / `@ai-sdk/openai`):Provider 模块化,streaming/tool calling 统一
  - 借鉴:Provider 接口分 chat/image/video 三组,各自独立接口
- **Continue.dev**(VS Code 插件):config.json 配多 Provider,启动时 dropdown 切换
  - 我们借鉴:SystemSetting `binding.*.modelId` 切换 + admin/providers UI 集中管理
