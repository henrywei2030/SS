# moyu.info(魔芋 AI)中转站 API 接入文档

> 归档日期:2026-05-24
> 来源:实测 + 推断(基于 new-api 项目协议)
> ⚠️ **不含任何 API key / 凭据** — 仅技术规范

---

## § 1. 平台性质

- **moyu.info = new-api 实例**(songquanpeng/one-api 衍生)
- **OpenAI 兼容**接口聚合:统一 endpoint,代理转发到底层 Provider(Anthropic / Volcengine / OpenAI / DeepSeek / Google / etc)
- 一个 token 可访问后台开通的所有模型
- 计费按 token 使用量(各模型不同单价)

---

## § 2. 认证方式

```http
Authorization: Bearer sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

- **API token** 在 moyu 后台 `/token` 页创建
- token 有额度上限 + 可设模型白名单 + 可独立 revoke
- **不要用 username/password 调 API**(那是 web session,仅 UI 用)
- token 格式:`sk-` 开头 + 48 字符随机

---

## § 3. 已 verify 的 Endpoint(实测通过)

### 3.1 列模型 — `GET /v1/models`
```http
GET https://www.moyu.info/v1/models
Authorization: Bearer sk-xxx
```
**响应**:
```json
{
  "data": [
    {
      "id": "claude-sonnet-4-5-20250929",
      "object": "model",
      "created": 1626777600,
      "owned_by": "vertex-ai",
      "supported_endpoint_types": ["anthropic", "openai"]
    },
    {
      "id": "doubao-seedance-2-0-260128",
      "owned_by": "custom",
      "supported_endpoint_types": ["video"]
    },
    {
      "id": "doubao-seedream-4-0-250828",
      "owned_by": "volcengine",
      "supported_endpoint_types": ["image-generation", "openai"]
    }
  ]
}
```

**`supported_endpoint_types` 决定走哪个 endpoint**:
| 类型 | endpoint | 用途 |
|---|---|---|
| `openai` | `/v1/chat/completions` | 文本对话 |
| `anthropic` | `/v1/messages` | Anthropic 原生协议(可选) |
| `gemini` | `/v1/models/<id>:generateContent` | Gemini 原生协议(可选) |
| `image-generation` | `/v1/images/generations` | 图像生成 |
| `video` | `/v1/video/generations` | 视频生成(异步) |

---

### 3.2 文本对话 — `POST /v1/chat/completions`(OpenAI 标准)

**请求**:
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "max_tokens": 4096,
  "temperature": 0.7,
  "stream": false,
  "response_format": { "type": "json_object" }
}
```

**响应**:
```json
{
  "id": "msg_01V1AnemzDegX6ScaTSUQHyT",
  "model": "claude-sonnet-4-5-20250929",
  "object": "chat.completion",
  "created": 1779611614,
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "pong" },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 27,
    "completion_tokens": 5,
    "total_tokens": 32,
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "text_tokens": 0,
      "audio_tokens": 0,
      "image_tokens": 0
    },
    "completion_tokens_details": {
      "text_tokens": 0,
      "audio_tokens": 0,
      "reasoning_tokens": 0
    }
  }
}
```

**已 verify**:claude-sonnet-4-5 真返回 "pong",`finish_reason: "stop"`,消耗 32 tokens。

---

### 3.3 图像生成 — `POST /v1/images/generations`(OpenAI 兼容,同步)

**请求**:
```json
{
  "model": "doubao-seedream-4-0-250828",
  "prompt": "test",
  "n": 1,
  "size": "1024x1024"
}
```

**响应**(同步返回 URL):
```json
{
  "created": 1779611626,
  "data": [{
    "url": "https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/.../xxx.jpeg?X-Tos-...",
    "size": "1024x1024"
  }],
  "model": "doubao-seedream-4-0-250828",
  "usage": {
    "prompt_tokens": 1,
    "completion_tokens": 4096,
    "total_tokens": 4096
  }
}
```

