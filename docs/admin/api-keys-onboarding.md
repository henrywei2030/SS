# Admin API Key 录入实操指引

> 给 admin 真用的 step-by-step
> 已实测验证(2026-05-24 第 22 轮 audit + W8 W3 script.analyze 真接通)

---

## 一、最快入场(¥10 验证全链路)— moyu 中转

**适合**:第一次接入,1 个 token 覆盖 8 个 Provider(claude/seedance/seedream),省事

### Step 1:申请 moyu token(5 min)
1. 注册 https://www.moyu.info/
2. 进 `/token` 页 → "创建令牌"
3. 设置:
   - **额度上限**:¥10(防错刷;真用 W3 一集 < ¥0.1)
   - 模型范围:全选(让一个 token 覆盖文本/视频/图像)
   - 有效期:1 个月
4. 复制 `sk-xxxxxxx` token(只显示一次)

### Step 2:启用预置 moyu Provider(后台 UI)
1. 登录 `/zh-CN/admin/providers`
2. 找 `moyu-claude-sonnet-4-5`(已 seed,默认 isActive=false)
3. 操作:
   - 点 **[设置 API Key]** → 粘贴 sk-xxx → 保存(后端 AES-256-GCM 加密入库)
   - 切换 **isActive → true**
   - 点 **[测试连接]** → 看 `OK · response="pong" · tokens=15+5`(~3s)
4. 同样开启 `moyu-doubao-seedance-1-0-pro`(视频)+ `moyu-doubao-seedream-4-0`(图像)
   - 这 3 个 Provider 共享同 1 个 moyu token,只在 1 个 Provider 录入,其他启用即可

### Step 3:真触发业务流程
1. 创建一个项目 → /director/storyboard
2. 上传一段短剧本(`.docx` / `.txt`)
3. 点"分析剧本" → 看 8 维评分出来(~15s)
4. **运维 grep**:`docker logs ss-postgres-... | grep "req="` 或前端 toast 显示的 `req=xxxxxxxx`

---

## 二、自定义新 Provider(添加 OpenRouter / Poe / 本地 Ollama)

**适合**:已有其他订阅,要接入新的 Provider

### Step A:OpenRouter(中转)
```
admin.provider.create({
  providerId: 'custom-openrouter-claude-3-7',
  displayName: 'Claude 3.7 via OpenRouter',
  kind: 'TEXT',
  apiUrl: 'https://openrouter.ai/api/v1',
  unitPriceCny: 0.025,
  unitName: 'ktoken',
  defaultParams: {
    protocol: 'openai-compat',
    defaultModel: 'anthropic/claude-3.7-sonnet',
    source: 'relay',
  },
})
```

### Step B:Poe(订阅)
```
admin.provider.create({
  providerId: 'poe-claude-3-7',
  displayName: 'Claude 3.7 via Poe (订阅)',
  kind: 'TEXT',
  apiUrl: 'https://api.poe.com/v1',
  unitPriceCny: 0,  // 订阅制无单价
  unitName: 'ktoken',
  defaultParams: {
    protocol: 'openai-compat',
    defaultModel: 'claude-3-7-sonnet',
    source: 'subscription',
  },
})
```

### Step C:本地 Ollama(零成本)
1. 装 Ollama:https://ollama.com/download
2. 拉模型:`ollama pull qwen2.5:32b`
3. 启动 Ollama server(默认 :11434)
4. 录入:
```
admin.provider.create({
  providerId: 'local-qwen-32b',
  displayName: 'Qwen 32B 本地',
  kind: 'TEXT',
  apiUrl: 'http://localhost:11434/v1',
  unitPriceCny: 0,
  unitName: 'ktoken',
  maxConcurrent: 2,  // 本地 GPU 限制
  rateLimitRpm: 999,
  defaultParams: {
    protocol: 'openai-compat',
    defaultModel: 'qwen2.5:32b',
    source: 'local',
  },
})
// apiKey 填占位字符串 'ollama' 或任意 8 字符(Ollama 不校验)
```