**已 verify**:doubao-seedream-4-0 真生成图,TOS 临时签名 URL(24h 过期)。

---

### 3.4 视频生成 — `POST /v1/video/generations`(异步)

**请求**:
```json
{
  "model": "doubao-seedance-1-0-pro-250528",
  "prompt": "...",
  "duration": 5,
  "ratio": "16:9"
}
```

**响应**(立即返 task_id):
```json
{ "task_id": "cgt-20260524163336-5fslw" }
```

**轮询**(推断 — 标准 Seedance ARK 协议):
```http
GET /v1/video/generations/{task_id}
Authorization: Bearer sk-xxx
```

**预期响应**(基于 Seedance 原生协议,需真跑验证):
```json
{
  "id": "cgt-...",
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled",
  "content": {
    "video_url": "https://...mp4",
    "cover_url": "https://...jpeg",
    "duration": 5,
    "width": 1920,
    "height": 1080,
    "fps": 24
  },
  "error": { "code": "...", "message": "..." }
}
```

**已 verify**:task 创建返回 task_id 格式 `cgt-YYYYMMDDHHMMSS-xxxxx`。

---

## § 4. 模型清单(实测拿到的 default group 模型)

### 文本 LLM(剧本分析用)
| 模型 | 类型 | 协议 | 备注 |
|---|---|---|---|
| `claude-haiku-4-5-20251001` | Anthropic | both | 快 + 便宜 |
| `claude-sonnet-4-5-20250929` | Anthropic | both | **推荐剧本分析** |
| `claude-sonnet-4-6` | Anthropic | both | 新版 |
| `claude-opus-4-5-20251101` | Anthropic | both | 最强(贵) |
| `claude-opus-4-6` / `4-7` | Anthropic | both | 自定义最新 |
| `gpt-4.1-mini` / `gpt-4.1-nano` | OpenAI | openai | OpenAI |
| `GPT-4o` | OpenAI | openai | OpenAI 多模态 |
| `gemini-2.5-pro` / `gemini-3-pro-preview` | Google | gemini+openai | Gemini |
| `deepseek-chat` / `deepseek-v4-pro` | DeepSeek | openai | 国产便宜 |
| `DeepSeek-R1` | DeepSeek | openai | 推理强 |
| `GLM-5` / `glm-5.1` | 智谱 | openai | 国产 |
| `doubao-1-5-pro-32k-250115` / `doubao-seed-2-0-pro-260215` | 字节豆包 | openai | 国产便宜 |

### 视频(W5 抽卡用)
| 模型 | 备注 |
|---|---|
| `doubao-seedance-1-0-lite-i2v-250428` | 图生视频(便宜) |
| `doubao-seedance-1-0-pro-250528` | **推荐 Phase 1.5 入场** |
| `doubao-seedance-1-0-pro-fast-251015` | 速度优先 |
| `doubao-seedance-1-5-pro-251215` | 1.5 新版 |
| `doubao-seedance-2-0-260128` | **2.0 最新** |
| `doubao-seedance-2-0-fast-260128` | 2.0 快速版 |

### 图像(W4 资产生成用)
| 模型 | 备注 |
|---|---|
| `doubao-seedream-3-0-t2i-250415` | 3.0 文生图 |
| `doubao-seedream-4-0-250828` | **推荐** 4.0 |
| `doubao-seedream-4-5-251128` | 4.5 |
| `doubao-seedream-5-0-260128` | 5.0 最新 |
| `FLUX.2-dev` | Black Forest FLUX |

### Embeddings(Phase 2 pgvector 用)
- `doubao-embedding-vision-250615`
- `gemini-embedding-001` / `gemini-embedding-2-preview`

---

## § 5. 错误响应格式