### Step D:Anthropic 直连(最稳)
```
admin.provider.create({
  providerId: 'claude-opus-4-7-direct',
  displayName: 'Claude Opus 4.7 直连',
  kind: 'TEXT',
  apiUrl: 'https://api.anthropic.com/v1',
  unitPriceCny: 0.108,
  unitName: 'ktoken',
  defaultParams: {
    protocol: 'anthropic-native', // 用 ClaudeTextProvider 原生
    defaultModel: 'claude-opus-4-7',
    source: 'direct',
  },
})
```

---

## 三、安全机制速查

### ✅ 已自动启用(无需配置)
- 🔐 **AES-256-GCM 加密**:API key 永远以密文存 DB
- 🎭 **遮罩显示**:list / get 返回 `apiKeyMasked: '••••xxxx'`,绝不暴露明文
- 🛡️ **adminProcedure 守门**:仅 admin user 可查/改/测/创/删
- 🚦 **rateLimit**:`testConnection` 5 次/分(防误点刷 token)
- 🧹 **错误脱敏**:`sanitizeErrorMsg` 去 URL/token/hash
- 📝 **全审计**:setApiKey / clearApiKey / setActive / updatePricing / testConnection / create / delete 全入 OperationLog
- 💰 **dryRun 默认 true**:image/video testConnection 不真生成,防刷钱
- ⏸ **isActive 默认 false**:新建 Provider 默认关,setApiKey 后才能用

### 🔒 需要 admin 注意的红线
- ❌ 别把 API key 写 `.env.local`(走 admin/providers UI 加密存)
- ❌ 别给非 admin 用户 admin 权限(setStatus 在 /admin/users)
- ❌ 别截图含 API key 的 UI(后端遮罩了,但用户输入时若粘贴中暴露)
- ❌ APP_MASTER_KEY 一旦定 prod **绝不**改(改后已加密 key 全废)

### 推荐定期(每 90 天)
- 🔄 rotate token:moyu 后台撤旧 → 新 → `/admin/providers` 重新 setApiKey
- 📊 看 `/admin/api-usage` 实际消费,跟 moyu 后台余额对账
- 📋 看 `/admin/audit` 过滤 `action contains 'provider'` 看谁改了什么时候

---

## 四、故障排查

### Q1:testConnection 报 "model_not_found"
- moyu/Poe 后台:**该模型不在当前 token 的可访问范围**
- 解决:moyu /token 页编辑令牌,加该模型;或换 `defaultModel` 用 token 已开通的

### Q2:testConnection 报 "无可用渠道"
- moyu 后台:**当前 group 没接通该模型的 channel**
- 解决:moyu /channel 页加该模型的 channel,或换其他模型(/v1/models 列已开通的)

### Q3:setApiKey 报 "API key too short"
- adapters/setProviderApiKey 校验 < 8 字符拒
- 解决:粘贴完整 token(应 50+ 字符 sk- 开头)

### Q4:script.analyze 卡 loading 很久
- 长剧本(>5000 字)分析 ~30s 正常
- 解决:超 60s 看 worker 日志 `grep "[req=xxx]"`,可能 LLM 限速

### Q5:视频抽卡失败 "task timeout"
- BullMQ worker pollTimeoutMs=5min,超时未完成自动 fail
- 解决:看 worker 日志,可能 moyu 后端 vendor 拥堵;重抽即可(BullMQ 自动 retry 5 次)

### Q6:admin 后台 setActive 后 业务还 Mock 兜底
- Provider 实例缓存,setApiKey 时已自动 invalidate(`cache.text.delete(providerId)`)
- 罕见:web app 还跑旧实例 → 重启 `pnpm --filter @ss/web dev`

---

## 五、参考资料

- 4 类入口设计:[provider-onboarding-design.md](provider-onboarding-design.md)
- moyu API spec:[moyu-api.md](../integrations/moyu-api.md)
- 模块边界:[../MODULES.md](../MODULES.md)
- ADR-27 决议:[../05-tech-decisions.md](../05-tech-decisions.md) § ADR-27
- 安全测试矩阵:provider-onboarding-design.md § 5