```json
{
  "error": {
    "code": "model_not_found",
    "message": "分组 default 下模型 gpt-3.5-turbo 无可用渠道（distributor） (request id: 20260524163226306479804tbYFN0mX)",
    "type": "moyu_api_error"
  }
}
```

**特点**:
- `error.code` 用于程序判断(model_not_found / insufficient_quota / rate_limit_exceeded 等)
- `error.message` 含 request_id,运维 grep 用
- HTTP status code:**429**(rate limit)/ **402**(余额不足)/ **404**(模型/endpoint 不存在)/ **500**(后端错)

---

## § 6. 接入到 starsalign-studio 的策略

### 6.1 新增 Provider 类
**`packages/adapters/provider/openai-compat.ts`** — `OpenAICompatTextProvider`
- 实现 `ITextProvider`
- 兼容 moyu / Poe / OpenRouter / OpenAI / 任意 OpenAI Chat Completions 兼容站
- 复用 ClaudeTextProvider 的 JSON 解析逻辑

**`packages/adapters/provider/openai-compat-image.ts`** — `OpenAICompatImageProvider`
- 实现 `IImageProvider`
- 用于 doubao-seedream / FLUX / DALL-E / 任意 /v1/images/generations 兼容

**视频复用 `SeedanceProvider`**:
- moyu 视频用 `POST /v1/video/generations` + `task_id` 轮询
- 跟 Seedance ARK 原生协议**几乎一致**(只是 endpoint 改 /v1/video/generations 不是 /contents/generations/tasks)
- 改一个 `endpointPath` 配置项让 Seedance 支持两种 base path

### 6.2 ProviderConfig 灌新行(seed.ts)
- `moyu-claude-sonnet-4-5` → text,apiUrl=`https://www.moyu.info/v1`
- `moyu-doubao-seedance-1-0-pro` → video
- `moyu-doubao-seedream-4-0` → image

### 6.3 admin/providers UI 配 API key
- 把 moyu token sk-... 录入 (apiKeyEnc 加密存)
- 同一个 token 可用于多个 providerId(共享配额)

---

## § 7. 接入安全注意

1. **API token = 钱**:moyu token 一旦泄漏可被刷干余额
2. **加密存**:必走 APP_MASTER_KEY 加密(已有 crypto.ts)
3. **遮罩显示**:UI 只显示后 4 位(已有 maskSecret helper)
4. **审计**:setApiKey / clearApiKey 必入 OperationLog(action 三段式)
5. **rate limit**:moyu 后台限流,Provider 应捕获 429 + 指数退避
6. **monitor**:moyu 后台余额 / 流量 监控,我们 admin/health 应该展示(Phase 1.5)
7. **隔离**:不同环境(dev/test/prod)用不同 token,**绝不**共享

---

## § 8. 待实测项(Phase 1.5 真接时验)

- [ ] `GET /v1/video/generations/{task_id}` 真响应格式
- [ ] `stream: true` SSE 流式输出(claude-sonnet 支持)
- [ ] `response_format: { type: "json_object" }` 真返 JSON
- [ ] image `n: 4` 一次 4 张是否支持(批量抽卡)
- [ ] video `first_frame_url` / `last_frame_url` 首尾帧约束(ADR-23 用)
- [ ] image `image` 字段 img2img(用户传参考图)
- [ ] 429 rate limit 重试策略
- [ ] 余额耗尽 402 错误处理

---

## § 9. 下一步实施清单

1. ✅ 归档 API spec(本文档)
2. ⏳ 写 `OpenAICompatTextProvider` + `OpenAICompatImageProvider`
3. ⏳ 改 `SeedanceProvider` 支持 moyu video endpoint path
4. ⏳ seed.ts 加 3-5 个 moyu Provider 配置(claude-sonnet / seedance-1-0-pro / seedream-4-0)
5. ⏳ admin/providers UI:遮罩 / 测试连接 / setApiKey 审计 / rate limit
6. ⏳ 写 admin 文档 "如何在 moyu 申请 token + 录入"
