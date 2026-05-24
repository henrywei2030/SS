# moyu.info 开发文档 完整归档(实测 2026-05-24)

来源:https://www.moyu.info/docs(登录后 iframe = /developer-docs/index.html)
共 24 章



## 1. 🔧 模型列表

🔧 获取可用模型

本文档介绍如何通过 API 获取可用的模型列表。

📡 API 端点
GET https://www.moyu.info/v1/models

Copy
🚀 快速开始
cURL 请求
curl -X GET "https://www.moyu.info/v1/models" \
  -H "Authorization: Bearer YOUR_API_KEY"

Copy
响应示例
{
  "data": [
    {
      "id": "gpt-4o-2024-11-20",
      "object": "model",
      "created": 1626777600,
      "owned_by": "openai",
      "supported_endpoint_types": ["openai"]
    },
    {
      "id": "claude-sonnet-4-5-20250929",
      "object": "model",
      "created": 1626777600,
      "owned_by": "vertex-ai",
      "supported_endpoint_types": ["anthropic", "openai"]
    },
    {
      "id": "gemini-2.5-flash",
      "object": "model",
      "created": 1626777600,
      "owned_by": "custom",
      "supported_endpoint_types": ["gemini", "openai"]
    }
  ],
  "object": "list",
  "success": true
}

Copy
📝 请求说明
请求方法

GET

请求头
参数名	类型	必填	说明
Authorization	string	是	Bearer token 格式: Bearer YOUR_API_KEY
请求示例
cURL
curl -X GET "https://www.moyu.info/v1/models" \
  -H "Authorization: Bearer YOUR_API_KEY"

Copy
其他语言
python
javascript
go
import requests

api_url = "https://www.moyu.info/v1/models"
api_key = "YOUR_API_KEY"

response = requests.get(
    api_url,
    headers={"Authorization": f"Bearer {api_key}"}
)

print(response.json())

Copy
📦 响应说明
响应字段
字段名	类型	说明
data	array	模型列表数组
object	string	固定值 "list"
success	boolean	请求是否成功
模型对象字段
字段名	类型	说明
id	string	模型的唯一标识符
object	string	固定值 "model"
created	integer	创建时间戳
owned_by	string	模型提供方
supported_endpoint_types	array	支持的端点类型
supported_endpoint_types 说明
openai: 兼容 OpenAI 格式的端点
anthropic: 兼容 Anthropic 格式的端点
gemini: 兼容 Google Gemini 格式的端点
---


## 2. 🤖 OpenAI

🤖 OpenAI 文本接口

OpenAI 对话补全接口文档。

接口地址
POST https://www.moyu.info/v1/chat/completions

Copy
请求示例
cURL
curl -X POST "https://www.moyu.info/v1/chat/completions" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "messages": [
      {
        "role": "user",
        "content": "你好"
      }
    ]
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/chat/completions",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "MODEL_NAME",
        "messages": [{"role": "user", "content": "你好"}]
    }
)
print(response.json())

Copy
响应格式
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "MODEL_NAME",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "你好！有什么我可以帮助你的吗？"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 9,
    "completion_tokens": 12,
    "total_tokens": 21
  }
}

Copy
请求参数
基础参数
参数	类型	必填	说明
model	string	是	模型名称，如 gpt-4o, gpt-4o-mini, chatgpt-4o-latest 等
messages	array	是	对话消息列表，每条消息包含 role 和 content
messages 格式
[
  {"role": "system", "content": "你是一个助手"},
  {"role": "user", "content": "你好"}
]

Copy

支持的 role 值：

system: 系统消息，用于设定助手的行为
user: 用户消息
assistant: 助手的回复
采样参数
参数	类型	必填	默认值	说明
temperature	number	否	1	采样温度，范围 0-2。较高的值（如 1.5）使输出更随机，较低的值（如 0.2）使输出更确定
top_p	number	否	1	核采样参数，范围 0-1。建议只调整 temperature 或 top_p，不要同时调整
n	integer	否	1	为每个输入生成的补全数量
stream	boolean	否	false	是否流式输出。true 时，服务器将发送 SSE 事件流
控制参数
参数	类型	必填	默认值	说明
max_tokens	integer	否	模型最大值	生成的最大 token 数量
max_completion_tokens	integer	否	-	补全部分的最大 token 数量
stop	string/array	否	null	停止序列。最多 4 个序列，遇到时 API 将停止生成
presence_penalty	number	否	0	存在惩罚，范围 -2.0 到 2.0。正值会根据新 token 是否出现在文本中来惩罚它们
frequency_penalty	number	否	0	频率惩罚，范围 -2.0 到 2.0。正值会根据新 token 在文本中的现有频率来惩罚它们
高级参数
参数	类型	必填	默认值	说明
stream_options	object	否	-	流式输出的额外选项，如 include_usage: true
logprobs	boolean	否	false	是否返回输出 token 的对数概率
top_logprobs	integer	否	-	每个 token 位置返回的最可能 token 数量，范围 0-20
user	string	否	-	终端用户的唯一标识符，用于监控和检测滥用
响应字段说明
字段	类型	说明
id	string	本次对话的唯一标识符
object	string	对象类型，固定为 chat.completion
created	integer	创建时间戳
model	string	使用的模型名称
choices	array	生成的补全结果列表
choices[].message.content	string	助手的回复内容
choices[].finish_reason	string	结束原因：stop(自然结束)、length(达到长度限制)、content_filter(内容过滤)
usage	object	token 使用情况统计
usage.prompt_tokens	integer	输入消息使用的 token 数
usage.completion_tokens	integer	生成内容使用的 token 数
usage.total_tokens	integer	总 token 数
Responses 接口

OpenAI Responses API 接口文档。

接口地址
POST https://www.moyu.info/v1/responses

Copy
请求示例
cURL
curl -X POST "https://www.moyu.info/v1/responses" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "input": "你好"
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/responses",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "MODEL_NAME",
        "input": "你好"
    }
)
print(response.json())

Copy
响应格式
{
  "id": "resp_xxx",
  "object": "response",
  "created_at": 0,
  "model": "MODEL_NAME",
  "status": "completed",
  "output": [
    {
      "id": "msg_xxx",
      "type": "message",
      "role": "assistant",
      "status": "completed",
      "content": [
        {
          "type": "output_text",
          "text": "你好！我是 AI 助手，可以帮你回答问题、写作、翻译、总结、编程、做计划等。"
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 14,
    "output_tokens": 86,
    "total_tokens": 100,
    "input_tokens_details": {
      "cached_tokens": 0
    },
    "output_tokens_details": {
      "reasoning_tokens": 0
    }
  }
}

Copy
请求参数
基础参数
参数	类型	必填	说明
model	string	是	模型名称，如 gpt-4o, gpt-5.4 等
input	string/array	是	输入内容，可以是字符串或消息数组
input 格式

支持两种格式：

字符串格式（简单用法）：

{
  "model": "MODEL_NAME",
  "input": "你好"
}

Copy

消息数组格式（多轮对话）：

{
  "model": "MODEL_NAME",
  "input": [
    {"role": "user", "content": "你好"},
    {"role": "assistant", "content": "你好！有什么可以帮你的？"},
    {"role": "user", "content": "介绍一下你自己"}
  ]
}

Copy
采样参数
参数	类型	必填	默认值	说明
temperature	number	否	1	采样温度，范围 0-2
top_p	number	否	1	核采样参数，范围 0-1
max_output_tokens	integer	否	模型最大值	生成的最大 token 数量
控制参数
参数	类型	必填	默认值	说明
instructions	string	否	-	系统指令，用于设定助手的行为（等同于 system message）
stream	boolean	否	false	是否流式输出
previous_response_id	string	否	-	上一次响应的 ID，用于多轮对话上下文衔接
truncation	string	否	disabled	截断策略
高级参数
参数	类型	必填	默认值	说明
tools	array	否	[]	可用工具列表（函数调用等）
tool_choice	object	否	-	工具选择策略
reasoning	object	否	-	推理配置，如 {"effort": "medium"}
metadata	object	否	{}	自定义元数据
user	string	否	-	终端用户的唯一标识符
响应字段说明
字段	类型	说明
id	string	本次响应的唯一标识符，格式为 resp_xxx
object	string	对象类型，固定为 response
created_at	integer	创建时间戳
model	string	使用的模型名称
status	string	响应状态：completed(完成)、failed(失败)、in_progress(进行中)
output	array	输出内容列表
output[].type	string	输出项类型，如 message
output[].role	string	角色，固定为 assistant
output[].content	array	内容列表
output[].content[].type	string	内容类型，如 output_text
output[].content[].text	string	助手的回复文本
usage	object	token 使用情况统计
usage.input_tokens	integer	输入使用的 token 数
usage.output_tokens	integer	输出使用的 token 数
usage.total_tokens	integer	总 token 数
---


## 3. ✨ Gemini

✨ Gemini 文本接口

Gemini 内容生成接口文档。

接口地址
POST https://www.moyu.info/v1beta/models/{model}:generateContent

Copy
请求示例
cURL
curl -X POST "https://www.moyu.info/v1beta/models/MODEL_NAME:generateContent" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [
          {
            "text": "Hello"
          }
        ]
      }
    ]
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1beta/models/MODEL_NAME:generateContent",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "contents": [
            {
                "role": "user",
                "parts": [{"text": "Hello"}]
            }
        ]
    }
)
print(response.json())

Copy
响应格式
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "text": "Hi there! How can I help you today? 😊\n"
          }
        ],
        "role": "model"
      },
      "finishReason": "STOP",
      "avgLogprobs": -0.10243042310078938
    }
  ],
  "usageMetadata": {
    "promptTokenCount": 6,
    "candidatesTokenCount": 12,
    "totalTokenCount": 18
  }
}

Copy
请求参数
路径参数
参数	类型	必填	说明
model	string	是	模型名称，如 gemini-2.0-flash, gemini-2.5-flash, gemini-3-pro-preview 等
基础参数
参数	类型	必填	说明
contents	array	是	对话内容列表，包含用户和模型的消息
contents 格式
[
  {
    "role": "user",
    "parts": [
      {
        "text": "Hello"
      }
    ]
  }
]

Copy

支持的 role 值：

user: 用户消息
model: 模型的回复
系统指令参数
参数	类型	必填	说明
systemInstruction	object	否	系统指令，用于设定模型的行为和角色
systemInstruction 格式
{
  "parts": [
    {
      "text": "You are a helpful assistant"
    }
  ]
}

Copy
生成配置参数
参数	类型	必填	默认值	说明
generationConfig	object	否	-	生成配置对象
generationConfig.temperature	number	否	1.0	采样温度，范围 0-2。较高的值使输出更随机，较低的值使输出更确定
generationConfig.topP	number	否	0.95	核采样参数，范围 0-1
generationConfig.topK	integer	否	40	Top-K 采样参数
generationConfig.maxOutputTokens	integer	否	8192	生成的最大 token 数量
generationConfig.candidateCount	integer	否	1	生成的候选响应数量
generationConfig.stopSequences	array	否	-	停止序列列表，遇到时停止生成
安全设置参数
参数	类型	必填	说明
safetySettings	array	否	安全过滤设置数组
safetySettings 格式
[
  {
    "category": "HARM_CATEGORY_HARASSMENT",
    "threshold": "BLOCK_MEDIUM_AND_ABOVE"
  }
]

Copy

支持的 category 值：

HARM_CATEGORY_HARASSMENT: 骚扰内容
HARM_CATEGORY_HATE_SPEECH: 仇恨言论
HARM_CATEGORY_SEXUALLY_EXPLICIT: 色情内容
HARM_CATEGORY_DANGEROUS_CONTENT: 危险内容

支持的 threshold 值：

BLOCK_NONE: 不阻止
BLOCK_ONLY_HIGH: 仅阻止高风险
BLOCK_MEDIUM_AND_ABOVE: 阻止中等及以上风险
BLOCK_LOW_AND_ABOVE: 阻止低等及以上风险
工具参数
参数	类型	必填	说明
tools	array	否	工具列表，用于函数调用等高级功能
文件上传参数（inline_data）

通过 inline_data 可以将文件以 base64 编码的方式内联传递，让模型分析图片、视频等多模态内容。

参数	类型	必填	说明
inline_data.mime_type	string	是	文件 MIME 类型，如 video/mp4、image/jpeg、image/png 等
inline_data.data	string	是	文件的 base64 编码字符串（不换行）
支持的视频格式
格式	MIME 类型
MP4	video/mp4
AVI	video/avi
MOV	video/quicktime
WebM	video/webm
MKV	video/x-matroska
FLV	video/x-flv
文件上传请求示例

第一步：将文件转为 base64 并构造请求体

# 将视频文件转为 base64（-w 0 表示不换行，输出为一整行）
VIDEO_B64=$(base64 -w 0 /path/to/your/video.mp4)

# 用 base64 数据构造 JSON 请求体，保存到临时文件
cat > /tmp/gemini_video_req.json << JSONEOF
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "inline_data": {
            "mime_type": "video/mp4",
            "data": "$VIDEO_B64"
          }
        },
        {
          "text": "请详细分析这个视频的内容，描述你看到的画面、角色、场景和整体风格。"
        }
      ]
    }
  ]
}
JSONEOF

Copy

第二步：发送请求

curl -X POST "https://www.moyu.info/v1beta/models/MODEL_NAME:generateContent" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d @/tmp/gemini_video_req.json

Copy

响应示例

{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "text": "这段视频展现了一个充满田园诗意和治愈感的动画场景..."
          }
        ],
        "role": "model"
      },
      "finishReason": "STOP"
    }
  ],
  "usageMetadata": {
    "promptTokenCount": 911,
    "candidatesTokenCount": 634,
    "totalTokenCount": 2682,
    "promptTokensDetails": [
      { "modality": "VIDEO", "tokenCount": 640 },
      { "modality": "AUDIO", "tokenCount": 252 },
      { "modality": "TEXT", "tokenCount": 19 }
    ]
  }
}

Copy
注意事项
文件大小：base64 编码后体积约为原文件的 1.33 倍，例如 12.6MB 的视频编码后 JSON 约 17MB
超时设置：视频文件较大时，请求耗时较长，建议 curl 加上 --max-time 300 参数
Token 消耗：视频会被拆分为视频帧和音频两部分计算 token，一段短视频通常消耗数百到数千 token
模型选择：需要使用支持多模态的 Gemini 模型（如 gemini-3-pro-preview）
响应字段说明
字段	类型	说明
candidates	array	生成的候选响应列表
candidates[].content.parts	array	响应内容部分
candidates[].content.parts[].text	string	生成的文本内容
candidates[].content.role	string	角色，固定为 model
candidates[].finishReason	string	结束原因：STOP(自然结束)、MAX_TOKENS(达到长度限制)、SAFETY(安全过滤)
candidates[].avgLogprobs	number	平均对数概率
candidates[].safetyRatings	array	安全评级列表
usageMetadata	object	token 使用情况统计
usageMetadata.promptTokenCount	integer	输入 token 数
usageMetadata.candidatesTokenCount	integer	生成 token 数
usageMetadata.totalTokenCount	integer	总 token 数
createTime	string	创建时间
modelVersion	string	模型版本
---


## 4. 🧠 Anthropic

🧠 Anthropic 文本接口

Anthropic (Claude) 消息接口文档。

接口地址
POST https://www.moyu.info/v1/messages

Copy
请求示例
cURL
curl -X POST "https://www.moyu.info/v1/messages" \
  -H "anthropic-version: 2023-06-01" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "messages": [
      {
        "role": "user",
        "content": "Hello"
      }
    ],
    "max_tokens": 100
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/messages",
    headers={
        "anthropic-version": "2023-06-01",
        "Authorization": "Bearer YOUR_API_KEY"
    },
    json={
        "model": "MODEL_NAME",
        "messages": [{"role": "user", "content": "Hello"}],
        "max_tokens": 100
    }
)
print(response.json())

Copy
响应格式
{
  "id": "msg_01BmUFLDDHz14v9zoEACmRR1",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello! How can I help you today?"
    }
  ],
  "model": "claude-sonnet-4-5-20250929",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 13,
    "output_tokens": 15
  }
}

Copy
请求参数
必需 Header
Header	值	说明
anthropic-version	2023-06-01	API 版本号，必需
Authorization	Bearer YOUR_API_KEY	认证令牌
基础参数
参数	类型	必填	说明
model	string	是	模型名称，如 claude-sonnet-4-5-20250929, claude-opus-4-5-20251101 等
messages	array	是	对话消息列表
max_tokens	integer	是	生成的最大 token 数量
messages 格式
[
  {
    "role": "user",
    "content": "Hello"
  }
]

Copy

支持的 role 值：

user: 用户消息
assistant: 助手的回复（用于多轮对话）
系统提示参数
参数	类型	必填	说明
system	string	否	系统提示，用于设定 Claude 的行为和角色
采样参数
参数	类型	必填	默认值	说明
temperature	number	否	1.0	采样温度，范围 0-1。较高的值使输出更随机，较低的值使输出更确定
top_p	number	否	-	核采样参数，范围 0-1。注意：不能与 temperature 同时使用
top_k	integer	否	-	Top-K 采样参数，仅从前 k 个最可能的 token 中采样

重要提示：temperature 和 top_p 参数不能同时指定，只能使用其中一个。

控制参数
参数	类型	必填	默认值	说明
stop_sequences	array	否	-	停止序列列表，最多 4 个。遇到时 API 将停止生成
stream	boolean	否	false	是否流式输出。true 时使用 Server-Sent Events (SSE)
高级参数
参数	类型	必填	说明
metadata	object	否	元数据对象，可包含 user_id 等信息用于追踪
tools	array	否	工具列表，用于函数调用等高级功能
tool_choice	object	否	工具选择策略
thinking	object	否	思考配置（扩展思维模式）
响应字段说明
字段	类型	说明
id	string	消息的唯一标识符
type	string	对象类型，固定为 message
role	string	角色，固定为 assistant
content	array	内容块数组
content[].type	string	内容类型，如 text
content[].text	string	生成的文本内容
model	string	使用的模型名称
stop_reason	string	停止原因：end_turn(自然结束)、max_tokens(达到长度限制)、stop_sequence(遇到停止序列)
stop_sequence	string	触发停止的序列（仅当 stop_reason 为 stop_sequence 时存在）
usage	object	token 使用情况统计
usage.input_tokens	integer	输入 token 数
usage.output_tokens	integer	输出 token 数
---


## 5. 🤖 OpenAI

🤖 OpenAI 图片接口

OpenAI 图片生成接口文档。

接口地址
POST https://www.moyu.info/v1/images/generations

Copy
请求示例
cURL
curl -X POST "https://www.moyu.info/v1/images/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "prompt": "A beautiful sunset over the ocean"
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/images/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "MODEL_NAME",
        "prompt": "A beautiful sunset over the ocean"
    }
)
print(response.json())

Copy
响应格式
{
  "created": 1770199980,
  "data": [
    {
      "url": "https://rgw.wanjiedata.com/maas-public-bucket/2026/02/04/6c14833ef7493cddc1bb52ce038a02c8.jpg"
    }
  ],
  "usage": {
    "input_tokens_details": {}
  }
}

Copy
请求参数
参数	类型	必填	默认值	说明
model	string	否	-	模型名称。不指定时使用默认模型
prompt	string	是	-	图片描述提示词，详细描述想要生成的图片内容
size	string	否	1024x1024	图片尺寸，如 256x256、512x512、1024x1024、1792x1024、1024x1792
quality	string	否	standard	图片质量：standard(标准) 或 hd(高清)

完整参数列表请参考 OpenAI官方文档

响应字段说明
字段	类型	说明
created	integer	创建时间戳
data	array	生成的图片列表
data[].url	string	图片的URL地址，可直接访问下载
data[].b64_json	string	Base64编码的图片数据（如果请求时指定返回格式）
usage	object	使用情况统计
---


## 6. ✨ Gemini

Gemini 图片生成接口

Gemini 图片生成接口文档。

支持的模型
模型名称	说明
MODEL_NAME	Gemini 2.5 Flash 图片生成（推荐，稳定）
gemini-3-pro-image-preview	Gemini 3 Pro 图片生成（Preview，可能不稳定）
接口地址

Gemini 图片生成支持三种接口格式：

1. OpenAI Images API 格式（推荐）
POST https://www.moyu.info/v1/images/generations

Copy
2. Gemini 原生格式
POST https://www.moyu.info/v1beta/models/{model}:generateContent

Copy
3. OpenAI Chat Completions 格式
POST https://www.moyu.info/v1/chat/completions

Copy
支持的图片比例
size 参数	说明
1:1	正方形（默认）
16:9	横屏宽幅
9:16	竖屏长图
4:3	标准横屏
3:4	标准竖屏
3:2	经典横屏
2:3	经典竖屏
请求示例
OpenAI Images API 格式（推荐）
cURL
curl -X POST "https://www.moyu.info/v1/images/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "prompt": "A beautiful sunset over the ocean",
    "size": "16:9",
    "n": 1
  }'

Copy
PowerShell
curl.exe -X POST "https://www.moyu.info/v1/images/generations" `
  -H "Authorization: Bearer YOUR_API_KEY" `
  -H "Content-Type: application/json" `
  -d '{\"model\":\"MODEL_NAME\",\"prompt\":\"A beautiful sunset over the ocean\",\"size\":\"16:9\",\"n\":1}'

Copy
Gemini 原生格式
cURL
curl -X POST "https://www.moyu.info/v1beta/models/MODEL_NAME:generateContent" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [
          {
            "text": "A beautiful sunset over the ocean"
          }
        ]
      }
    ],
    "generationConfig": {
      "responseModalities": ["IMAGE"],
      "imageConfig": {
        "aspectRatio": "16:9"
      }
    }
  }'

Copy
OpenAI Chat Completions 格式
cURL
curl -X POST "https://www.moyu.info/v1/chat/completions" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "messages": [
      {
        "role": "user",
        "content": "A beautiful sunset over the ocean"
      }
    ]
  }'

Copy

注意：Chat Completions 格式返回的图片以 Markdown 格式嵌入在 content 中：![image](data:image/png;base64,...)

代码示例
OpenAI Images API 格式（推荐）
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/images/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "MODEL_NAME",
        "prompt": "A beautiful sunset over the ocean",
        "size": "16:9",
        "n": 1
    }
)
data = response.json()
# data["data"][0]["b64_json"] 包含 base64 编码的 PNG 图片
print(f"图片数量: {len(data['data'])}")

Copy
Gemini 原生格式
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1beta/models/MODEL_NAME:generateContent",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "contents": [
            {
                "role": "user",
                "parts": [{"text": "A beautiful sunset over the ocean"}]
            }
        ],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {
                "aspectRatio": "16:9"
            }
        }
    }
)
print(response.json())

Copy
OpenAI Chat Completions 格式
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/chat/completions",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "MODEL_NAME",
        "messages": [{"role": "user", "content": "A beautiful sunset over the ocean"}]
    }
)
print(response.json())

Copy
响应格式
OpenAI Images API 格式响应
{
  "created": 1771905100,
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAAANSUhEUgAAA..."
    }
  ]
}

Copy

注意：返回的 b64_json 是 base64 编码的 PNG 图片数据，需要解码后保存为图片文件。

Gemini 原生格式响应
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "inlineData": {
              "mimeType": "image/png",
              "data": "iVBORw0KGgoAAAANSUhEUgAAA..."
            }
          }
        ],
        "role": "model"
      },
      "finishReason": "STOP"
    }
  ],
  "createTime": "2026-02-04T10:46:08.309624Z",
  "model": "MODEL_NAME",
  "modelVersion": "gemini-2.5-flash-image",
  "responseId": "cCODafjyEsWnk8sPmqOg2As",
  "usageMetadata": {
    "candidatesTokenCount": 1290,
    "candidatesTokensDetails": [
      {
        "modality": "IMAGE",
        "tokenCount": 1290
      }
    ],
    "promptTokenCount": 6,
    "promptTokensDetails": [
      {
        "modality": "TEXT",
        "tokenCount": 6
      }
    ],
    "totalTokenCount": 1296,
    "trafficType": "ON_DEMAND"
  }
}

Copy
OpenAI Chat Completions 格式响应
{
  "id": "chatcmpl-20260204185456102020700aYXwYVxd",
  "model": "MODEL_NAME",
  "object": "chat.completion",
  "created": 1770202505,
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "![image](data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...)"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 3,
    "completion_tokens": 1301,
    "total_tokens": 1304
  }
}

Copy

注意：Chat Completions 格式的响应中，图片以 Markdown 格式嵌入在 content 字段中，格式为 ![image](data:image/png;base64,...)，可以直接在支持 Markdown 的环境中显示。

请求参数
OpenAI Images API 格式参数
参数	类型	必填	默认值	说明
model	string	是	-	模型名称，如 MODEL_NAME
prompt	string	是	-	图片描述文本
size	string	否	1:1	图片比例，支持 1:1、16:9、9:16、4:3、3:4、3:2、2:3
n	integer	否	1	生成图片数量
Gemini 原生格式参数
参数	类型	必填	默认值	说明
model	string	是	-	模型名称（URL 路径参数），如 MODEL_NAME
contents	array	是	-	对话内容列表，包含用户提示词
generationConfig.responseModalities	array	是	-	响应模式，图片生成设置为 ["IMAGE"]
generationConfig.imageConfig.aspectRatio	string	否	1:1	图片比例，支持 1:1、16:9、9:16、4:3、3:4、3:2、2:3

完整参数列表请参考 Gemini 官方文档

OpenAI Chat Completions 格式参数
参数	类型	必填	默认值	说明
model	string	是	-	模型名称，如 MODEL_NAME
messages	array	是	-	对话消息列表，格式同 OpenAI

注意：Chat Completions 格式自动识别为图片生成，返回的图片以 Markdown 格式嵌入在 content 字段中。

响应字段说明
OpenAI Images API 格式响应字段
字段	类型	说明
created	integer	创建时间戳
data	array	生成的图片列表
data[].b64_json	string	Base64 编码的 PNG 图片数据
Gemini 原生格式响应字段
字段	类型	说明
candidates	array	生成的候选响应列表
candidates[].content.parts	array	响应内容部分
candidates[].content.parts[].inlineData.mimeType	string	图片 MIME 类型，如 image/png
candidates[].content.parts[].inlineData.data	string	Base64 编码的图片数据
candidates[].content.role	string	角色，固定为 model
candidates[].finishReason	string	结束原因：STOP（正常结束）、NO_IMAGE（未生成图片）、SAFETY（安全过滤）
createTime	string	创建时间
model	string	使用的模型名称
modelVersion	string	模型版本
responseId	string	响应的唯一标识符
usageMetadata	object	token 使用情况统计
usageMetadata.promptTokenCount	integer	输入 token 数
usageMetadata.candidatesTokenCount	integer	生成 token 数
usageMetadata.totalTokenCount	integer	总 token 数
OpenAI Chat Completions 格式响应字段
字段	类型	说明
id	string	响应的唯一标识符
model	string	使用的模型名称
object	string	对象类型，固定为 chat.completion
created	integer	创建时间戳
choices	array	生成的候选响应列表
choices[].message.role	string	角色，固定为 assistant
choices[].message.content	string	Markdown 格式的图片：![image](data:image/png;base64,...)
choices[].finish_reason	string	结束原因：stop（正常结束）
usage	object	token 使用情况统计
usage.prompt_tokens	integer	输入 token 数
usage.completion_tokens	integer	生成 token 数
usage.total_tokens	integer	总 token 数
---


## 7. 🎨 Doubao

🎨 Doubao 图片接口

Doubao (豆包) 图片生成接口文档。

接口地址
POST https://www.moyu.info/v1/images/generations

Copy
请求示例
注意事项

⚠️ Windows 环境下 curl 中文编码问题

在 Windows 系统上使用 curl 的 -d 参数直接传递中文时，curl 会使用系统码页（GBK）而非 UTF-8 编码，导致中文 prompt 被错误理解。

推荐解决方案：

使用 --data-binary @文件 方式发送请求
或使用 Python/JavaScript/Go 等编程语言调用
cURL（推荐方式）
# 创建 UTF-8 编码的请求文件
printf '{"model":"doubao-seedream-4-5-251128","prompt":"星际穿越，黑洞，电影大片，超现实主义，极致的光影","size":"2K","response_format":"url","watermark":true}' > img_req.json

# 发送请求
curl -X POST "https://www.moyu.info/v1/images/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @img_req.json

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/images/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "doubao-seedream-4-5-251128",
        "prompt": "星际穿越，黑洞，电影大片，超现实主义，极致的光影",
        "size": "2K",
        "response_format": "url",
        "watermark": True
    }
)
print(response.json())

Copy
响应格式
{
  "model": "doubao-seedream-4-5-251128",
  "created": 1770558368,
  "data": [
    {
      "url": "https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/doubao-seedream-4-5/...",
      "size": "2048x2048"
    }
  ],
  "usage": {
    "generated_images": 1,
    "output_tokens": 16384,
    "total_tokens": 16384
  }
}

Copy
请求参数
参数	类型	必填	默认值	说明
model	string	是	-	模型名称，如 doubao-seedream-4-5-251128
prompt	string	是	-	图片描述提示词，详细描述想要生成的图片内容
size	string	否	2K	图片尺寸，如 2K、2048x2048、2848x1600
quality	string	否	standard	图片质量：standard(标准) 或 hd(高清)
sequential_image_generation	string	否	disabled	组图生成模式：auto(自动判断) 或 disabled(关闭)

完整参数列表请参考 豆包官方文档

响应字段说明
字段	类型	说明
model	string	使用的模型名称
created	integer	创建时间戳
data	array	生成的图片列表
data[].url	string	图片的URL地址，可直接访问下载（当 response_format 为 url 时）
data[].b64_json	string	Base64编码的图片数据（当 response_format 为 b64_json 时）
data[].size	string	图片实际尺寸，如 "2048x2048"
usage	object	使用情况统计
usage.generated_images	integer	生成的图片数量
usage.output_tokens	integer	输出token数（用于计费）
usage.total_tokens	integer	总token数
完整示例
生成高清艺术图片
curl -X POST "https://www.moyu.info/v1/images/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedream-4-5-251128",
    "prompt": "未来城市夜景，赛博朋克风格，霓虹灯光，雨后街道反射，电影级画面，4K高清，景深效果",
    "size": "2848x1600",
    "response_format": "url",
    "watermark": false
  }'

Copy
图片下载说明

正常情况下，当 response_format 为 url 时，返回的图片链接可以直接在浏览器中打开访问和下载。如果遇到 URL 无法访问的情况，可通过以下两种方式获取图片。

方案一：使用 Base64 格式直接获取图片数据

将 response_format 改为 b64_json，API 会直接返回图片的 Base64 数据，无需访问外部 URL。

cURL + Python 解码保存：

printf '{"model":"doubao-seedream-4-5-251128","prompt":"你的提示词","size":"2K","response_format":"b64_json","watermark":true}' | \
curl -s -X POST "https://www.moyu.info/v1/images/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- | python -c "
import sys, json, base64
data = json.load(sys.stdin)
img = base64.b64decode(data['data'][0]['b64_json'])
with open('output.jpg', 'wb') as f:
    f.write(img)
print('Saved!')
"

Copy

Python 完整示例：

import requests, base64

response = requests.post(
    "https://www.moyu.info/v1/images/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "doubao-seedream-4-5-251128",
        "prompt": "你的提示词",
        "size": "2K",
        "response_format": "b64_json",
        "watermark": True
    }
)
data = response.json()
img = base64.b64decode(data["data"][0]["b64_json"])
with open("output.jpg", "wb") as f:
    f.write(img)

Copy
方案二：通过 curl 直接下载 URL

保持 response_format 为 url，获取到图片链接后，使用 curl 在服务端直接下载：

cURL：

# 将返回的图片 URL 用 curl 下载到本地
curl -s -o output.jpg "返回的图片URL"

Copy

Python：

import requests

# 先调用生成接口
response = requests.post(
    "https://www.moyu.info/v1/images/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "doubao-seedream-4-5-251128",
        "prompt": "你的提示词",
        "size": "2K",
        "response_format": "url",
        "watermark": True
    }
)
img_url = response.json()["data"][0]["url"]

# 再下载图片到本地
img_data = requests.get(img_url).content
with open("output.jpg", "wb") as f:
    f.write(img_data)

Copy
错误处理
常见错误

尺寸不支持

{
  "error": {
    "message": "The parameter `size` specified in the request is not valid: image size must be at least 3686400 pixels",
    "type": "upstream_error",
    "param": "size",
    "code": "InvalidParameter"
  }
}

Copy

解决方案：使用至少 2K 分辨率的尺寸，如 2K、2048x2048 或 2848x1600

模型不存在

{
  "error": {
    "message": "The model specified does not exist",
    "type": "invalid_request_error",
    "param": "model",
    "code": "model_not_found"
  }
}

Copy

解决方案：检查模型名称是否正确，确保使用 doubao-seedream-4-5-251128

Windows 环境编码问题说明
问题原因

Windows 系统上 curl 的 -d 参数使用系统码页（GBK/CP936）编码中文，而非 UTF-8。这会导致：

中文 prompt 被错误理解，生成的图片可能不符合预期
prompt 中的中文字符被误解为其他含义
英文 prompt 正常工作
验证方法

使用 --trace 查看实际发送的字节：

curl --trace - -X POST "https://www.moyu.info/v1/images/generations" \
  -H "Content-Type: application/json" \
  -d '{"model":"doubao-seedream-4-5-251128","prompt":"你好"}'

Copy

如果看到中文字节是 GBK 编码（如 c4 e3 ba c3）而非 UTF-8（e4 bd a0 e5 a5 bd），则确认是编码问题。

解决方案
方案一：使用文件发送（推荐）
# 创建 UTF-8 编码的请求文件
printf '{"model":"doubao-seedream-4-5-251128","prompt":"一只可爱的猫咪在阳光下睡觉","size":"2K"}' > img_req.json

# 用 xxd 验证文件编码（可选）
xxd img_req.json

# 发送请求
curl -X POST "https://www.moyu.info/v1/images/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @img_req.json

Copy
方案二：切换控制台编码
chcp 65001

Copy

然后再执行 curl 命令。

方案三：使用编程语言（推荐）

使用 Python、JavaScript、Go 等编程语言调用 API，这些语言默认使用 UTF-8 编码，不会出现编码问题。
---


## 8. 🌊 Hailuo

🎨 MiniMax-Hailuo 图片接口

MiniMax-Hailuo 图片生成接口文档。

接口地址
POST https://www.moyu.info/v1/images/generations

Copy
请求示例
注意事项

⚠️ Windows 环境下 curl JSON 引号问题

在 Windows/Git Bash 环境下使用 curl 时，JSON数据的引号格式很重要：

❌ 错误写法：-d "{\"model\": \"...\"}"（双引号包裹，需要转义）
✅ 正确写法：-d '{"model": "..."}'（单引号包裹，无需转义）

使用单引号包裹JSON可以避免转义字符被错误处理。

cURL
curl -X POST "https://www.moyu.info/v1/images/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "model_name",
    "prompt": "A girl standing by the window",
    "aspect_ratio": "16:9"
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/images/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "model_name",
        "prompt": "A girl standing by the window",
        "aspect_ratio": "16:9"
    }
)
print(response.json())

Copy
响应格式
成功响应
{
  "id": "05ede82792620ce1864e440c0190fd39",
  "data": {
    "image_urls": [
      "http://hailuo-image-algeng-data-us.oss-us-east-1.aliyuncs.com/image_inference_output/talkie/prod/img/2026-02-25/e7b022c0-383f-42ac-a11f-b4a5aae297f6_aigc.jpeg?Expires=1772095156&OSSAccessKeyId=LTAI5tRDTcyEYLLuBEpJRwCi&Signature=LJ5tfg%2B%2BEozsDAIp0nPgjSEEDm8%3D"
    ]
  },
  "metadata": {
    "failed_count": "0",
    "success_count": "1"
  },
  "base_resp": {
    "status_code": 0,
    "status_msg": "success"
  }
}

Copy
错误响应
{
  "id": "05ede69bc84260c4c26a8e76b8489a59",
  "data": null,
  "base_resp": {
    "status_code": 1000,
    "status_msg": "unknown error"
  }
}

Copy
请求参数
参数	类型	必填	默认值	说明
model	string	是	-	模型名称，固定为 model_name
prompt	string	是	-	图片描述提示词，描述想要生成的图片内容
aspect_ratio	string	否	1:1	图片宽高比，支持：1:1、16:9、9:16、4:3、3:4 等
响应字段说明
字段	类型	说明
id	string	请求的唯一标识符
data	object	生成结果数据
data.image_urls	array	生成的图片URL列表，带签名的临时链接
metadata	object	元数据信息
metadata.failed_count	string	失败的图片数量
metadata.success_count	string	成功生成的图片数量
base_resp	object	基础响应信息
base_resp.status_code	integer	状态码，0 表示成功，其他值表示错误
base_resp.status_msg	string	状态消息，如 success 或错误描述
完整示例
生成不同比例的图片
16:9 横向图片
curl -X POST "https://www.moyu.info/v1/images/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "model_name",
    "prompt": "A serene landscape with mountains and a lake at sunset",
    "aspect_ratio": "16:9"
  }'

Copy
9:16 竖向图片
curl -X POST "https://www.moyu.info/v1/images/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "model_name",
    "prompt": "A tall futuristic building reaching into the clouds",
    "aspect_ratio": "9:16"
  }'

Copy
1:1 正方形图片（默认）
curl -X POST "https://www.moyu.info/v1/images/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "model_name",
    "prompt": "A cute cat sleeping in a cozy bed"
  }'

Copy
错误处理
常见错误

认证失败

{
  "base_resp": {
    "status_code": 1001,
    "status_msg": "authentication failed"
  }
}

Copy

解决方案：检查API Key是否正确，确保 Authorization header 格式为 Bearer YOUR_API_KEY

请求参数错误

{
  "base_resp": {
    "status_code": 1000,
    "status_msg": "unknown error"
  }
}

Copy

解决方案：

检查模型名称是否为 model_name
检查 aspect_ratio 是否使用支持的值
确保 JSON 格式正确

提示词不合规

{
  "base_resp": {
    "status_code": 1002,
    "status_msg": "prompt contains inappropriate content"
  }
}

Copy

解决方案：修改提示词，避免使用违规或敏感内容

最佳实践
1. Prompt 编写建议
具体描述：提供详细的场景、风格、光线等描述
使用英文：模型对英文提示词的理解更准确
避免模糊词汇：使用具体的形容词而非模糊的"好看"、"漂亮"等

示例：

❌ "A beautiful picture"
✅ "A serene Japanese garden with cherry blossoms, stone lanterns, and a koi pond, soft morning light, photorealistic style"
2. 选择合适的宽高比
16:9：适合风景、场景、横幅图片
9:16：适合人物肖像、手机壁纸
1:1：适合社交媒体头像、产品图
4:3 / 3:4：传统照片比例
3. 图片URL处理

生成的图片URL是带签名的临时链接（OSS），建议：

立即下载保存图片
不要长期依赖该URL（可能会过期）
如需持久化，请将图片保存到自己的存储服务
4. Python 下载图片示例
import requests
from PIL import Image
from io import BytesIO

# 生成图片
response = requests.post(
    "https://www.moyu.info/v1/images/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "model_name",
        "prompt": "A girl standing by the window",
        "aspect_ratio": "16:9"
    }
)

result = response.json()

# 检查是否成功
if result["base_resp"]["status_code"] == 0:
    image_url = result["data"]["image_urls"][0]

    # 下载图片
    img_response = requests.get(image_url)
    img = Image.open(BytesIO(img_response.content))

    # 保存图片
    img.save("generated_image.jpg")
    print("图片已保存")
else:
    print(f"生成失败: {result['base_resp']['status_msg']}")

Copy
Windows 环境 curl 使用说明
问题说明

在 Windows/Git Bash 环境下使用 curl 时，JSON 数据的引号格式非常重要。如果使用双引号包裹 JSON 并对内部引号进行转义（如 "{\"key\": \"value\"}"），可能导致转义字符处理错误。

推荐做法

使用单引号包裹 JSON 数据：

# ✅ 正确
curl -d '{"model": "model_name", "prompt": "test"}'

# ❌ 错误（可能导致请求失败）
curl -d "{\"model\": \"model_name\", \"prompt\": \"test\"}"

Copy
替代方案

如果遇到引号问题，可以使用文件方式：

# 创建请求文件
cat > request.json << 'EOF'
{
  "model": "model_name",
  "prompt": "A girl standing by the window",
  "aspect_ratio": "16:9"
}
EOF

# 使用文件发送请求
curl -X POST "https://www.moyu.info/v1/images/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @request.json

Copy
相关资源
MiniMax 官方文档
海螺AI 官网
---


## 9. 🍌 Banana

Gemini 图生图调用示例

模型：gemini-3-pro-image-preview

一、Gemini 原生格式（generateContent）
curl -X POST "https://www.moyu.info/v1beta/models/gemini-3-pro-image-preview:generateContent" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [
          {
            "inlineData": {
              "mimeType": "image/png",
              "data": "<BASE64_IMAGE_DATA>"
            }
          },
          {
            "text": "Add a sailboat to this sunset scene"
          }
        ]
      }
    ],
    "generationConfig": {
      "responseModalities": ["IMAGE"],
      "imageConfig": {
        "aspectRatio": "16:9"
      }
    }
  }'

Copy
参数说明
参数	说明
inlineData.mimeType	图片 MIME 类型，支持 image/png、image/jpeg、image/webp
inlineData.data	图片的 Base64 编码字符串（不含 data:image/png;base64, 前缀）
text	对图片的编辑指令
responseModalities	设为 ["IMAGE"] 返回图片
imageConfig.aspectRatio	输出比例，如 1:1、16:9、9:16、4:3、3:4
响应示例
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "inlineData": {
              "mimeType": "image/png",
              "data": "<BASE64_RESULT_IMAGE>"
            }
          }
        ],
        "role": "model"
      }
    }
  ]
}

Copy
二、OpenAI 兼容格式（images/generations）
curl -X POST "https://www.moyu.info/v1/images/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3-pro-image-preview",
    "prompt": "Add a sailboat to this sunset scene",
    "image": "data:image/png;base64,<BASE64_IMAGE_DATA>",
    "size": "16:9",
    "n": 1
  }'

Copy
参数说明
参数	说明
model	模型名称
prompt	对图片的编辑指令
image	原始图片，格式为 data:<MIME>;base64,<DATA>（带前缀）
size	输出比例，如 1:1、16:9
n	生成数量
响应示例
{
  "created": 1710000000,
  "data": [
    {
      "b64_json": "<BASE64_RESULT_IMAGE>",
      "revised_prompt": ""
    }
  ]
}

Copy
三、Python 完整示例
import json
import base64
import urllib.request

API_KEY = "YOUR_API_KEY"
BASE_URL = "https://www.moyu.info"

# 读取本地图片并编码为 base64
with open("input.png", "rb") as f:
    img_b64 = base64.b64encode(f.read()).decode("utf-8")

# === 方式一：Gemini 原生格式 ===
payload = json.dumps({
    "contents": [
        {
            "role": "user",
            "parts": [
                {
                    "inlineData": {
                        "mimeType": "image/png",
                        "data": img_b64
                    }
                },
                {
                    "text": "将这张图片转换为水彩画风格"
                }
            ]
        }
    ],
    "generationConfig": {
        "responseModalities": ["IMAGE"],
        "imageConfig": {
            "aspectRatio": "16:9"
        }
    }
})

req = urllib.request.Request(
    f"{BASE_URL}/v1beta/models/gemini-3-pro-image-preview:generateContent",
    data=payload.encode("utf-8"),
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
)
resp = json.loads(urllib.request.urlopen(req, timeout=120).read())
result_b64 = resp["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]

with open("output_gemini.png", "wb") as f:
    f.write(base64.b64decode(result_b64))
print("Gemini 格式图生图完成: output_gemini.png")


# === 方式二：OpenAI 兼容格式 ===
payload = json.dumps({
    "model": "gemini-3-pro-image-preview",
    "prompt": "将这张图片转换为水彩画风格",
    "image": f"data:image/png;base64,{img_b64}",
    "size": "16:9",
    "n": 1
})

req = urllib.request.Request(
    f"{BASE_URL}/v1/images/generations",
    data=payload.encode("utf-8"),
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
)
resp = json.loads(urllib.request.urlopen(req, timeout=120).read())
result_b64 = resp["data"][0]["b64_json"]

with open("output_openai.png", "wb") as f:
    f.write(base64.b64decode(result_b64))
print("OpenAI 格式图生图完成: output_openai.png")

Copy
---


## 10. 🖌️ GPT-Image-2

🎨 GPT-Image-2 图片接口

GPT-Image-2 图片生成与编辑接口文档。

图片生成
接口地址
POST https://www.moyu.info/v1/images/generations

Copy
请求示例
cURL
curl -X POST "https://www.moyu.info/v1/images/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "A photograph of a red fox in an autumn forest",
    "n": 1,
    "size": "1536x1024",
    "quality": "medium"
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/images/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "gpt-image-2",
        "prompt": "A photograph of a red fox in an autumn forest",
        "n": 1,
        "size": "1536x1024",
        "quality": "medium"
    }
)
print(response.json())

Copy
请求参数
参数	类型	必填	默认值	说明
model	string	是	-	模型名称，固定为 gpt-image-2
prompt	string	是	-	期望生成图像的文本描述
n	number	否	1	生成的图像数量，取值范围 1~10
size	string	否	auto	图片尺寸：1024x1024、1536x1024、1024x1536、auto
quality	string	否	auto	图片质量：high、medium、low、auto（auto 自动选择最佳质量）
响应格式
{
  "created": 1776998971,
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ],
  "usage": {
    "input_tokens_details": {}
  }
}

Copy
图片编辑
接口地址
POST https://www.moyu.info/v1/images/edits

Copy
请求示例
cURL
curl -X POST "https://www.moyu.info/v1/images/edits" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "model=gpt-image-2" \
  -F "image=@image_to_edit.png" \
  -F "prompt=Make this black and white"

Copy

多图编辑（最多 16 张）：

curl -X POST "https://www.moyu.info/v1/images/edits" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "model=gpt-image-2" \
  -F "image[]=@image1.png" \
  -F "image[]=@image2.png" \
  -F "prompt=Merge these two images into one, side by side"

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/images/edits",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    files={"image": open("image_to_edit.png", "rb")},
    data={
        "model": "gpt-image-2",
        "prompt": "Make this black and white"
    }
)
print(response.json())

Copy
请求参数
参数	类型	必填	默认值	说明
model	string	是	-	模型名称，固定为 gpt-image-2
prompt	string	是	-	期望编辑图像的文本描述
image	file	否	-	上传单张图片文件
image[]	file	否	-	上传多张图片文件，最多 16 张，使用 image[]=@file1.png 形式传入
n	number	否	1	生成的图像数量，取值范围 1~10
size	string	否	auto	图片尺寸：1024x1024、1536x1024、1024x1536、auto
quality	string	否	auto	图片质量：high、medium、low、auto
响应格式
{
  "created": 1776999373,
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ],
  "usage": {
    "input_tokens_details": {}
  }
}

Copy
响应字段说明
字段	类型	说明
created	integer	创建时间戳
data	array	生成/编辑的图片列表
data[].b64_json	string	Base64 编码的图片数据
data[].url	string	图片的 URL 地址（如果返回 URL 格式）
usage	object	使用情况统计
---


## 11. 🎨 即梦

🎨 即梦视频接口

即梦(Jimeng)视频/图像生成接口文档。

接口地址
提交任务
POST https://www.moyu.info/v1/video/generations

Copy
查询结果
GET https://www.moyu.info/v1/video/generations/{task_id}

Copy
请求示例
文生视频 (Text-to-Video)
cURL
curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng_t2v_v30",
    "prompt": "A beautiful sunset over mountains",
    "frames": 121
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/video/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "jimeng_t2v_v30",
        "prompt": "A beautiful sunset over mountains",
        "frames": 121
    }
)
print(response.json())

Copy
图生视频 (Image-to-Video)
单图生视频
curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng_i2v_v30",
    "prompt": "Make the scene come alive with movement",
    "frames": 121,
    "metadata": {
      "image_urls": ["https://example.com/image.jpg"]
    }
  }'

Copy
首尾帧生视频

传入两张图片作为首帧和尾帧，生成过渡视频：

curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng_i2v_first_tail_v30_1080",
    "prompt": "The plane takes off and flies into the sky",
    "frames": 121,
    "metadata": {
      "image_urls": ["https://example.com/first.jpg", "https://example.com/last.jpg"]
    }
  }'

Copy

也可以使用 Base64 方式传入图片：

curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng_i2v_first_tail_v30_1080",
    "prompt": "The plane takes off and flies into the sky",
    "frames": 121,
    "metadata": {
      "binary_data_base64": ["<首帧Base64>", "<尾帧Base64>"]
    }
  }'

Copy
文生图 (Text-to-Image)

文生图功能可以根据文本描述生成图片。

cURL
curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng_t2i_v30",
    "prompt": "一只可爱的猫咪"
  }'

Copy

响应示例：

{
  "id": "6369603594515605437",
  "task_id": "6369603594515605437",
  "object": "video",
  "model": "jimeng_t2i_v30",
  "status": "",
  "progress": 0,
  "created_at": 0
}

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/video/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "jimeng_t2i_v30",
        "prompt": "一只可爱的猫咪"
    }
)
print(response.json())

Copy
图生图 (Image-to-Image)

图生图功能可以基于输入图片和文本描述生成新的图片。

通过 URL 传入图片
curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng_i2i_v30",
    "prompt": "将这张图转换为油画风格",
    "metadata": {
      "image_urls": ["https://example.com/input-image.jpg"]
    }
  }'

Copy
通过 Base64 传入图片
curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng_i2i_v30",
    "prompt": "将这张图转换为油画风格",
    "metadata": {
      "binary_data_base64": ["<Base64编码图片>"]
    }
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/video/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "jimeng_i2i_v30",
        "prompt": "将这张图转换为油画风格",
        "metadata": {
            "image_urls": ["https://example.com/input-image.jpg"]
        }
    }
)
print(response.json())

Copy
提交任务响应格式
{
  "id": "3666383187090401977",
  "task_id": "3666383187090401977",
  "object": "video",
  "model": "jimeng_t2v_v30",
  "status": "",
  "progress": 0,
  "created_at": 0
}

Copy

重要：即梦为异步接口，返回task_id后需要使用该ID查询生成结果。

查询结果

使用返回的task_id查询视频生成进度和结果。

查询请求示例
cURL
curl -X GET "https://www.moyu.info/v1/video/generations/{task_id}" \
  -H "Authorization: Bearer YOUR_API_KEY"

Copy
其他语言
python
javascript
go
import requests

response = requests.get(
    "https://www.moyu.info/v1/video/generations/{task_id}",
    headers={"Authorization": "Bearer YOUR_API_KEY"}
)
print(response.json())

Copy
查询响应格式
任务进行中
{
  "code": "success",
  "message": "",
  "data": {
    "task_id": "3666383187090401977",
    "action": "generate",
    "status": "QUEUED",
    "fail_reason": "",
    "submit_time": 1770371348,
    "start_time": 0,
    "finish_time": 0,
    "progress": "10%",
    "data": {
      "code": 10000,
      "data": {
        "status": "in_queue",
        "video_url": "",
        "aigc_meta_tagged": false
      },
      "status": 10000,
      "message": "Success",
      "request_id": "202602061749147B73036B5FB941002F4C",
      "time_elapsed": "10.751557ms"
    }
  }
}

Copy
视频生成成功
{
  "code": "success",
  "message": "",
  "data": {
    "task_id": "4380441713537006986",
    "action": "generate",
    "status": "SUCCESS",
    "fail_reason": "",
    "submit_time": 1770203734,
    "start_time": 0,
    "finish_time": 1770203788,
    "progress": "100%",
    "data": {
      "code": 10000,
      "data": {
        "status": "done",
        "video_url": "https://example.com/video.mp4",
        "aigc_meta_tagged": false
      },
      "status": 10000,
      "message": "Success",
      "request_id": "20260204191628938F89EB62CF1C126F96",
      "time_elapsed": "64.431549ms"
    }
  }
}

Copy
图像生成成功
{
  "code": "success",
  "message": "",
  "data": {
    "task_id": "3990629258597848124",
    "action": "generate",
    "status": "SUCCESS",
    "fail_reason": "",
    "submit_time": 1770203838,
    "start_time": 0,
    "finish_time": 1770203853,
    "progress": "100%",
    "data": {
      "code": 10000,
      "data": {
        "status": "done",
        "video_url": "",
        "image_urls": null,
        "aigc_meta_tagged": false,
        "binary_data_base64": ["iVBORw0KGgoAAAANSUhEUg..."]
      },
      "status": 10000,
      "message": "Success",
      "request_id": "20260204191823E8BB64...",
      "time_elapsed": "19.876393ms"
    }
  }
}

Copy

重要说明：

即梦的文生图和图生图模型返回的图片格式为 Base64 编码
图片数据存储在 data.data.binary_data_base64 数组中
您需要自行处理 Base64 格式的图片数据

Base64 图片处理示例：

python
javascript
go
import base64
import requests

# 查询任务结果
response = requests.get(
    "https://www.moyu.info/v1/video/generations/{task_id}",
    headers={"Authorization": "Bearer YOUR_API_KEY"}
)

result = response.json()
if result["data"]["status"] == "SUCCESS":
    # 获取 Base64 编码的图片数据
    base64_images = result["data"]["data"]["binary_data_base64"]

    # 解码并保存图片
    for i, base64_str in enumerate(base64_images):
        image_data = base64.b64decode(base64_str)
        with open(f"image_{i}.jpg", "wb") as f:
            f.write(image_data)
        print(f"图片已保存: image_{i}.jpg")

Copy
任务失败
{
  "code": "success",
  "message": "",
  "data": {
    "task_id": "13958182363172442081",
    "action": "generate",
    "status": "FAILURE",
    "fail_reason": "Invalid Input Parameters: :  <- [返回]算法返回码=201202,消息=Invalid Param:x2v pipeline: frames should be [73, 289]",
    "submit_time": 1770203818,
    "start_time": 0,
    "finish_time": 1770203818,
    "progress": "100%",
    "data": {
      "code": 50200,
      "data": null,
      "status": 50200,
      "message": "Invalid Input Parameters: :  <- [返回]算法返回码=201202,消息=Invalid Param:x2v pipeline: frames should be [73, 289]",
      "request_id": "20260204191658A6BEBDEDF341C500AFDD",
      "time_elapsed": "34.515917ms"
    }
  }
}

Copy
停止任务

在任务执行过程中，可以取消正在进行的任务。

停止请求示例
cURL
curl -X DELETE "https://www.moyu.info/v1/videos/{task_id}" \
  -H "Authorization: Bearer YOUR_API_KEY"

Copy
其他语言
python
javascript
go
import requests

response = requests.delete(
    "https://www.moyu.info/v1/videos/{task_id}",
    headers={"Authorization": "Bearer YOUR_API_KEY"}
)
print(response.json())

Copy
停止任务响应格式
{
  "code": "success",
  "message": "Task cancelled successfully",
  "data": {
    "task_id": "4380441713537006986",
    "action": "generate",
    "status": "CANCELLED",
    "fail_reason": "Task cancelled by user",
    "submit_time": 1770203734,
    "start_time": 0,
    "finish_time": 1770267360,
    "progress": "100%"
  }
}

Copy

注意：只能停止状态为QUEUED或处理中的任务。已完成（SUCCESS）或已失败（FAILURE）的任务无法取消。

请求参数
提交任务参数
参数	类型	必填	说明
model	string	是	模型名称，如 jimeng_t2v_v30、jimeng_i2v_v30、jimeng_i2v_first_tail_v30_1080、jimeng_t2i_v30、jimeng_i2i_v30
prompt	string	是	描述提示词，详细描述想要生成的内容
frames	integer	视频时需要	视频帧数，支持 121(5秒) 或 241(10秒)
metadata	object	图生视频/图生图时需要	用于传递上游特有参数，详见下方说明
aspect_ratio	string	否	宽高比，如 16:9、9:16、1:1
metadata 参数说明

通过 metadata 传入图片和其他上游特有参数，metadata 中的字段会被展开后直接发送给上游接口。

metadata 子参数	类型	说明
image_urls	string[]	输入图片的 URL 数组
binary_data_base64	string[]	输入图片的 Base64 编码数组（与 image_urls 二选一）
width	integer	生成图片宽度
height	integer	生成图片高度

完整参数列表请参考 即梦官方文档

响应字段说明
提交任务响应字段
字段	类型	说明
id	string	任务唯一标识符
task_id	string	任务ID，用于查询生成结果
object	string	对象类型，如 "video"
model	string	使用的模型名称
status	string	任务状态
progress	integer	进度百分比
created_at	integer	创建时间戳
查询结果响应字段
字段	类型	说明
code	string	响应码，"success" 表示查询成功
message	string	响应消息
data.task_id	string	任务ID
data.action	string	操作类型，如 "generate"
data.status	string	任务状态：NOT_START(未开始)、QUEUED(排队中)、SUCCESS(成功)、FAILURE(失败)
data.fail_reason	string	失败原因
data.submit_time	integer	提交时间戳
data.start_time	integer	开始时间戳
data.finish_time	integer	完成时间戳
data.progress	string	进度百分比，如 "10%", "100%"
data.data.status	string	详细状态：in_queue(队列中)、done(完成)
data.data.video_url	string	生成的视频URL（视频任务）
data.data.binary_data_base64	array	Base64编码的图片数据（图像任务）
data.data.image_urls	array	图片URL列表（如果有）
data.data.aigc_meta_tagged	boolean	AIGC元数据标记
---


## 12. 🎬 Kling

🎬 Kling 视频接口

Kling AI 视频/图像生成接口文档。

接口地址
提交任务
POST https://www.moyu.info/v1/video/generations

Copy
查询结果
GET https://www.moyu.info/v1/videos/{task_id}

Copy
获取视频内容
GET https://www.moyu.info/v1/videos/{task_id}/content

Copy
请求示例
文生视频 (Text-to-Video)
cURL
curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "prompt": "一只可爱的熊猫在吃竹子"
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/video/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "MODEL_NAME",
        "prompt": "一只可爱的熊猫在吃竹子"
    }
)
print(response.json())

Copy
图生视频 (Image-to-Video)
cURL
curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "prompt": "Make the scene come alive with movement",
    "image": "https://example.com/image.jpg",
    "duration": 5
  }'

Copy
带完整参数的请求
cURL
curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "prompt": "一只可爱的熊猫在吃竹子",
    "duration": 10,
    "mode": "pro",
    "metadata": {
      "mode": "pro",
      "cfg_scale": 0.6,
      "aspect_ratio": "16:9",
      "negative_prompt": "blurry, low quality, distorted",
      "seed": 12345
    }
  }'

Copy
提交任务响应格式
{
  "id": "848244325094924334",
  "task_id": "848244325094924334",
  "object": "video",
  "model": "MODEL_NAME",
  "status": "PENDING",
  "progress": 0,
  "created_at": 0
}

Copy

重要：Kling为异步接口，返回task_id后需要使用该ID查询生成结果。

查询结果

使用返回的task_id查询视频生成进度和结果。

查询请求示例
cURL
curl -X GET "https://www.moyu.info/v1/videos/{task_id}" \
  -H "Authorization: Bearer YOUR_API_KEY"

Copy
其他语言
python
javascript
go
import requests

response = requests.get(
    "https://www.moyu.info/v1/videos/{task_id}",
    headers={"Authorization": "Bearer YOUR_API_KEY"}
)
print(response.json())

Copy
查询响应格式
任务进行中
{
  "id": "848244325094924334",
  "object": "video",
  "model": "",
  "status": "queued",
  "progress": 20,
  "created_at": 1770265725
}

Copy
视频生成成功
{
  "id": "848244325094924334",
  "object": "video",
  "model": "MODEL_NAME",
  "status": "succeeded",
  "progress": 100,
  "video_url": "https://example.com/video.mp4",
  "created_at": 1770265725
}

Copy
任务失败
{
  "id": "848244325094924334",
  "object": "video",
  "model": "MODEL_NAME",
  "status": "failed",
  "progress": 0,
  "error": {
    "code": "invalid_parameters",
    "message": "Invalid duration parameter"
  },
  "created_at": 1770265725
}

Copy
获取视频内容

当任务状态为 succeeded 时，可以通过以下方式下载视频内容。

下载请求示例
cURL
curl -X GET "https://www.moyu.info/v1/videos/{task_id}/content" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -o "kling_video.mp4"

Copy
其他语言
python
javascript
go
import requests

response = requests.get(
    "https://www.moyu.info/v1/videos/{task_id}/content",
    headers={"Authorization": "Bearer YOUR_API_KEY"}
)
with open("kling_video.mp4", "wb") as f:
    f.write(response.content)

Copy
停止任务

在任务执行过程中，可以取消正在进行的任务。

停止请求示例
cURL
curl -X DELETE "https://www.moyu.info/v1/videos/{task_id}" \
  -H "Authorization: Bearer YOUR_API_KEY"

Copy
其他语言
python
javascript
go
import requests

response = requests.delete(
    "https://www.moyu.info/v1/videos/{task_id}",
    headers={"Authorization": "Bearer YOUR_API_KEY"}
)
print(response.json())

Copy
停止任务响应格式
{
  "id": "848251142349520901",
  "object": "video",
  "model": "kling-v1",
  "status": "cancelled",
  "progress": 100,
  "created_at": 1770267350,
  "completed_at": 1770267360,
  "error": {
    "message": "Task cancelled by user",
    "code": "task_cancelled"
  }
}

Copy

注意：只能停止状态为queued或processing的任务。已完成（succeeded）或已失败（failed）的任务无法取消。

请求参数
提交任务参数
参数	类型	必填	说明
model	string	是	模型名称
prompt	string	是	描述提示词，详细描述想要生成的内容
duration	integer	否	视频时长（秒），支持 5 或 10，默认为 5
mode	string	否	生成模式：std(标准模式) 或 pro(专业模式)，默认为 pro
image	string	图生视频时需要	输入图片的URL地址或Base64编码
metadata	object	否	扩展参数对象，包含额外的视频生成配置
metadata.mode	string	否	生成模式，支持 "pro" 或 "std"（同 mode 参数）
metadata.cfg_scale	number	否	CFG Scale（提示词相关性），范围 0.1-1.0，默认 0.6
metadata.aspect_ratio	string	否	视频宽高比，支持 "16:9", "9:16", "1:1"
metadata.negative_prompt	string	否	负面提示词，描述不希望出现的内容
metadata.seed	integer	否	随机种子，用于可重复生成，范围 0-4294967295

duration 参数说明：

可选值：5（生成5秒视频）或 10（生成10秒视频）
默认值：5秒
使用其他值会导致任务失败

mode 参数说明：

std（标准模式）：成本较低，生成速度更快
pro（专业模式）：生成时长更长，视频质量更高
默认值：pro

提示词建议：

使用详细、具体的描述
包含场景、光线、动作、情绪等元素
支持中文和英文提示词
长度适中，避免过于简短或冗长

图生视频说明：

使用 image 参数提供输入图片
支持URL或Base64编码格式
prompt用于描述期望的动画效果
建议设置合适的duration参数

metadata 字段说明：

mode：生成模式，同顶层 mode 参数，可选 "pro"（专业模式）或 "std"（标准模式）
cfg_scale：CFG Scale（提示词相关性），控制生成结果与提示词的贴合度
范围：0.1 - 1.0
默认值：0.6
较高值会更严格遵循提示词，较低值允许更多创造性
aspect_ratio：视频宽高比
支持："16:9"（横屏）、"9:16"（竖屏）、"1:1"（方形）
常用于快速设置视频比例
negative_prompt：负面提示词
描述不希望在视频中出现的元素
例如："blurry, low quality, distorted, watermark"
seed：随机种子
范围：0 - 4294967295
相同的 seed 配合相同参数可以生成相似结果
用于可重复生成或细微调整
响应字段说明
提交任务响应字段
字段	类型	说明
id	string	任务唯一标识符
task_id	string	任务ID，用于查询生成结果
object	string	对象类型，固定为 "video"
model	string	使用的模型名称
status	string	任务状态：PENDING(待处理)
progress	integer	进度百分比（0-100）
created_at	integer	创建时间戳
查询结果响应字段
字段	类型	说明
id	string	任务唯一标识符
object	string	对象类型，固定为 "video"
model	string	使用的模型名称
status	string	任务状态：queued(排队中)、processing(处理中)、succeeded(成功)、failed(失败)
progress	integer	进度百分比（0-100）
video_url	string	生成的视频URL（仅在succeeded状态时返回）
error	object	错误信息（仅在failed状态时返回）
created_at	integer	创建时间戳
---


## 13. ✨ Sora

✨ Sora 视频接口

Sora 视频生成接口文档。

接口地址
提交任务
POST https://www.moyu.info/v1/videos

Copy
查询结果
GET https://www.moyu.info/v1/video/generations/{video_id}

Copy
下载视频
GET https://www.moyu.info/v1/videos/{video_id}/content

Copy
请求示例
文生视频 (Text-to-Video)
cURL
curl -X POST "https://www.moyu.info/v1/videos" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "prompt": "A serene mountain landscape at sunrise with golden light",
    "width": 1280,
    "height": 720,
    "metadata": {
      "seconds": "8"
    }
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/videos",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "MODEL_NAME",
        "prompt": "A serene mountain landscape at sunrise with golden light",
        "width": 1280,
        "height": 720,
        "metadata": {
            "seconds": "8"
        }
    }
)
print(response.json())

Copy
图生视频 (Image-to-Video)
cURL
curl -X POST "https://www.moyu.info/v1/videos" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "prompt": "Camera slowly zooms in, revealing intricate details",
    "width": 1280,
    "height": 720,
    "image_url": "https://example.com/image.jpg",
    "metadata": {
      "seconds": "8"
    }
  }'

Copy
提交任务响应格式
{
  "id": "video_698333221e6c8190ad6fe0adaf036968",
  "completed_at": 0,
  "created_at": 1770205986,
  "error": {
    "code": "",
    "message": ""
  },
  "expires_at": 0,
  "model": "MODEL_NAME",
  "object": "video",
  "progress": 0,
  "prompt": "",
  "remixed_from_video_id": "",
  "seconds": "8",
  "size": "1280x720",
  "status": "queued"
}

Copy

重要：Sora 为异步接口，返回 video_id（即 id 字段）后需要使用该 ID 查询生成结果。

查询结果

使用返回的 video_id 查询视频生成进度和结果。

查询请求示例
cURL
curl -X GET "https://www.moyu.info/v1/video/generations/{video_id}" \
  -H "Authorization: Bearer YOUR_API_KEY"

Copy
其他语言
python
javascript
go
import requests

response = requests.get(
    "https://www.moyu.info/v1/video/generations/{video_id}",
    headers={"Authorization": "Bearer YOUR_API_KEY"}
)
print(response.json())

Copy
查询响应格式
任务进行中
{
  "code": "success",
  "message": "",
  "data": {
    "task_id": "video_698333221e6c8190ad6fe0adaf036968",
    "action": "generate",
    "status": "QUEUED",
    "fail_reason": "",
    "submit_time": 1770205986,
    "start_time": 0,
    "finish_time": 0,
    "progress": "20%",
    "data": {
      "id": "video_698333221e6c8190ad6fe0adaf036968",
      "size": "1280x720",
      "error": {
        "code": "",
        "message": ""
      },
      "model": "MODEL_NAME",
      "object": "video",
      "prompt": "A serene mountain landscape at sunrise with golden light",
      "status": "queued",
      "seconds": "8",
      "progress": 0,
      "created_at": 1770205986,
      "expires_at": 0,
      "completed_at": 0,
      "remixed_from_video_id": ""
    }
  }
}

Copy
视频生成成功
{
  "code": "success",
  "message": "",
  "data": {
    "task_id": "video_698333221e6c8190ad6fe0adaf036968",
    "action": "generate",
    "status": "SUCCESS",
    "fail_reason": "",
    "submit_time": 1770205986,
    "start_time": 0,
    "finish_time": 1770206200,
    "progress": "100%",
    "data": {
      "id": "video_698333221e6c8190ad6fe0adaf036968",
      "size": "1280x720",
      "error": {
        "code": "",
        "message": ""
      },
      "model": "MODEL_NAME",
      "object": "video",
      "prompt": "A serene mountain landscape at sunrise with golden light",
      "status": "completed",
      "seconds": "8",
      "progress": 100,
      "created_at": 1770205986,
      "expires_at": 0,
      "completed_at": 1770206200,
      "remixed_from_video_id": ""
    }
  }
}

Copy
下载视频
下载请求示例
cURL
curl -X GET "https://www.moyu.info/v1/videos/{video_id}/content" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  --output "video.mp4"

Copy
其他语言
python
javascript
go
import requests

response = requests.get(
    "https://www.moyu.info/v1/videos/{video_id}/content",
    headers={"Authorization": "Bearer YOUR_API_KEY"}
)

with open("video.mp4", "wb") as f:
    f.write(response.content)

Copy
停止任务

在任务执行过程中，可以取消正在进行的任务。

停止请求示例
cURL
curl -X DELETE "https://www.moyu.info/v1/videos/{video_id}" \
  -H "Authorization: Bearer YOUR_API_KEY"

Copy
其他语言
python
javascript
go
import requests

response = requests.delete(
    "https://www.moyu.info/v1/videos/{video_id}",
    headers={"Authorization": "Bearer YOUR_API_KEY"}
)
print(response.json())

Copy
停止任务响应格式
{
  "id": "video_698333221e6c8190ad6fe0adaf036968",
  "object": "video",
  "model": "MODEL_NAME",
  "status": "cancelled",
  "progress": 100,
  "created_at": 1770267350,
  "completed_at": 1770267360,
  "error": {
    "message": "Task cancelled by user",
    "code": "task_cancelled"
  }
}

Copy

注意：只能停止状态为queued或processing的任务。已完成（succeeded）或已失败（failed）的任务无法取消。

请求参数
提交任务参数
参数	类型	必填	说明
model	string	是	模型名称
prompt	string	是	视频描述提示词，详细描述想要生成的视频内容
width	integer	是	视频宽度，支持 1280 或 720
height	integer	是	视频高度，支持 720 或 1280
metadata	object	是	扩展参数对象
metadata.seconds	string	是	视频时长，支持 "4", "8", "12"（秒）
image_url	string	图生视频时需要	输入图片的URL地址
fps	integer	否	视频帧率
seed	integer	否	随机种子，用于可重复生成
n	integer	否	生成视频数量
user	string	否	用户标识符

分辨率说明：

横屏视频：1280x720
竖屏视频：720x1280
其他分辨率（如 1920x1080、1280x1280）不支持

图生视频说明：

图生视频需要提供 image_url 参数，指向输入图片的URL地址
输入图片分辨率应与生成视频的 width 和 height 保持一致
prompt 参数用于描述视频中的运动和变化效果

时长说明：

metadata.seconds 必须为字符串类型
支持的值："4"（4秒）、"8"（8秒）、"12"（12秒）
使用其他值会导致任务失败

提示词建议：

使用详细、具体的描述
包含场景、光线、动作、情绪等元素
建议使用英文以获得更好的效果
长度适中，避免过于简短或冗长
响应字段说明
提交任务响应字段
字段	类型	说明
id	string	视频唯一标识符（video_id），用于查询和下载
object	string	对象类型，固定为 "video"
model	string	使用的模型名称
status	string	任务状态：queued(排队中)、processing(处理中)、completed(完成)、failed(失败)
prompt	string	视频描述提示词
seconds	string	视频时长（秒）
size	string	视频分辨率，格式为 "宽x高"
progress	integer	进度百分比
created_at	integer	创建时间戳
completed_at	integer	完成时间戳
expires_at	integer	过期时间戳
error	object	错误信息对象
查询结果响应字段
字段	类型	说明
code	string	响应码，"success" 表示查询成功
message	string	响应消息
data.task_id	string	任务ID（即 video_id）
data.action	string	操作类型，如 "generate"
data.status	string	任务状态：QUEUED(排队中)、PROCESSING(处理中)、SUCCESS(成功)、FAILURE(失败)
data.progress	string	进度百分比，如 "20%", "100%"
data.submit_time	integer	提交时间戳
data.start_time	integer	开始时间戳
data.finish_time	integer	完成时间戳
data.fail_reason	string	失败原因
data.data.id	string	视频ID
data.data.model	string	使用的模型
data.data.status	string	详细状态：queued(队列中)、processing(处理中)、completed(完成)
data.data.prompt	string	视频描述提示词
data.data.seconds	string	视频时长
data.data.size	string	视频分辨率
---


## 14. 🎥 Doubao

🎥 豆包（Doubao）视频接口

豆包 Seedance 视频生成接口文档。

接口地址
提交任务
POST https://www.moyu.info/v1/video/generations

Copy
查询结果
GET https://www.moyu.info/v1/videos/{task_id}

Copy
请求示例
文生视频 (Text-to-Video)
cURL
curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "doubao-seedance-1-5-pro-251215",
    "prompt": "一只橘色的猫咪在阳光下的花园里追逐蝴蝶",
    "duration": 10
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/video/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "doubao-seedance-1-5-pro-251215",
        "prompt": "一只橘色的猫咪在阳光下的花园里追逐蝴蝶",
        "duration": 10
    }
)
print(response.json())

Copy
图生视频 (Image-to-Video)
cURL
curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "doubao-seedance-1-5-lite-i2v-250428",
    "prompt": "让画面中的人物缓缓转头微笑",
    "images": ["https://example.com/image.jpg"],
    "duration": 5
  }'

Copy
提交任务响应格式
{
  "task_id": "cgt-20260211145453-2v7p2"
}

Copy

重要：豆包为异步接口，返回 task_id 后需要使用该 ID 查询生成结果。

查询结果

使用返回的 task_id 查询视频生成进度和结果。

查询请求示例
cURL
curl "https://www.moyu.info/v1/videos/cgt-20260211145453-2v7p2" \
  -H "Authorization: Bearer YOUR_API_KEY"

Copy
其他语言
python
javascript
go
import requests

response = requests.get(
    "https://www.moyu.info/v1/videos/{task_id}",
    headers={"Authorization": "Bearer YOUR_API_KEY"}
)
print(response.json())

Copy
请求参数
提交任务参数
参数	类型	必填	说明
model	string	是	模型名称，参见下方支持的模型列表
prompt	string	是	文本提示词，详细描述想要生成的视频内容
images	string[]	图生视频时需要	图片URL数组，用于图生视频模式
duration	integer	否	视频时长（秒），默认 5 秒
支持的模型
模型名称	说明
doubao-seedance-1-0-pro-250528	Seedance 1.0 Pro
doubao-seedance-1-0-lite-t2v	Seedance 1.0 Lite 文生视频
doubao-seedance-1-0-lite-i2v	Seedance 1.0 Lite 图生视频
doubao-seedance-1-5-pro-251215	Seedance 1.5 Pro（推荐）
doubao-seedance-1-5-lite-t2v-250428	Seedance 1.5 Lite 文生视频
doubao-seedance-1-5-lite-i2v-250428	Seedance 1.5 Lite 图生视频

提示词建议：

使用详细、具体的描述
包含场景、动作、光线、氛围等元素
支持中文和英文提示词
长度适中，避免过于简短或冗长

图生视频说明：

使用 images 参数提供输入图片的URL数组
prompt 用于描述期望的动画或运动效果
建议使用图生视频专用模型（i2v）
响应字段说明
提交任务响应字段
字段	类型	说明
task_id	string	任务唯一标识符，用于查询生成结果
查询结果响应字段

查询接口返回视频生成状态和结果信息，包括任务状态、进度、视频URL等。

计费说明

豆包视频按秒计费（quota_type=2）。

计费公式：模型单价 × 分组倍率 × 秒数

注意：未传 duration 参数时，默认按 5 秒计费。
---


## 15. 🌱 Seedance 2.0

Seedance 2.0 多图生视频调用示例
接口信息
项目	说明
提交任务	POST {BASE_URL}/v1/video/generations
查询结果	GET {BASE_URL}/v1/video/generations/{task_id}
模型名称	doubao-seedance-2-0-260128 / doubao-seedance-2-0-fast-260128
鉴权方式	Authorization: Bearer {API_KEY}
图片 Role 说明
role	说明	数量限制
first_frame	首帧图，视频从该图开始	最多 1 张
last_frame	尾帧图，视频以该图结束	最多 1 张
reference_image	参考图，用于风格/角色参考	可多张

first_frame 和 last_frame 可同时使用，实现首尾帧控制。

一、首帧 + 尾帧 + 参考图（多图）
cURL
curl -X POST "${BASE_URL}/v1/video/generations" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedance-2-0-260128",
    "prompt": "多图生视频",
    "metadata": {
        "content": [
            {
                "type": "text",
                "text": "猫咪从沙发优雅地跳到窗台上，阳光透过窗帘洒落，毛发在光线中闪烁"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/cat_on_sofa.jpg"},
                "role": "first_frame"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/cat_on_window.jpg"},
                "role": "last_frame"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/warm_style_ref.jpg"},
                "role": "reference_image"
            }
        ],
        "duration": 5,
        "resolution": "720p",
        "ratio": "16:9",
        "generate_audio": true
    }
}'

Copy
Python
import requests
import time

BASE_URL = "https://your-api-domain.com"
API_KEY = "your-api-key"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# ========== 1. 提交任务：首帧 + 尾帧 + 参考图 ==========
payload = {
    "model": "doubao-seedance-2-0-260128",
    "prompt": "多图生视频",
    "metadata": {
        "content": [
            {
                "type": "text",
                "text": "猫咪从沙发优雅地跳到窗台上，阳光透过窗帘洒落，毛发在光线中闪烁"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/cat_on_sofa.jpg"},
                "role": "first_frame"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/cat_on_window.jpg"},
                "role": "last_frame"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/warm_style_ref.jpg"},
                "role": "reference_image"
            }
        ],
        "duration": 5,
        "resolution": "720p",
        "ratio": "16:9",
        "generate_audio": True
    }
}

response = requests.post(f"{BASE_URL}/v1/video/generations", headers=headers, json=payload)
result = response.json()
task_id = result["task_id"]
print(f"任务已提交，task_id: {task_id}")

# ========== 2. 轮询查询结果 ==========
while True:
    resp = requests.get(
        f"{BASE_URL}/v1/video/generations/{task_id}",
        headers={"Authorization": f"Bearer {API_KEY}"}
    )
    data = resp.json()
    task = data.get("data", data)
    status = task.get("status", "").upper()

    print(f"状态: {status}")

    if status in ("SUCCESS", "SUCCEEDED"):
        video_url = task.get("fail_reason") or task.get("url", "")
        print(f"生成成功！视频地址: {video_url}")
        break
    elif status in ("FAILURE", "FAILED"):
        print(f"生成失败: {task.get('fail_reason', '未知错误')}")
        break

    time.sleep(15)

Copy
二、多张参考图（风格/角色控制）

适用场景：传入多张参考图控制视频的画面风格和人物形象。

cURL
curl -X POST "${BASE_URL}/v1/video/generations" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedance-2-0-260128",
    "prompt": "多参考图",
    "metadata": {
        "content": [
            {
                "type": "text",
                "text": "一位穿白裙的女孩在樱花树下转圈起舞，花瓣随风飘落，画面唯美"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/girl_portrait.jpg"},
                "role": "reference_image"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/cherry_blossom_scene.jpg"},
                "role": "reference_image"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/dance_pose_ref.jpg"},
                "role": "reference_image"
            }
        ],
        "duration": 8,
        "resolution": "720p",
        "ratio": "9:16",
        "generate_audio": true
    }
}'

Copy
Python
payload = {
    "model": "doubao-seedance-2-0-260128",
    "prompt": "多参考图",
    "metadata": {
        "content": [
            {
                "type": "text",
                "text": "一位穿白裙的女孩在樱花树下转圈起舞，花瓣随风飘落，画面唯美"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/girl_portrait.jpg"},
                "role": "reference_image"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/cherry_blossom_scene.jpg"},
                "role": "reference_image"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/dance_pose_ref.jpg"},
                "role": "reference_image"
            }
        ],
        "duration": 8,
        "resolution": "720p",
        "ratio": "9:16",
        "generate_audio": True
    }
}

response = requests.post(f"{BASE_URL}/v1/video/generations", headers=headers, json=payload)
print(response.json())

Copy
三、图片 + 视频 + 音频（全模态）

适用场景：同时传入参考图、参考视频和参考音频，生成带有指定风格和声音的视频。

cURL
curl -X POST "${BASE_URL}/v1/video/generations" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedance-2-0-260128",
    "prompt": "全模态生成",
    "metadata": {
        "content": [
            {
                "type": "text",
                "text": "一位吉他手在夕阳海滩弹唱，海浪轻拍沙滩，画面温暖治愈"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/guitarist.jpg"},
                "role": "first_frame"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/beach_sunset.jpg"},
                "role": "reference_image"
            },
            {
                "type": "video_url",
                "video_url": {"url": "https://example.com/guitar_playing.mp4"},
                "role": "reference_video"
            },
            {
                "type": "audio_url",
                "audio_url": {"url": "https://example.com/acoustic_guitar.mp3"},
                "role": "reference_audio"
            }
        ],
        "duration": 10,
        "resolution": "720p",
        "ratio": "16:9",
        "generate_audio": true
    }
}'

Copy
Python
payload = {
    "model": "doubao-seedance-2-0-260128",
    "prompt": "全模态生成",
    "metadata": {
        "content": [
            {
                "type": "text",
                "text": "一位吉他手在夕阳海滩弹唱，海浪轻拍沙滩，画面温暖治愈"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/guitarist.jpg"},
                "role": "first_frame"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/beach_sunset.jpg"},
                "role": "reference_image"
            },
            {
                "type": "video_url",
                "video_url": {"url": "https://example.com/guitar_playing.mp4"},
                "role": "reference_video"
            },
            {
                "type": "audio_url",
                "audio_url": {"url": "https://example.com/acoustic_guitar.mp3"},
                "role": "reference_audio"
            }
        ],
        "duration": 10,
        "resolution": "720p",
        "ratio": "16:9",
        "generate_audio": True
    }
}

response = requests.post(f"{BASE_URL}/v1/video/generations", headers=headers, json=payload)
print(response.json())

Copy
四、联网搜索 + 图片

在 metadata 中添加 tools 字段开启联网搜索，模型会结合搜索结果优化视频生成。

Python
payload = {
    "model": "doubao-seedance-2-0-260128",
    "prompt": "联网搜索生成",
    "metadata": {
        "content": [
            {
                "type": "text",
                "text": "2026年巴黎奥运会开幕式的精彩回顾"
            },
            {
                "type": "image_url",
                "image_url": {"url": "https://example.com/paris_stadium.jpg"},
                "role": "reference_image"
            }
        ],
        "duration": 10,
        "resolution": "720p",
        "ratio": "16:9",
        "generate_audio": True,
        "tools": [{"type": "web_search"}]
    }
}

response = requests.post(f"{BASE_URL}/v1/video/generations", headers=headers, json=payload)
print(response.json())

Copy
---


## 16. 🐴 Happy Horse

Happy Horse 视频接口

Happy Horse 视频生成接口文档。渠道类型为"阿里通义千问"，通过 DashScope 接口调用。

支持模型：

happyhorse-1.0-t2v：文生视频
happyhorse-1.0-i2v：图生视频（首帧图）
happyhorse-1.0-r2v：参考图生视频（多张参考图）
happyhorse-1.0-video-edit：视频编辑（源视频 + 可选参考图）
接口地址
提交任务
POST https://www.moyu.info/v1/video/generations

Copy
查询结果
GET https://www.moyu.info/v1/video/generations/{task_id}

Copy
请求示例
文生视频 (Text-to-Video)
cURL
curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "happyhorse-1.0-t2v",
    "prompt": "A cinematic shot of mountains at sunrise with golden light",
    "mode": "pro",
    "duration": 10,
    "aspect_ratio": "16:9",
    "sound": true
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/video/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "happyhorse-1.0-t2v",
        "prompt": "A cinematic shot of mountains at sunrise with golden light",
        "mode": "pro",
        "duration": 10,
        "aspect_ratio": "16:9",
        "sound": True
    }
)
print(response.json())

Copy
图生视频 (Image-to-Video)

使用 happyhorse-1.0-i2v 模型，通过 input_reference 字段传入首帧图片 URL。

cURL
curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "happyhorse-1.0-i2v",
    "prompt": "A cat running on the grass",
    "input_reference": "https://cdn.translate.alibaba.com/r/wanx-demo-1.png",
    "duration": 5,
    "resolution": "720P"
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/video/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "happyhorse-1.0-i2v",
        "prompt": "A cat running on the grass",
        "input_reference": "https://cdn.translate.alibaba.com/r/wanx-demo-1.png",
        "duration": 5,
        "resolution": "720P"
    }
)
print(response.json())

Copy

输入图片限制：

格式：JPEG、JPG、PNG、WEBP
分辨率：宽和高不小于 300 像素
宽高比：1:2.5 ~ 2.5:1
文件大小：不超过 10MB
参考图生视频 (Reference-to-Video)

使用 happyhorse-1.0-r2v 模型，通过 images 数组传入多张参考图（最多 3 张）。可在 prompt 中使用"图1/图2/图3"引用对应的参考图。

cURL
curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "happyhorse-1.0-r2v",
    "prompt": "身着红色旗袍的女性 图1，轻抬玉手展开折扇 图2，流苏耳坠 图3 随头部转动轻盈摆动",
    "images": [
      "https://example.com/girl.jpg",
      "https://example.com/folding-fan.jpg",
      "https://example.com/earrings.jpg"
    ],
    "duration": 5,
    "resolution": "720P",
    "aspect_ratio": "16:9"
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/video/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "happyhorse-1.0-r2v",
        "prompt": "身着红色旗袍的女性 图1，轻抬玉手展开折扇 图2，流苏耳坠 图3 随头部转动轻盈摆动",
        "images": [
            "https://example.com/girl.jpg",
            "https://example.com/folding-fan.jpg",
            "https://example.com/earrings.jpg"
        ],
        "duration": 5,
        "resolution": "720P",
        "aspect_ratio": "16:9"
    }
)
print(response.json())

Copy

提示词技巧：在描述中使用"图1"、"图2"、"图3"等关键词引用对应的参考图，模型会按照引用关系组合参考图特征。

视频编辑 (Video Edit)

使用 happyhorse-1.0-video-edit 模型，通过 input_reference 字段传入源视频 URL，通过 images 数组传入可选的参考图。

cURL
curl -X POST "https://www.moyu.info/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "happyhorse-1.0-video-edit",
    "prompt": "让视频中的角色穿上图片中的条纹毛衣",
    "input_reference": "https://example.com/source-video.mp4",
    "images": [
      "https://example.com/reference-sweater.webp"
    ],
    "resolution": "720P"
  }'

Copy
其他语言
python
javascript
go
import requests

response = requests.post(
    "https://www.moyu.info/v1/video/generations",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "model": "happyhorse-1.0-video-edit",
        "prompt": "让视频中的角色穿上图片中的条纹毛衣",
        "input_reference": "https://example.com/source-video.mp4",
        "images": [
            "https://example.com/reference-sweater.webp"
        ],
        "resolution": "720P"
    }
)
print(response.json())

Copy

输入说明：

input_reference：源视频 URL（必填），支持 HTTP/HTTPS
images：参考图 URL 数组（可选），用于指导编辑效果（如换装、风格参考等）
提交任务响应格式
{
  "id": "c8ea538a-f08c-4bca-8111-28f753eaf000",
  "object": "video",
  "model": "happyhorse-1.0-t2v",
  "status": "queued",
  "progress": 0,
  "created_at": 1777257469
}

Copy

重要：Happy Horse 为异步接口，返回 task_id（即 id 字段）后需要使用该 ID 查询生成结果。

查询结果

使用返回的 task_id 查询视频生成进度和结果。

查询请求示例
cURL
curl -X GET "https://www.moyu.info/v1/video/generations/{task_id}" \
  -H "Authorization: Bearer YOUR_API_KEY"

Copy
其他语言
python
javascript
go
import requests

response = requests.get(
    "https://www.moyu.info/v1/video/generations/{task_id}",
    headers={"Authorization": "Bearer YOUR_API_KEY"}
)
print(response.json())

Copy
查询响应格式
任务进行中
{
  "code": "success",
  "message": "",
  "data": {
    "task_id": "0ad5fd4f-6945-4c1d-813f-d5346fad25db",
    "action": "textGenerate",
    "status": "IN_PROGRESS",
    "fail_reason": "",
    "submit_time": 1777258750,
    "start_time": 1777258755,
    "finish_time": 0,
    "progress": "30%",
    "data": {
      "output": {
        "task_id": "0ad5fd4f-6945-4c1d-813f-d5346fad25db",
        "task_status": "RUNNING",
        "submit_time": "2026-04-27 10:59:13.822",
        "scheduled_time": "2026-04-27 10:59:13.869"
      },
      "request_id": "154e2256-6585-9363-b23d-95c2dce2c3f6"
    }
  }
}

Copy
视频生成成功
{
  "code": "success",
  "message": "",
  "data": {
    "task_id": "0ad5fd4f-6945-4c1d-813f-d5346fad25db",
    "action": "textGenerate",
    "status": "SUCCESS",
    "fail_reason": "https://xxx.oss-accelerate.aliyuncs.com/xxx.mp4?...",
    "submit_time": 1777258750,
    "start_time": 1777258755,
    "finish_time": 1777258923,
    "progress": "100%",
    "data": {
      "usage": {
        "SR": 1080,
        "ratio": "9:16",
        "duration": 10,
        "video_count": 1,
        "output_video_duration": 10
      },
      "output": {
        "task_id": "0ad5fd4f-6945-4c1d-813f-d5346fad25db",
        "task_status": "SUCCEEDED",
        "video_url": "https://xxx.oss-accelerate.aliyuncs.com/xxx.mp4?...",
        "orig_prompt": "A majestic eagle soaring through clouds at sunset",
        "end_time": "2026-04-27 11:02:02.968"
      },
      "request_id": "2131f395-518e-92ee-8605-a21412f07e21"
    }
  }
}

Copy
请求参数
提交任务参数
通用参数
参数	类型	必填	默认值	说明
model	string	是	-	模型名称：happyhorse-1.0-t2v（文生视频）、happyhorse-1.0-i2v（图生视频）、happyhorse-1.0-r2v（参考图生视频）
prompt	string	是	-	视频描述文本，最多 2500 字符
duration	number	否	5	视频时长（秒），范围 3-15
文生视频专属参数 (happyhorse-1.0-t2v)
参数	类型	必填	默认值	说明
mode	string	否	std	质量模式：pro（专业）或 std（标准）
aspect_ratio	string	否	16:9	输出宽高比：16:9、9:16、1:1
sound	boolean	否	true	启用原生音频生成
图生视频专属参数 (happyhorse-1.0-i2v)
参数	类型	必填	默认值	说明
input_reference	string	是	-	首帧图片 URL（HTTP 或 HTTPS）
resolution	string	否	1080P	视频分辨率：720P 或 1080P
watermark	boolean	否	true	是否在视频右下角添加 "Happy Horse" 水印
seed	integer	否	-	随机数种子，范围 [0, 2147483647]
参考图生视频专属参数 (happyhorse-1.0-r2v)
参数	类型	必填	默认值	说明
images	string[]	是	-	参考图 URL 数组（HTTP/HTTPS 或 base64），建议 1-3 张
resolution	string	否	720P	视频分辨率：720P 或 1080P
aspect_ratio	string	否	16:9	输出宽高比：16:9、9:16、1:1
seed	integer	否	-	随机数种子，范围 [0, 2147483647]
视频编辑专属参数 (happyhorse-1.0-video-edit)
参数	类型	必填	默认值	说明
input_reference	string	是	-	源视频 URL（HTTP 或 HTTPS）
images	string[]	否	-	参考图 URL 数组，用于指导编辑效果（如换装、风格参考等）
resolution	string	否	720P	视频分辨率，目前支持 720P

输入图片限制（图生视频）：

格式：JPEG、JPG、PNG、WEBP
分辨率：宽和高不小于 300 像素
宽高比：1:2.5 ~ 2.5:1
文件大小：不超过 10MB

质量模式说明（文生视频）：

std：标准模式，生成速度较快
pro：专业模式，画质更高（分辨率 1080P）

时长说明：

支持 3-15 秒
默认 5 秒

提示词建议：

使用详细、具体的描述
包含场景、光线、动作、情绪等元素
建议使用英文以获得更好的效果
响应字段说明
提交任务响应字段
字段	类型	说明
id	string	任务唯一标识符（task_id），用于查询结果
object	string	对象类型，固定为 "video"
model	string	使用的模型名称
status	string	任务状态：queued（排队中）
progress	integer	进度百分比
created_at	integer	创建时间戳
查询结果响应字段
字段	类型	说明
code	string	响应码，"success" 表示查询成功
message	string	响应消息
data.task_id	string	任务 ID
data.action	string	操作类型，如 "textGenerate"
data.status	string	任务状态：IN_PROGRESS（进行中）、SUCCESS（成功）、FAILURE（失败）
data.progress	string	进度百分比，如 "30%"、"100%"
data.submit_time	integer	提交时间戳
data.start_time	integer	开始时间戳
data.finish_time	integer	完成时间戳
data.fail_reason	string	成功时为视频 URL，失败时为错误原因
data.data.usage.ratio	string	实际输出宽高比
data.data.usage.duration	integer	实际输出视频时长（秒）
data.data.usage.SR	integer	实际输出分辨率
data.data.output.video_url	string	视频下载地址（有时效性）
data.data.output.orig_prompt	string	原始提示词
---


## 17. Openclaw 配置

OpenClaw 配置魔芋AI模型指南
概述

本文档介绍如何在 OpenClaw 中配置和使用魔芋AI（MoyuAI）的模型服务。

前置条件
已安装 OpenClaw
拥有魔芋AI的 API Key
知道魔芋AI的服务地址
配置步骤
1. 定位配置文件

OpenClaw 的配置文件位于：

Windows 系统：

C:\Users\<用户名>\.openclaw\openclaw.json

Copy

Mac/Linux 系统：

~/.openclaw/openclaw.json

Copy

或者完整路径：

/Users/<用户名>/.openclaw/openclaw.json

Copy
2. 添加魔芋AI提供商配置

在配置文件的 models.providers 部分添加魔芋AI提供商：

{
  "models": {
    "providers": {
      "MoyuAI": {
        "baseUrl": "https://www.moyu.info/v1",
        "apiKey": "你的API密钥",
        "api": "openai-completions",
        "authHeader": false,
        "models": [
          // 模型配置列表
        ]
      }
    }
  }
}

Copy

配置项说明：

baseUrl: 魔芋AI的API服务地址（例如：https://www.moyu.info/ 或自定义地址）
apiKey: 你的魔芋AI API密钥
api: API类型，使用 openai-completions 表示兼容OpenAI格式
authHeader: 是否使用自定义认证头，通常设为 false
3. 添加模型定义

在 models 数组中添加你要使用的模型：

"models": [
  {
    "id": "GPT-4.1",
    "name": "GPT-4.1",
    "api": "openai-completions",
    "reasoning": false,
    "input": [
      "text"
    ],
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "contextWindow": 400000,
    "maxTokens": 40000,
    "compat": {
      "maxTokensField": "max_tokens"
    }
  },
  {
    "id": "gpt-5.2",
    "name": "GPT-5.2",
    "api": "openai-completions",
    "reasoning": false,
    "input": [
      "text"
    ],
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0
    },
    "contextWindow": 400000,
    "maxTokens": 40000,
    "compat": {
      "maxTokensField": "max_tokens"
    }
  }
]

Copy

模型配置项说明：

id: 模型ID，需与魔芋AI服务支持的模型名称一致
name: 显示名称，可自定义
api: API类型
reasoning: 是否为推理模型
input: 支持的输入类型
cost: 费用配置（可设为0）
contextWindow: 上下文窗口大小（token数量）
maxTokens: 最大输出token数量
compat.maxTokensField: 兼容性配置
4. 配置默认模型

在 agents.defaults 部分配置要使用的模型：

{
  "agents": {
    "defaults": {
      "model": {
        "primary": "MoyuAI/gpt-5.2"
      },
      "models": {
        "MoyuAI/GPT-4.1": {
          "alias": "GPT4"
        },
        "MoyuAI/gpt-5.2": {
          "alias": "gpt"
        }
      },
      "workspace": "C:\\Users\\用户名\\.openclaw\\workspace",
      "compaction": {
        "mode": "safeguard"
      },
      "maxConcurrent": 4,
      "subagents": {
        "maxConcurrent": 8
      }
    }
  }
}

Copy

配置项说明：

model.primary: 主要使用的模型，格式为 提供商名称/模型ID
models: 可用模型列表及其别名
alias: 模型别名，便于快速切换
5. 重启OpenClaw服务

配置完成后，需要重启OpenClaw服务使配置生效：

# 1. 停止当前运行的OpenClaw（按 Ctrl+C）

# 2. 重新启动
openclaw

Copy
完整配置示例
{
  "meta": {
    "lastTouchedVersion": "2026.2.9",
    "lastTouchedAt": "2026-02-12T09:46:52.866Z"
  },
  "models": {
    "providers": {
      "MoyuAI": {
        "baseUrl": "https://www.moyu.info/v1",
        "apiKey": "sk-XXXXXX",
        "api": "openai-completions",
        "authHeader": false,
        "models": [
          {
            "id": "GPT-4.1",
            "name": "GPT-4.1",
            "api": "openai-completions",
            "reasoning": false,
            "input": ["text"],
            "cost": {
              "input": 0,
              "output": 0,
              "cacheRead": 0,
              "cacheWrite": 0
            },
            "contextWindow": 400000,
            "maxTokens": 40000,
            "compat": {
              "maxTokensField": "max_tokens"
            }
          },
          {
            "id": "gpt-5.2",
            "name": "GPT-5.2",
            "api": "openai-completions",
            "reasoning": false,
            "input": ["text"],
            "cost": {
              "input": 0,
              "output": 0,
              "cacheRead": 0,
              "cacheWrite": 0
            },
            "contextWindow": 400000,
            "maxTokens": 40000,
            "compat": {
              "maxTokensField": "max_tokens"
            }
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "MoyuAI/gpt-5.2"
      },
      "models": {
        "MoyuAI/GPT-4.1": {
          "alias": "GPT4"
        },
        "MoyuAI/gpt-5.2": {
          "alias": "gpt"
        }
      },
      "workspace": "C:\\Users\\用户名\\.openclaw\\workspace",
      "compaction": {
        "mode": "safeguard"
      },
      "maxConcurrent": 4,
      "subagents": {
        "maxConcurrent": 8
      }
    }
  },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "b45b6f6e7c14e00005ca7cdc799a9fffb3630742ee4aa35f"
    }
  }
}

Copy
验证配置

启动OpenClaw后，你应该看到类似以下的日志输出：

[gateway] agent model: MoyuAI/gpt-5.2
[gateway] listening on ws://127.0.0.1:18789

Copy
添加更多模型

如果需要添加更多模型，只需在 models 数组中继续添加模型配置：

{
  "id": "你的模型ID",
  "name": "显示名称",
  "api": "openai-completions",
  "reasoning": false,
  "input": ["text"],
  "cost": {
    "input": 0,
    "output": 0,
    "cacheRead": 0,
    "cacheWrite": 0
  },
  "contextWindow": 128000,
  "maxTokens": 8192,
  "compat": {
    "maxTokensField": "max_tokens"
  }
}

Copy
配置 Claude 模型（Anthropic API）

如果你想使用 Claude 模型（如 Claude Sonnet 4.5），需要使用 Anthropic Messages API 格式进行配置。

1. 添加 Claude 提供商配置

在配置文件的 models.providers 部分添加一个新的提供商（注意与 OpenAI 格式的提供商分开配置）：

{
  "models": {
    "providers": {
      "MoyuAI_Claude": {
        "baseUrl": "https://www.moyu.info",
        "apiKey": "你的API密钥",
        "api": "anthropic-messages",
        "authHeader": false,
        "models": [
          {
            "id": "claude-sonnet-4-5-20250929",
            "name": "claude-sonnet-4-5-20250929",
            "api": "anthropic-messages",
            "reasoning": false,
            "input": ["text"],
            "cost": {
              "input": 0,
              "output": 0,
              "cacheRead": 0,
              "cacheWrite": 0
            },
            "contextWindow": 400000,
            "maxTokens": 400000,
            "compat": {
              "maxTokensField": "max_tokens"
            }
          }
        ]
      }
    }
  }
}

Copy

重要配置说明：

baseUrl: Claude API 的基础地址（注意：不需要 /v1 后缀）
api: 必须使用 "anthropic-messages"，这是 Anthropic API 的专用格式
authHeader: 设为 false
模型的 api 字段也要设为 "anthropic-messages"
2. 配置 Claude 模型别名

在 agents.defaults.models 中添加 Claude 模型的别名：

{
  "agents": {
    "defaults": {
      "model": {
        "primary": "MoyuAI_Claude/claude-sonnet-4-5-20250929"
      },
      "models": {
        "MoyuAI_Claude/claude-sonnet-4-5-20250929": {
          "alias": "claude"
        }
      }
    }
  }
}

Copy
3. 同时使用多个提供商

你可以同时配置 OpenAI 格式和 Anthropic 格式的提供商：

{
  "models": {
    "providers": {
      "MoyuAI": {
        "baseUrl": "https://www.moyu.info/v1",
        "apiKey": "你的API密钥",
        "api": "openai-completions",
        "authHeader": false,
        "models": [
          // OpenAI 格式的模型...
        ]
      },
      "MoyuAI_Claude": {
        "baseUrl": "https://www.moyu.info",
        "apiKey": "你的API密钥",
        "api": "anthropic-messages",
        "authHeader": false,
        "models": [
          // Claude 模型...
        ]
      }
    }
  }
}

Copy
4. Mac 系统 workspace 路径配置

Windows 系统路径格式：

{
  "agents": {
    "defaults": {
      "workspace": "C:\\Users\\用户名\\.openclaw\\workspace"
    }
  }
}

Copy

Mac/Linux 系统路径格式：

{
  "agents": {
    "defaults": {
      "workspace": "/Users/用户名/.openclaw/workspace"
    }
  }
}

Copy

或者使用相对路径（推荐）：

{
  "agents": {
    "defaults": {
      "workspace": "~/.openclaw/workspace"
    }
  }
}

Copy
---


## 18. Claude Code 配置

Claude Code 安装教程
1. 环境安装
1.1 Node.js 环境安装
打开浏览器访问 https://nodejs.org/
点击 "LTS" 版本进行下载（推荐长期支持版本）
下载完成后双击 .msi 文件
按照安装向导完成安装，一直 Next 保持默认设置即可

按下 Win + X 组合键，选择 "终端管理员" 或 "Windows PowerShell (管理员)" 打开 PowerShell，输入以下命令：

node --version
npm --version

Copy

如果显示版本号，说明安装成功。

1.2 安装 Git Bash

下载并安装 Git for Windows：

访问 https://git-scm.com/downloads/win
点击 "Download for Windows" 下载安装包
运行下载的 .exe 安装文件
在安装过程中保持默认设置，直接点击 "Next" 完成安装

安装完成后验证 Git Bash 安装，打开 Git Bash 输入以下命令验证：

git --version

Copy

2. 安装 Claude Code

打开 PowerShell，运行以下命令：

npm install -g @anthropic-ai/claude-code

Copy

安装完成后若出现 Setup notes 提示，运行以下命令：

[Environment]::SetEnvironmentVariable('Path', ([Environment]::GetEnvironmentVariable('Path','User') + ";$HOME\.local\bin"), 'User')

Copy

安装完成后输入以下命令查看是否安装成功：

claude --version

Copy

安装成功后配置环境变量，在 PowerShell 输入以下命令：

[Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", "API 密钥", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "平台地址", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_MODEL", "默认 claude 模型", "User")

Copy

设置完成后关闭当前 PowerShell，重新打开一个 PowerShell 界面，检查是否配置成功：

echo $env:ANTHROPIC_AUTH_TOKEN
echo $env:ANTHROPIC_BASE_URL
echo $env:ANTHROPIC_MODEL

Copy

Mac 环境配置

在终端中编辑 ~/.zshrc 文件：

nano ~/.zshrc

Copy

在文件末尾添加以下环境变量：

export ANTHROPIC_AUTH_TOKEN="API 密钥"
export ANTHROPIC_BASE_URL="平台地址"
export ANTHROPIC_MODEL="默认 claude 模型"

Copy

保存文件后，重新加载配置使其生效：

source ~/.zshrc

Copy

验证环境变量是否配置成功：

echo $ANTHROPIC_AUTH_TOKEN
echo $ANTHROPIC_BASE_URL
echo $ANTHROPIC_MODEL

Copy
3. 使用 Claude Code

进入项目目录中输入 claude 或者直接启动 claude，即可在对话框中输入内容进行对话。

如果需要编写代码，则先在 PowerShell 中进入到对应的代码文件目录，再启动 claude 即可。
---


## 19. Codex 配置

Codex CLI 安装与配置教程
1. 安装前准备（所有系统通用）
Node.js 22+
npm 10+
稳定的网络连接

Windows 用户注意：OpenAI 官方提到 Windows 支持偏"实验性"，更稳定的方式是使用 WSL 环境。

2. 安装 Codex CLI
Windows
安装 Git Bash（按安装向导一直下一步即可）
安装 Node.js（建议安装最新 LTS 版本）
在 CMD / PowerShell 中执行以下命令安装 Codex CLI：
npm install -g @openai/codex

Copy
验证安装：
codex --version

Copy

macOS
npm install -g @openai/codex
codex --version

Copy

必要时加 sudo。

OpenAI 官方也提供了 Homebrew 安装方式（可选）：brew install codex

Linux

先安装 Node.js / npm（不同发行版命令不同）

安装与验证：

sudo npm install -g @openai/codex
codex --version

Copy
3. 配置魔芋AI中转API

Codex CLI 会读取用户目录下的配置文件 ~/.codex/（Windows 也是用户目录下的 .codex 文件夹）。需要创建两个文件：

auth.json — 存放 API 密钥
config.toml — 存放模型与网关配置
Windows 配置路径与文件
进入用户目录的 .codex 文件夹（示例：C:\Users\你的用户名\.codex）。如果看不到，先在资源管理器中开启 "显示隐藏项目"
如果没有 .codex 文件夹，手动创建，并在其中创建以下两个文件：
auth.json
config.toml
macOS / Linux 配置命令
mkdir -p ~/.codex
touch ~/.codex/auth.json
touch ~/.codex/config.toml

Copy
编辑 auth.json
{
  "OPENAI_API_KEY": null
}

Copy

OPENAI_API_KEY 设为 null，表示不使用内置 key，而是通过环境变量（env_key 指定的变量名）读取。

编辑 config.toml
model_provider = "moyuai"
model = "gpt-5.1"
model_reasoning_effort = "high"
disable_response_storage = true
preferred_auth_method = "apikey"
requires_openai_auth = true

[model_providers.moyuai]
name = "moyuai"
base_url = "https://www.moyu.info/v1"
wire_api = "responses"
env_key = "CRS_OAI_KEY"

Copy

注意：model_provider = "moyuai" 要和 [model_providers.moyuai] 的段名保持一致。model 字段可以切换为其他支持的 OpenAI 系列模型。

配置环境变量（API Key）

Windows 系统：

打开 设置 → 系统 → 关于 → 高级系统设置 → 环境变量
在"用户变量"中点击新建：
变量名：CRS_OAI_KEY
变量值：你的 API Key

配置完成后打开新终端，验证是否生效：

# PowerShell
echo $env:CRS_OAI_KEY

# CMD
echo %CRS_OAI_KEY%

Copy

输出 API Key 即为成功。

Mac / Linux 系统在终端执行：

echo 'export CRS_OAI_KEY="您的专属 API KEY"' >> ~/.bashrc
source ~/.bashrc

Copy
配置改完一定要"重启终端"

关闭当前终端窗口，重新打开一个新终端，让配置生效。

4. 启动与基本使用

进入你的项目目录，然后启动 Codex：

cd your-project-folder
codex

Copy

即可在终端中与 Codex 进行交互式对话，辅助编写代码。
---


## 20. Roo Code 配置

Roo Code 配置指南
简介

作为 Visual Studio Code 的深度集成扩展，开源工具 Roo Code 重新定义了开发辅助的边界——从基础代码提示演进为完整的自主编程代理系统。其模块化设计允许开发者根据代码开发、系统架构、调试排错等不同场景，切换对应专业模式并配置相应的行为权限。

这种全面的功能性结合可定制化特性，创造了独特的开发支持环境。更值得一提的是，Roo Code 在代码协作与自动化方面表现突出，为软件编写、质量审核及持续维护提供了智能化解决方案。

前置条件

⚠️ 重要提示
使用 Roo Code 需要具备 Visual Studio Code 编辑器。本指南默认您已下载安装 VSCode，如果尚未安装，请访问官网进行下载。

VSCode 官网： https://code.visualstudio.com

安装 Roo Code
步骤 1：打开扩展面板

在 VSCode 中，找到左侧菜单栏的扩展选项（或使用快捷键 Ctrl+Shift+X）。

步骤 2：搜索扩展

在扩展搜索框中输入 Roo Code。

步骤 3：安装扩展

找到 Roo Code 扩展后，点击"安装"按钮。

配置 Roo Code
步骤 1：打开配置界面

安装完成后，点击 VSCode 左侧导航栏的 RooCode 图标。

步骤 2：进入提供商设置

点击插件右上角的"设置"按钮，进入"提供商"界面。

步骤 3：配置 API 密钥和基础 URL

在配置界面中完成以下设置：

将 Moyuai 的 API KEY 粘贴到"Anthropic API 密钥"输入框中
勾选"使用自定义基础 URL"选项
勾选"将密钥作为 Authorization 标头传递而不是 X-Api-Key"选项
在"自定义基础 URL"中粘贴以下地址：
https://www.moyu.info/

Copy

💡 提示
如果要使用其它 API 提供商，只需切换供应商类型并输入相应的自定义基础 URL 即可。

体验 Roo Code

配置完成后，您就可以开始使用 Roo Code 了：

在对话框中输入您的指令或需求
Roo Code 会根据您的工作区内容灵活处理指令
后续使用时，直接打开 VSCode 左侧的 RooCode 图标即可

现在，您可以充分利用 Roo Code 的强大功能，让它成为您的智能编程助手，提升开发效率！
---


# 二、SDK 文档

## SDK 接口规范文档

MoyuAI Python SDK 开发接口规范

版本：v1.1.0
唯一依赖：pip install requests
使用方式：将 moyuai/ 目录复制到项目中，from moyuai import MoyuAI

目录
初始化
账务功能
临时注册 temp_register()
临时用户转正式用户 bind_phone()
标准注册 register()
用户登录 login()
查询余额 get_balance()
充值 topup() / online_topup()
查询账单 get_bills()
查看令牌 get_tokens()
创建令牌 create_token()
更新令牌 update_token()
删除令牌 delete_token()
查看可用分组 get_groups()
使用模型
获取模型列表 get_models()
文本对话
图片生成
视频生成
通用说明

所有 SDK 函数的返回值均包含 .status 字段（bool 类型），用于判断本次调用是否成功：

result = client.account.temp_register()
if result.status:
    print("调用成功")
else:
    print("调用失败")

Copy

每个函数的文档分为三部分：

输入 — 调用时传入的参数
输出 — 返回对象中的业务数据字段
返回 — .status 字段，表示调用成功或失败
1. 初始化
from moyuai import MoyuAI

client = MoyuAI()

Copy

SDK初始化，无需传入任何参数，同时，魔芋平台域名已内置。

2. 账务功能

所有账务函数通过 client.account.xxx() 调用。
需要先通过 temp_register() 或 login() 获得认证，认证后 SDK 自动保存凭证，后续调用无需再传认证参数。

2.1 临时注册
result = client.account.temp_register(appid=1)

Copy

输入：

参数	类型	必填	说明
appid	int	否	智能体应用 ID，传入后自动绑定到默认令牌

输出：TempRegisterResult 对象

字段	类型	说明
.user_id	int	用户 ID
.username	str	随机用户名（tmp_ 前缀）
.password	str	随机密码（仅此一次返回，需保存）
.access_token	str	账务接口认证凭证
.api_key	str	对话接口凭证（sk-xxx 格式）

返回：

字段	类型	说明
.status	bool	True=注册成功，False=注册失败

示例：

result = client.account.temp_register()
if result.status:
    print(f"注册成功，api_key: {result.api_key}")

# 注册后 SDK 内部自动设置了认证凭证，可直接调用账务接口
balance = client.account.get_balance()

# 绑定智能体应用（注册时自动将 appid 绑定到默认令牌）
result = client.account.temp_register(appid=1)

Copy
2.2 临时用户转正式用户

临时注册用户通过绑定手机号转为正式用户，绑定后可使用手机号 + 密码登录。

分两步调用：

# 第一步：发送验证码（只传手机号）
result = client.account.bind_phone(phone="13800138000")

# 第二步：输入验证码完成绑定（可选绑定智能体 appid）
result = client.account.bind_phone(phone="13800138000", code="123456", appid=1)

Copy

输入：

参数	类型	必填	说明
phone	str	是	要绑定的手机号
code	str	否	6位短信验证码（不传则自动发送验证码）
appid	int	否	智能体应用 ID，绑定成功后自动绑定到默认令牌

输出：Result 对象

字段	类型	说明
.message	str	提示信息（发送验证码时返回"验证码已发送，请查收短信"）

返回：

字段	类型	说明
.status	bool	True=操作成功，False=操作失败

示例：

# 临时注册 → 绑定手机号 → 转为正式用户
reg = client.account.temp_register()

client.account.bind_phone(phone="13800138000")           # 发送验证码
result = client.account.bind_phone(phone="13800138000", code="123456")  # 绑定
if result.status:
    print("绑定成功")

# 之后可用手机号 + 密码登录（密码为 reg.password）

Copy
2.3 正式用户注册

分两步调用，无需手动发送验证码：

# 第一步：发送验证码（只传手机号）
result = client.account.register(phone="13800138000")

# 第二步：输入验证码和密码完成注册（可选传入邮箱、用户名、邀请码、智能体 appid）
result = client.account.register(
    phone="13800138000",
    password="mypassword123",
    verification_code="123456",
    email="user@example.com",
    username="myuser",
    aff_code="INV123",
    appid=1
)

Copy

输入：

参数	类型	必填	说明
phone	str	是	手机号
password	str	第二步必填	密码（8-20字符，发送验证码时无需传入）
verification_code	str	否	6位短信验证码（不传则自动发送验证码）
email	str	否	邮箱
username	str	否	用户名（默认用手机号）
aff_code	str	否	邀请码
appid	int	否	智能体应用 ID，传入后自动绑定到默认令牌

输出：Result 对象

字段	类型	说明
.message	str	提示信息（发送验证码时返回"验证码已发送，请查收短信"）

返回：

字段	类型	说明
.status	bool	True=操作成功，False=操作失败

示例：

# 注册新用户
client = MoyuAI()
result = client.account.register(phone="13800138000")  # 发送验证码
if result.status:
    print("验证码已发送")

result = client.account.register(phone="13800138000", password="mypass123", verification_code="123456")
if result.status:
    print("注册成功")

# 注册后用手机号 + 密码登录
client.account.login(username="13800138000", password="mypass123")

Copy
2.4 用户登录
result = client.account.login(username="13800138000", password="mypassword123")

Copy

输入：

参数	类型	必填	说明
username	str	是	用户名、手机号或邮箱（三者任一均可）
password	str	是	密码

输出：LoginResult 对象

字段	类型	说明
.user_id	int	用户 ID
.username	str	用户名
.display_name	str	显示名称
.user_status	int	用户状态：1=启用, 2=禁用
.access_token	str	认证凭证

返回：

字段	类型	说明
.status	bool	True=登录成功，False=登录失败

示例：

# 三种登录方式
result = client.account.login(username="myuser", password="pass123")
if result.status:
    print(f"登录成功: {result.username}")

client.account.login(username="13800138000", password="pass123")
client.account.login(username="user@example.com", password="pass123")

# 登录后自动认证，直接调账务接口
balance = client.account.get_balance()

Copy
2.5 查询余额
balance = client.account.get_balance()

Copy

输入： 无参数。

输出：Balance 对象

字段	类型	说明
.username	str	用户名
.phone	str	手机号
.balance_yuan	float	当前剩余额度（人民币元）
.used_yuan	float	历史消耗额度（人民币元）
.topup_yuan	float	历史充值额度（人民币元）
.request_count	int	总请求次数

返回：

字段	类型	说明
.status	bool	True=查询成功，False=查询失败

示例：

balance = client.account.get_balance()
if balance.status:
    print(f"当前余额: ¥{balance.balance_yuan}")
    print(f"历史消耗: ¥{balance.used_yuan}")
    print(f"历史充值: ¥{balance.topup_yuan}")

Copy
2.6 充值

支持两种充值方式：兑换码充值和在线支付。

前置条件： 充值前 SDK 会自动检查用户是否已绑定手机号（正式用户）。临时用户需先调用 bind_phone() 绑定手机号后才能充值，否则抛出 MoyuAIError 异常。

方式一：兑换码充值
result = client.account.topup(key="REDEEM_CODE_HERE")

Copy

输入：

参数	类型	必填	说明
key	str	是	兑换码

输出：TopupResult 对象

字段	类型	说明
.message	str	提示信息
.added_yuan	float	本次充值金额（单位：元）

返回：

字段	类型	说明
.status	bool	True=充值成功，False=充值失败

示例：

result = client.account.topup(key="ABC123")
if result.status:
    print(f"充值成功: +¥{result.added_yuan}")

# 临时用户充值会报错，需先绑定手机号
reg = client.account.temp_register()
client.account.bind_phone(phone="13800138000")
client.account.bind_phone(phone="13800138000", code="123456")
result = client.account.topup(key="ABC123")  # 绑定后可充值

Copy
方式二：在线支付（支付宝/微信）
record = client.account.online_topup(amount=10, payment_method="alipay", timeout=180, poll_interval=3)

Copy

调用后自动打开浏览器支付页面，等待用户完成支付，支付成功后返回充值记录。

输入：

参数	类型	必填	说明
amount	int	是	充值金额（元）
payment_method	str	是	支付方式：alipay（支付宝）或 wxpay（微信）
timeout	int	否	最长等待时间（秒），默认 180
poll_interval	int	否	轮询间隔（秒），默认 3

输出：TopUpRecord 对象

字段	类型	说明
.amount	int	充值金额（元）
.money	float	实际支付金额（元）
.trade_no	str	订单号
.payment_method	str	支付方式
.pay_status	str	支付状态：success=已完成, pending=待支付
.create_time	int	创建时间（Unix 时间戳）
.complete_time	int	完成时间

返回：

字段	类型	说明
.status	bool	True=调用成功，False=调用失败

超时未支付将抛出 MoyuAIError 异常，异常信息中包含订单号。

示例：

# 在线支付 10 元
record = client.account.online_topup(amount=10, payment_method="alipay")
if record.status:
    print(f"充值成功: {record.amount}元, 订单号: {record.trade_no}")

# 查询充值后余额
balance = client.account.get_balance()
print(f"当前余额: ¥{balance.balance_yuan}")

Copy
2.7 查询账单
bills = client.account.get_bills(
    model_name="gpt-4o",
    token_name="my-key",
    start_time=1710000000,
    end_time=1710086400,
    bill_type="consume"
)

Copy

默认查询今天 00:00:00 到当前时间的全部记录（消费+充值），无需传时间参数。返回最新记录，上限 500 条。

输入：

参数	类型	必填	说明
model_name	str	否	按模型名称过滤
token_name	str	否	按令牌名称过滤
start_time	int	否	开始时间（Unix 时间戳秒），默认今天 00:00:00
end_time	int	否	结束时间（Unix 时间戳秒），默认当前时间
bill_type	str	否	账单类型："consume"=消费，"topup"=充值，不传则返回全部

输出：BillResult 对象

字段	类型	说明
.total	int	时间范围内总记录数
.bills	list[BillRecord]	账单列表（最多 500 条）

每个 BillRecord 包含：

字段	类型	说明
.time	str	记录时间（2026-03-12 14:30:00 格式）
.model	str	使用的模型名称
.prompt_tokens	int	输入 token 数
.completion_tokens	int	输出 token 数
.cost_yuan	float	金额（人民币元）
.token_name	str	使用的令牌名称
.use_time_ms	int	请求耗时（毫秒）

返回：

字段	类型	说明
.status	bool	True=查询成功，False=查询失败

示例：

# 查询今日全部记录（消费+充值，默认）
bills = client.account.get_bills()
if bills.status:
    print(f"总记录: {bills.total}")
    print(f"金额: ¥{bills.bills[0].cost_yuan}")

# 只查询消费记录
bills = client.account.get_bills(bill_type="consume")

# 只查询充值记录
bills = client.account.get_bills(bill_type="topup")

# 按模型过滤
bills = client.account.get_bills(model_name="moonshot-v1-8k")

# 按令牌过滤
bills = client.account.get_bills(token_name="my-key")

# 指定时间范围（Unix 时间戳）
import time
bills = client.account.get_bills(
    start_time=int(time.time()) - 86400 * 7,  # 最近7天
    end_time=int(time.time())
)

Copy
2.8 查看令牌
result = client.account.get_tokens(page=1, page_size=10)

Copy

输入：

参数	类型	必填	说明
page	int	否	页码，默认 1
page_size	int	否	每页条数，默认 10

输出：TokensResult 对象

字段	类型	说明
.items	list[TokenInfo]	令牌列表

每个 TokenInfo 包含：

字段	类型	说明
.id	int	令牌 ID
.name	str	令牌名称
.key	str	API Key（sk-xxx 格式）
.token_status	int	令牌状态：1=启用, 2=禁用, 3=已过期, 4=额度耗尽
.remain_yuan	float	剩余额度（单位：元）
.used_yuan	float	已用额度（单位：元）
.unlimited_quota	bool	是否无限额度
.expired_time	int	过期时间（-1=永不过期）
.created_time	int	创建时间（Unix 时间戳）
.appid	int	绑定的智能体应用 ID（0表示未绑定）
.group	str	令牌所属分组（空字符串表示默认分组）

返回：

字段	类型	说明
.status	bool	True=查询成功，False=查询失败

示例：

result = client.account.get_tokens()
if result.status:
    for t in result.items:
        print(f"{t.name} | {t.key[:20]}... | 状态:{t.token_status} | 剩余:¥{t.remain_yuan} | 已用:¥{t.used_yuan}")

Copy
2.9 创建令牌
result = client.account.create_token(
    name="my-agent-key",
    remain_yuan=10,
    unlimited_quota=False,
    expired_time=-1,
    model_limits_enabled=False,
    model_limits="",
    appid=1,
    group="default"
)

Copy

输入：

参数	类型	必填	说明
name	str	是	令牌名称（最长 50 字符）
remain_yuan	float	否	令牌额度（单位：元，unlimited_quota=False 时生效）
unlimited_quota	bool	否	是否无限额度，默认 True
expired_time	int	否	过期时间（Unix 时间戳，-1=永不过期），默认 -1
model_limits_enabled	bool	否	是否启用模型限制，默认 False
model_limits	str	否	允许的模型列表（逗号分隔）
appid	int	否	智能体应用 ID
group	str	否	分组名称（不传则使用默认分组，可通过 get_groups() 查看可用分组）

输出：Result 对象

字段	类型	说明
.message	str	提示信息

返回：

字段	类型	说明
.status	bool	True=创建成功，False=创建失败

创建后通过 get_tokens() 获取新令牌的 key。

2.10 更新令牌
result = client.account.update_token(
    id=10,
    name="renamed-key",
    status=1,
    remain_yuan=10,
    unlimited_quota=False,
    expired_time=-1,
    model_limits_enabled=False,
    model_limits="gpt-4o,claude-opus-4-6",
    appid=2,
    group="vip"
)

Copy

输入：

参数	类型	必填	说明
id	int	是	令牌 ID
name	str	否	新名称
status	int	否	1=启用, 2=禁用
remain_yuan	float	否	令牌额度（单位：元）
unlimited_quota	bool	否	是否无限额度
expired_time	int	否	过期时间
model_limits_enabled	bool	否	是否启用模型限制
model_limits	str	否	允许的模型列表
appid	int	否	智能体应用 ID（传0可清除绑定）
group	str	否	分组名称（传空字符串可清除分组回到默认）

注意：输入参数中的 status 是传给服务端的令牌启用/禁用状态（int），与返回值中的 .status（bool，表示调用是否成功）含义不同。

输出：UpdateTokenResult 对象

字段	类型	说明
.data	dict	更新后的完整令牌信息

返回：

字段	类型	说明
.status	bool	True=更新成功，False=更新失败

示例：

result = client.account.update_token(id=10, name="renamed-key", appid=2)
if result.status:
    print(f"更新后 appid: {result.data.get('appid')}")

Copy
2.11 删除令牌
result = client.account.delete_token(id=10)

Copy

输入：

参数	类型	必填	说明
id	int	是	令牌 ID

输出：Result 对象

字段	类型	说明
.message	str	提示信息

返回：

字段	类型	说明
.status	bool	True=删除成功，False=删除失败

示例：

result = client.account.delete_token(id=10)
if result.status:
    print("删除成功")

Copy
2.12 查看可用分组
result = client.account.get_groups()

Copy

输入： 无

输出：GroupsResult 对象

字段	类型	说明
.items	list[GroupInfo]	分组列表

每个 GroupInfo 包含：

字段	类型	说明
.name	str	分组名称（创建/更新令牌时传入的 group 参数值）
.ratio	any	分组倍率（数字或 "自动"）
.desc	str	分组描述

返回：

字段	类型	说明
.status	bool	True=查询成功，False=查询失败

示例：

result = client.account.get_groups()
if result.status:
    for g in result.items:
        print(f"分组: {g.name} | 倍率: {g.ratio} | 描述: {g.desc}")

# 创建令牌时指定分组
client.account.create_token(name="vip-key", group="vip")

Copy
3. 使用模型

认证方式：请求头 Authorization: Bearer <api_key>（api_key 通过 temp_register() 或 get_tokens().items 获取）。
基础地址：https://www.moyu.info

3.1 获取模型列表
result = client.account.get_models(api_key="sk-xxxx")

Copy

输入：

参数	类型	必填	说明
api_key	str	是	API Key（sk-xxx 格式）

输出：ModelsResult 对象

字段	类型	说明
.items	list[ModelInfo]	模型列表

每个 ModelInfo 包含：

字段	类型	说明
.id	str	模型名称（如 claude-opus-4-6）
.object	str	类型（固定为 model）
.owned_by	str	供应商（如 vertex-ai、openai、deepseek）
.raw	dict	API 原始返回的完整字段（预留，后续新增字段可直接从此取）

返回：

字段	类型	说明
.status	bool	True=查询成功，False=查询失败

示例：

reg = client.account.temp_register()
result = client.account.get_models(api_key=reg.api_key)
if result.status:
    for m in result.items:
        print(f"{m.id} | {m.owned_by}")
    # → claude-opus-4-6 | custom
    # → deepseek-v3 | coze
    # → chatgpt-4o-latest | openai

    # 通过 raw 访问 API 返回的任意字段（无需等 SDK 更新）
    print(result.items[0].raw)

Copy
3.2 文本对话
POST /v1/chat/completions

Copy

兼容 OpenAI Chat Completions 格式，支持所有文本模型。

Python 示例：

import requests

api_key = "sk-xxxx"  # 你的 API Key

# 单轮对话
response = requests.post(
    "https://www.moyu.info/v1/chat/completions",
    headers={"Authorization": f"Bearer {api_key}"},
    json={
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "你好"}]
    }
)
data = response.json()
print(data["choices"][0]["message"]["content"])

# 多轮对话（携带历史消息）
response = requests.post(
    "https://www.moyu.info/v1/chat/completions",
    headers={"Authorization": f"Bearer {api_key}"},
    json={
        "model": "gpt-4o",
        "messages": [
            {"role": "system", "content": "你是一个助手"},
            {"role": "user", "content": "什么是机器学习？"},
            {"role": "assistant", "content": "机器学习是人工智能的一个分支..."},
            {"role": "user", "content": "有哪些常见算法？"}
        ]
    }
)

# 流式输出
response = requests.post(
    "https://www.moyu.info/v1/chat/completions",
    headers={"Authorization": f"Bearer {api_key}"},
    json={
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "写一首诗"}],
        "stream": True
    },
    stream=True
)
for line in response.iter_lines():
    if line:
        print(line.decode("utf-8"))

Copy

主要参数：

参数	类型	必填	说明
model	string	是	模型名称，如 gpt-4o、claude-opus-4-6、deepseek-v3 等
messages	array	是	对话消息列表，每条包含 role（system/user/assistant）和 content
stream	bool	否	是否流式输出，默认 false
temperature	number	否	采样温度 0-2，默认 1
max_tokens	int	否	最大生成 token 数

响应格式：

{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "model": "gpt-4o",
  "choices": [{
    "index": 0,
    "message": {"role": "assistant", "content": "你好！有什么可以帮你的？"},
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 9,
    "completion_tokens": 12,
    "total_tokens": 21
  }
}

Copy
3.3 图片生成
POST /v1/images/generations

Copy

使用豆包 Seedream 模型生成图片。

Python 示例：

import requests

api_key = "sk-xxxx"

response = requests.post(
    "https://www.moyu.info/v1/images/generations",
    headers={"Authorization": f"Bearer {api_key}"},
    json={
        "model": "doubao-seedream-4-5-251128",
        "prompt": "星际穿越，黑洞，电影大片，超现实主义，极致的光影",
        "size": "2K",
        "response_format": "url"
    }
)
data = response.json()
print(data["data"][0]["url"])  # 图片下载地址

Copy

主要参数：

参数	类型	必填	说明
model	string	是	固定为 doubao-seedream-4-5-251128
prompt	string	是	图片描述提示词
size	string	否	图片尺寸，如 2K、2048x2048、2848x1600，默认 2K
quality	string	否	standard(标准) 或 hd(高清)，默认 standard
response_format	string	否	url(返回链接) 或 b64_json(返回 Base64)

响应格式：

{
  "model": "doubao-seedream-4-5-251128",
  "created": 1770558368,
  "data": [
    {"url": "https://...", "size": "2048x2048"}
  ],
  "usage": {
    "generated_images": 1,
    "output_tokens": 16384,
    "total_tokens": 16384
  }
}

Copy
3.4 视频生成

视频生成为异步接口，提交任务后通过轮询获取结果。

视频生成
POST /v1/video/generations

Copy

Python 示例（文生视频）：

import requests
import time

api_key = "sk-xxxx"

# 提交视频生成任务
response = requests.post(
    "https://www.moyu.info/v1/video/generations",
    headers={"Authorization": f"Bearer {api_key}"},
    json={
        "model": "doubao-seedance-1-5-pro-251215",
        "prompt": "一只橘色的猫咪在阳光下的花园里追逐蝴蝶",
        "duration": 5
    }
)
task_id = response.json()["task_id"]
print(f"任务已提交: {task_id}")

# 轮询查询结果
while True:
    result = requests.get(
        f"https://www.moyu.info/v1/video/generations/{task_id}",
        headers={"Authorization": f"Bearer {api_key}"}
    ).json()
    print(f"状态: {result}")
    # 根据返回状态判断是否完成，完成后 break
    time.sleep(5)

Copy

图生视频示例：

response = requests.post(
    "https://www.moyu.info/v1/video/generations",
    headers={"Authorization": f"Bearer {api_key}"},
    json={
        "model": "doubao-seedance-1-5-lite-i2v-250428",
        "prompt": "让画面中的人物缓缓转头微笑",
        "images": ["https://example.com/image.jpg"],
        "duration": 5
    }
)

Copy

提交任务参数：

参数	类型	必填	说明
model	string	是	模型名称，见下方列表
prompt	string	是	视频内容描述
images	string[]	图生视频时必填	输入图片 URL 数组
duration	int	否	视频时长（秒），默认 5

支持的模型：

模型名称	说明
doubao-seedance-1-5-pro-251215	Seedance 1.5 Pro（推荐）
doubao-seedance-1-5-lite-t2v-250428	Seedance 1.5 Lite 文生视频
doubao-seedance-1-5-lite-i2v-250428	Seedance 1.5 Lite 图生视频
doubao-seedance-1-0-pro-250528	Seedance 1.0 Pro
doubao-seedance-1-0-lite-t2v	Seedance 1.0 Lite 文生视频
doubao-seedance-1-0-lite-i2v	Seedance 1.0 Lite 图生视频

提交任务响应：

{"task_id": "cgt-20260211145453-2v7p2"}

Copy
查询结果
GET /v1/video/generations/{task_id}

Copy

使用提交任务返回的 task_id 轮询查询，直到视频生成完成。

异常说明

所有函数在失败时抛出异常，可统一捕获处理：

异常类	触发条件
MoyuAIError	基础异常（所有异常的父类）
AuthenticationError	认证失败（API Key 无效、未登录）
RateLimitError	请求频率超限
InsufficientQuotaError	额度不足
APIError	其他 API 错误
from moyuai import MoyuAI, AuthenticationError, MoyuAIError

client = MoyuAI()
try:
    result = client.account.temp_register()
    if result.status:
        balance = client.account.get_balance()
except AuthenticationError as e:
    print(f"认证失败: {e}")
except MoyuAIError as e:
    print(f"操作失败: {e}")

Copy
---
## SDK 完整示例

SDK 完整示例

本文档基于 test_sdk.py 整理，展示 MoyuAI Python SDK 的完整用法。
运行前请确保 moyuai/ 目录与脚本在同级目录下。

环境准备
pip install requests

Copy
1. 初始化与认证

SDK 支持三种认证方式，优先级从高到低：密码登录 → 已有 Token → 临时注册。

from moyuai import MoyuAI

client = MoyuAI()  # 无需传参，域名已内置

Copy
1.1 密码登录
result = client.account.login(username="your_username", password="your_password")
print(f"登录成功: {result.username} (ID:{result.user_id})")
print(f"access_token: {result.access_token}")

# 登录后获取已有令牌用于对话
result = client.account.get_tokens()
if result.items:
    api_key = "sk-" + result.items[0].key if not result.items[0].key.startswith("sk-") else result.items[0].key
    print(f"使用已有令牌: {result.items[0].name}")

Copy
1.2 使用已有 Access Token
client.account.set_access_token("your_access_token")

Copy
1.3 临时注册（推荐快速测试）
reg = client.account.temp_register()
api_key = reg.api_key

print(f"用户ID:       {reg.user_id}")
print(f"用户名:       {reg.username}")
print(f"密码:         {reg.password}")
print(f"access_token: {reg.access_token}")
print(f"api_key:      {reg.api_key}")

Copy
2. 查询余额
balance = client.account.get_balance()

print(f"用户名:   {balance.username}")
print(f"余额:     ¥{balance.balance_yuan}")
print(f"请求次数: {balance.request_count}")

Copy
3. 令牌管理
3.1 查看令牌列表
result = client.account.get_tokens()
for t in result.items:
    status_map = {1: "启用", 2: "禁用", 3: "已过期", 4: "额度耗尽"}
    quota_str = "无限" if t.unlimited_quota else f"剩余:¥{t.remain_yuan}"
    print(f"ID:{t.id} | {t.name} | {t.key[:20]}... | {status_map.get(t.token_status, '未知')} | {quota_str} | 已用:¥{t.used_yuan}")

Copy
3.2 创建新令牌
# 创建无限额度、永不过期的令牌
client.account.create_token(name="test-sdk-key", unlimited_quota=True, expired_time=-1)

# 创建限额令牌（10元）
client.account.create_token(name="test-sdk-key-10yuan", remain_yuan=10, unlimited_quota=False, expired_time=-1)

Copy
3.3 删除令牌
result = client.account.get_tokens()
for t in result.items:
    if t.name in ("test-sdk-key", "test-sdk-key-10yuan"):
        client.account.delete_token(id=t.id)
        print(f"已删除令牌: {t.name} (ID:{t.id})")

Copy
4. 临时用户转正式用户（绑定手机号）

绑定手机号分两步：先发送验证码，再提交验证码完成绑定。

phone = "13800138000"

# 发送验证码
result = client.account.bind_phone(phone=phone)
print(f"发送验证码: status={result.status}, message={result.message}")

# 提交验证码完成绑定
code = "123456"  # 替换为真实验证码
result = client.account.bind_phone(phone=phone, code=code)
print(f"绑定结果: status={result.status}")

Copy
5. 查询账单
bills = client.account.get_bills()
print(f"今日共 {bills.total} 条记录")

for bill in bills.bills[:5]:
    print(f"{bill.time} | {bill.model} | 输入:{bill.prompt_tokens} 输出:{bill.completion_tokens} | ¥{bill.cost_yuan}")

Copy
6. 获取模型列表
result = client.account.get_models(api_key=api_key)
print(f"可用模型数: {len(result.items)}")

for m in result.items[:10]:
    print(f"{m.id} | {m.object} | {m.owned_by}")

if len(result.items) > 10:
    print(f"... 共 {len(result.items)} 个模型")

Copy
7. 充值功能
7.1 兑换码充值
result = client.account.topup(key="your_redeem_code")
print(f"充值成功: +¥{result.added_yuan}")

Copy
7.2 在线支付
# 打开浏览器支付页面，等待支付完成后自动返回结果
record = client.account.online_topup(amount=10, payment_method="alipay")
print(f"充值成功!")
print(f"  订单号:   {record.trade_no}")
print(f"  金额:     {record.amount} 元")
print(f"  实付:     {record.money} 元")
print(f"  支付方式: {record.payment_method}")
print(f"  状态:     {record.pay_status}")

# 查询充值后余额
balance = client.account.get_balance()
print(f"当前余额: {balance.balance_yuan} 元")

Copy
8. 智能体应用
8.1 获取智能体列表
result = client.account.get_app_agents()
print(f"智能体数量: {len(result.items)}")

for a in result.items:
    print(f"appid={a.appid}, name={a.name}, billing_type={a.billing_type}, agent_status={a.agent_status}")

Copy
8.2 临时注册绑定智能体
# 临时注册时传入 appid，自动绑定到默认令牌
client2 = MoyuAI()
reg = client2.account.temp_register(appid=1)
print(f"用户: {reg.username}, api_key: {reg.api_key[:25]}...")

# 验证令牌是否绑定成功
result = client2.account.get_tokens()
if result.items:
    print(f"默认令牌 appid: {result.items[0].appid}")

Copy
8.3 创建令牌绑定智能体
# 创建令牌时指定 appid（无限额度、永不过期）
client.account.create_token(name="test-agent-token", unlimited_quota=True, expired_time=-1, appid=1)

# 查看创建结果
result = client.account.get_tokens(page=1, page_size=5)
for t in result.items:
    if t.name == "test-agent-token":
        print(f"创建成功: id={t.id}, appid={t.appid}")
        break

Copy
8.4 更新令牌的智能体绑定
# 将令牌绑定到另一个智能体
updated = client.account.update_token(id=token_id, appid=2)
print(f"更新后 appid: {updated.data.get('appid', 0)}")

# 清除绑定（传0）
updated = client.account.update_token(id=token_id, appid=0)

Copy
8.5 清理测试令牌
client.account.delete_token(id=token_id)
print(f"已删除 test-agent-token (id={token_id})")

Copy
完整测试脚本

以下是可直接运行的完整脚本，通过 TEST 字典控制各功能的测试开关：

"""
MoyuAI SDK 测试脚本
使用前请将 moyuai/ 目录放到本脚本同级目录下

运行方式：
    pip install requests
    python test_sdk.py
"""

import time
from moyuai import MoyuAI

# ============================================================
# 配置区
# ============================================================
BASE_URL = ""   # 留空则使用 SDK 内置默认地址 https://www.moyu.info

# 认证方式（三选一，优先级从上到下）
LOGIN_USERNAME = ""            # 用户名/手机号/邮箱，填了就用密码登录
LOGIN_PASSWORD = ""            # 密码
ACCESS_TOKEN   = ""            # 已有的 access_token，填了就直接用
USE_TEMP_REGISTER = True       # 以上都没填时，自动临时注册

# 测试开关：True=执行，False=跳过
TEST = {
    "查询余额":       False,
    "查看令牌":       False,
    "创建令牌":       False,
    "绑定手机号":     False,   # 需要真实手机号和验证码
    "查询账单":       False,
    "获取模型列表":   False,
    "充值配置":       False,
    "兑换码充值":     False,   # 需要真实兑换码
    "在线支付":       False,   # 会弹出浏览器支付页面
    "删除测试令牌":   False,
    "智能体应用":     True,    # 获取智能体列表 + 临时注册绑定 + 令牌绑定
}

api_key = None

# ============================================================
# 1. 初始化 + 认证
# ============================================================
print("=" * 60)
print("1. 初始化 + 认证")
print("=" * 60)
client = MoyuAI(base_url=BASE_URL) if BASE_URL else MoyuAI()

if LOGIN_USERNAME and LOGIN_PASSWORD:
    result = client.account.login(username=LOGIN_USERNAME, password=LOGIN_PASSWORD)
    print(f"  登录成功: {result.username} (ID:{result.user_id})")
    print(f"  access_token: {result.access_token}")
    result = client.account.get_tokens()
    if result.items:
        api_key = "sk-" + result.items[0].key if not result.items[0].key.startswith("sk-") else result.items[0].key
        print(f"  使用已有令牌: {result.items[0].name}")
elif ACCESS_TOKEN:
    client.account.set_access_token(ACCESS_TOKEN)
    print(f"  使用已有 access_token: {ACCESS_TOKEN[:20]}...")
elif USE_TEMP_REGISTER:
    reg = client.account.temp_register()
    api_key = reg.api_key
    print(f"  临时注册成功:")
    print(f"    用户ID:       {reg.user_id}")
    print(f"    用户名:       {reg.username}")
    print(f"    密码:         {reg.password}")
    print(f"    access_token: {reg.access_token}")
    print(f"    api_key:      {reg.api_key}")
else:
    print("  [警告] 未配置任何认证方式，账务接口将无法使用")
print()

# ============================================================
# 2. 查询余额
# ============================================================
if TEST["查询余额"]:
    print("=" * 60)
    print("2. 查询余额")
    print("=" * 60)
    balance = client.account.get_balance()
    print(f"  用户名:   {balance.username}")
    print(f"  余额:     ¥{balance.balance_yuan}")
    print(f"  请求次数: {balance.request_count}")
    print()
else:
    print("[跳过] 2. 查询余额\n")

# ============================================================
# 3. 查看令牌列表
# ============================================================
if TEST["查看令牌"]:
    print("=" * 60)
    print("3. 查看令牌列表")
    print("=" * 60)
    tokens_result = client.account.get_tokens()
    for t in tokens_result.items:
        status_map = {1: "启用", 2: "禁用", 3: "已过期", 4: "额度耗尽"}
        quota_str = "无限" if t.unlimited_quota else f"剩余:¥{t.remain_yuan}"
        print(f"  ID:{t.id} | {t.name} | {t.key[:20]}... | {status_map.get(t.token_status, '未知')} | {quota_str} | 已用:¥{t.used_yuan}")
    print()
else:
    print("[跳过] 3. 查看令牌列表\n")

# ============================================================
# 4. 创建新令牌
# ============================================================
if TEST["创建令牌"]:
    print("=" * 60)
    print("4. 创建新令牌")
    print("=" * 60)
    # 4a. 创建无限额度令牌
    client.account.create_token(name="test-sdk-key", unlimited_quota=True, expired_time=-1)
    print("  [4a] 无限额度令牌创建成功")
    # 4b. 创建限额令牌（10元）
    client.account.create_token(name="test-sdk-key-10yuan", remain_yuan=10, unlimited_quota=False, expired_time=-1)
    print("  [4b] 限额令牌创建成功（额度: 10元）")
    # 查看列表验证
    print("  再次查看列表：")
    tokens_result = client.account.get_tokens()
    for t in tokens_result.items:
        quota_str = "无限" if t.unlimited_quota else f"¥{t.remain_yuan}"
        print(f"  ID:{t.id} | {t.name} | {t.key[:20]}... | 额度:{quota_str} | 已用:¥{t.used_yuan}")
    print()
else:
    print("[跳过] 4. 创建新令牌\n")

# ============================================================
# 5. 绑定手机号（临时用户转正式用户）
# ============================================================
if TEST["绑定手机号"]:
    print("=" * 60)
    print("5. 绑定手机号")
    print("=" * 60)
    phone = input("  请输入手机号: ").strip()
    try:
        result = client.account.bind_phone(phone=phone)
        print(f"  发送验证码: status={result.status}, message={result.message}")
        code = input("  请输入收到的验证码: ").strip()
        result = client.account.bind_phone(phone=phone, code=code)
        print(f"  绑定结果: status={result.status}")
    except Exception as e:
        print(f"  绑定失败: {e}")
    print()
else:
    print("[跳过] 5. 绑定手机号\n")

# ============================================================
# 6. 查询账单
# ============================================================
if TEST["查询账单"]:
    print("=" * 60)
    print("6. 查询账单")
    print("=" * 60)
    bills = client.account.get_bills()
    print(f"  今日共 {bills.total} 条记录")
    for bill in bills.bills[:5]:
        print(f"  {bill.time} | {bill.model} | 输入:{bill.prompt_tokens} 输出:{bill.completion_tokens} | ¥{bill.cost_yuan}")
    print()
else:
    print("[跳过] 6. 查询账单\n")

# ============================================================
# 7. 获取模型列表
# ============================================================
if TEST["获取模型列表"]:
    print("=" * 60)
    print("7. 获取模型列表")
    print("=" * 60)
    if api_key:
        models_result = client.account.get_models(api_key=api_key)
        print(f"  可用模型数: {len(models_result.items)}")
        for m in models_result.items[:10]:
            print(f"  {m.id} | {m.object} | {m.owned_by}")
        if len(models_result.items) > 10:
            print(f"  ... 共 {len(models_result.items)} 个模型")
    else:
        print("  [需要 api_key，请通过临时注册或登录后获取令牌]")
    print()
else:
    print("[跳过] 7. 获取模型列表\n")

# ============================================================
# 8. 兑换码充值
# ============================================================
if TEST["兑换码充值"]:
    print("=" * 60)
    print("8. 兑换码充值")
    print("=" * 60)
    code = input("  请输入兑换码: ").strip()
    try:
        result = client.account.topup(key=code)
        print(f"  充值成功: +¥{result.added_yuan}")
    except Exception as e:
        print(f"  充值失败: {e}")
    print()
else:
    print("[跳过] 8. 兑换码充值\n")

# ============================================================
# 9. 在线支付
# ============================================================
if TEST["在线支付"]:
    print("=" * 60)
    print("9. 在线支付")
    print("=" * 60)
    try:
        amount = int(input("  请输入充值金额(元): ").strip())
        method = input("  请输入支付方式(alipay/wxpay): ").strip()

        print("  已打开支付页面，等待支付...")
        record = client.account.online_topup(amount=amount, payment_method=method)
        print(f"  充值成功!")
        print(f"    订单号:   {record.trade_no}")
        print(f"    金额:     {record.amount} 元")
        print(f"    实付:     {record.money} 元")
        print(f"    支付方式: {record.payment_method}")
        print(f"    状态:     {record.pay_status}")

        balance = client.account.get_balance()
        print(f"  当前余额: {balance.balance_yuan} 元")
    except Exception as e:
        print(f"  支付失败: {e}")
    print()
else:
    print("[跳过] 9. 在线支付\n")

# ============================================================
# 10. 删除测试令牌
# ============================================================
if TEST["删除测试令牌"]:
    print("=" * 60)
    print("10. 删除测试令牌")
    print("=" * 60)
    tokens_result = client.account.get_tokens()
    for t in tokens_result.items:
        if t.name in ("test-sdk-key", "test-sdk-key-10yuan"):
            client.account.delete_token(id=t.id)
            print(f"  已删除令牌: {t.name} (ID:{t.id})")
    print()
else:
    print("[跳过] 10. 删除测试令牌\n")

# ============================================================
# 11. 智能体应用（获取列表 + 临时注册绑定 + 令牌绑定）
# ============================================================
if TEST["智能体应用"]:
    print("=" * 60)
    print("11. 智能体应用")
    print("=" * 60)

    # 11.1 获取智能体列表
    print("  [11.1] 获取智能体应用列表")
    agents_result = client.account.get_app_agents()
    print(f"  智能体数量: {len(agents_result.items)}")
    for a in agents_result.items:
        print(f"    appid={a.appid}, name={a.name}, billing_type={a.billing_type}, agent_status={a.agent_status}")

    if agents_result.items:
        test_appid = agents_result.items[0].appid
        print(f"\n  使用 appid={test_appid} 进行后续测试")

        # 11.2 临时注册绑定 appid
        print("\n  [11.2] 临时注册（绑定 appid）")
        client2 = MoyuAI(base_url=BASE_URL) if BASE_URL else MoyuAI()
        reg = client2.account.temp_register(appid=test_appid)
        print(f"    用户: {reg.username}, api_key: {reg.api_key[:25]}...")
        tokens2_result = client2.account.get_tokens()
        if tokens2_result.items:
            print(f"    默认令牌 appid: {tokens2_result.items[0].appid}")
            if tokens2_result.items[0].appid == test_appid:
                print("    >>> 临时注册绑定 appid 成功")
            else:
                print("    >>> 临时注册绑定 appid 失败!")

        # 11.3 创建令牌带 appid
        print("\n  [11.3] 创建令牌（带 appid）")
        client.account.create_token(name="test-agent-token", unlimited_quota=True, expired_time=-1, appid=test_appid)
        tokens3_result = client.account.get_tokens(page=1, page_size=5)
        target = None
        for t in tokens3_result.items:
            if t.name == "test-agent-token":
                target = t
                break
        if target:
            print(f"    创建成功: id={target.id}, appid={target.appid}")
            if target.appid == test_appid:
                print("    >>> 创建令牌带 appid 成功")
            else:
                print("    >>> 创建令牌带 appid 失败!")

            # 11.4 更新令牌 appid
            second_appid = agents_result.items[1].appid if len(agents_result.items) > 1 else 0
            print(f"\n  [11.4] 更新令牌 appid -> {second_appid}")
            updated = client.account.update_token(id=target.id, appid=second_appid)
            print(f"    更新后 appid: {updated.data.get('appid', 0)}")

            # 11.5 清理
            print("\n  [11.5] 清理测试令牌")
            client.account.delete_token(id=target.id)
            print(f"    已删除 test-agent-token (id={target.id})")
    else:
        print("  无智能体数据，跳过绑定测试")
    print()
else:
    print("[跳过] 11. 智能体应用\n")

print("=" * 60)
print("全部测试完成！")
print("=" * 60)

Copy
---


# 三、Seedance2 文档

## Doubao Seedance2

豆包 Seedance 2.0 视频生成接口

豆包 Seedance 2.0 系列视频生成接口文档。

支持的模型
模型名称	说明
doubao-seedance-2-0-260128	Seedance 2.0 标准版，画质更优，生成较慢（约5-8分钟）
doubao-seedance-2-0-fast-260128	Seedance 2.0 快速版，速度更快（约3-4分钟），画质略低
接口地址
提交任务
POST {BASE_URL}/v1/video/generations

Copy
查询结果
GET {BASE_URL}/v1/video/generations/{task_id}

Copy
请求参数
顶级参数
参数	类型	必填	说明
model	string	是	模型名称：doubao-seedance-2-0-260128 或 doubao-seedance-2-0-fast-260128
prompt	string	是	文本提示词（平台校验要求非空，实际提示词通过 metadata.content 传递）
metadata	object	是	扩展参数对象，包含所有 Seedance 2.0 参数
metadata 参数
参数	类型	必填	说明	默认值
content	object[]	是	输入给模型的内容数组，详见下方 content 参数说明	-
generate_audio	boolean	否	控制生成的视频是否包含与画面同步的声音	true
resolution	string	否	视频分辨率	"720p"
ratio	string	否	视频宽高比	"adaptive"
duration	integer	否	视频时长（秒）	5
tools	object[]	否	配置模型要调用的工具	-

注意：prompt 字段必须非空（平台校验要求），但实际发送给上游的提示词来自 metadata.content 中的文本内容。如果未传 metadata.content，平台会自动将 prompt 转换为 content 数组。

content 参数详细说明

metadata.content 为对象数组，输入给模型生成视频的信息，支持文本、图片、音频、视频。支持以下几种组合：

文本
文本（可选）+ 图片
文本（可选）+ 视频
文本（可选）+ 图片 + 音频
文本（可选）+ 图片 + 视频
文本（可选）+ 视频 + 音频
文本（可选）+ 图片 + 视频 + 音频
文本信息

输入给模型的提示词信息。

字段	类型	必填	说明
type	string	是	固定为 "text"
text	string	是	文本提示词，描述期望生成的视频。支持中英文。建议中文不超过 500 字，英文不超过 1000 词。字数过多信息容易分散，模型可能忽略细节，造成视频缺失部分元素。

示例：

{"type": "text", "text": "清晨的海边，金色阳光照耀在海面上，一只海豚跃出水面，水花四溅"}

Copy
图片信息

输入给模型的图片信息。

字段	类型	必填	说明
type	string	是	固定为 "image_url"
image_url	object	是	图片对象
image_url.url	string	是	图片 URL、Base64 编码或素材 ID（见下方说明）
role	string	条件必填	图片的位置或用途（见下方说明）

image_url.url 支持的格式：

图片 URL：填入图片的公网 URL
Base64 编码：格式 data:image/<图片格式>;base64,<Base64编码>，如 data:image/png;base64,{base64_image}
素材 ID：格式 asset://<ASSET_ID>

传入单张图片要求：

格式：jpeg、png、webp、bmp、tiff、gif
宽高比（宽/高）：(0.4, 2.5)
宽高长度（px）：(300, 6000)
大小：单张图片小于 30 MB，请求体大小不超过 64 MB。大文件请勿使用 Base64 编码
图片数量：
图生视频-首帧：1 张
图生视频-首尾帧：2 张
多模态参考生视频：1~9 张

role 取值说明：

图生视频-首帧、图生视频-首尾帧、多模态参考生视频为 3 种互斥场景，不可混用。

场景	图片数量	role 取值	说明
图生视频-首帧	1 张	first_frame 或不填	以该图片作为视频首帧
图生视频-首尾帧	2 张	首帧：first_frame（必填），尾帧：last_frame（必填）	指定视频的首帧和尾帧图片
多模态参考生视频	1~9 张	reference_image（必填）	作为参考图片生成视频

示例（首帧图生视频）：

{"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}, "role": "first_frame"}

Copy

示例（参考图）：

{"type": "image_url", "image_url": {"url": "https://example.com/ref.jpg"}, "role": "reference_image"}

Copy
视频信息

输入给模型的视频信息。仅 Seedance 2.0 & 2.0 fast 支持。

支持使用本账号下 Seedance 2.0 & 2.0 fast 模型产出的视频作为输入素材，进行视频编辑或延长，其中的真人人脸可正常使用，不会触发审核拦截。

字段	类型	必填	说明
type	string	是	固定为 "video_url"
video_url	object	是	视频对象
video_url.url	string	是	视频 URL 或素材 ID（格式 asset://<ASSET_ID>）
role	string	条件必填	当前仅支持 "reference_video"

传入视频要求：

格式：mp4、mov
分辨率：480p、720p
时长：单个视频 [2, 15] 秒，最多传入 3 个参考视频，所有视频总时长不超过 15s
宽高比（宽/高）：[0.4, 2.5]
宽高长度（px）：[300, 6000]
画面像素（宽 × 高）：[409600, 927408]
示例：640×640=409600（最小值），834×1112=927408（最大值）
大小：单个视频不超过 50 MB
帧率 (FPS)：[24, 60]

示例：

{"type": "video_url", "video_url": {"url": "https://example.com/video.mp4"}, "role": "reference_video"}

Copy
音频信息

输入给模型的音频信息。仅 Seedance 2.0 & 2.0 fast 支持。

不可单独输入音频，应至少包含 1 个参考视频或图片。

字段	类型	必填	说明
type	string	是	固定为 "audio_url"
audio_url	object	是	音频对象
audio_url.url	string	是	音频 URL、Base64 编码或素材 ID
role	string	条件必填	当前仅支持 "reference_audio"

audio_url.url 支持的格式：

音频 URL：填入音频的公网 URL
Base64 编码：格式 data:audio/<音频格式>;base64,<Base64编码>，如 data:audio/wav;base64,{base64_audio}
素材 ID：格式 asset://<ASSET_ID>

传入音频要求：

格式：wav、mp3
时长：单个音频 [2, 15] 秒，最多传入 3 段参考音频，所有音频总时长不超过 15s
大小：单个音频不超过 15 MB，请求体大小不超过 64 MB。大文件请勿使用 Base64 编码

示例：

{"type": "audio_url", "audio_url": {"url": "https://example.com/audio.wav"}, "role": "reference_audio"}

Copy
其他参数详细说明
generate_audio
取值	说明
true（默认）	模型输出的视频包含同步音频。模型会基于文本提示词与视觉内容，自动生成与之匹配的人声、音效及背景音乐。建议将对话部分置于双引号内，以优化音频生成效果。例如：男人叫住女人说："你记住，以后不可以用手指指月亮。"
false	模型输出的视频为无声视频

生成的有声视频均为单声道，和传入的音频声道数无关。

resolution

视频分辨率，默认值 "720p"。

取值	说明
"480p"	低分辨率，生成速度较快
"720p"	高分辨率，画质更好
ratio

视频宽高比，默认值 "adaptive"。

取值	说明
"16:9"	横屏宽幅
"4:3"	横屏标准
"1:1"	正方形
"3:4"	竖屏标准
"9:16"	竖屏全屏
"21:9"	超宽屏 / 电影比例
"adaptive"	根据输入自动选择最合适的宽高比

adaptive 适配规则：

文生视频：根据提示词智能选择最合适的宽高比
首帧/首尾帧生视频：根据上传的首帧图片比例，自动选择最接近的宽高比
多模态参考生视频：根据用户提示词意图判断，以传入的第一个媒体文件为准（优先级：视频 > 图片）选择最接近的宽高比

不同宽高比对应的宽高像素值：

分辨率	宽高比	宽高像素值
480p	16:9	864×496
480p	4:3	752×560
480p	1:1	640×640
480p	3:4	560×752
480p	9:16	496×864
480p	21:9	992×432
720p	16:9	1280×720
720p	4:3	1112×834
720p	1:1	960×960
720p	3:4	834×1112
720p	9:16	720×1280
720p	21:9	1470×630
duration

视频时长（秒），默认值 5，仅支持整数。

取值	说明
4 ~ 15	指定具体时长，支持有效范围内的任一整数
-1	智能指定，由模型在有效范围内自主选择合适的视频长度。实际时长可通过查询 API 返回的 duration 字段获取。注意视频时长与计费相关，请谨慎设置
tools

配置模型要调用的工具。仅 Seedance 2.0 & 2.0 fast 支持。

字段	类型	说明
type	string	工具类型，当前支持 "web_search"（联网搜索，仅文生视频支持）

开启联网搜索后，模型会根据提示词自主判断是否搜索互联网内容（如商品、天气等）。可提升生成视频的时效性，但也会增加一定的时延。

示例：

"tools": [{"type": "web_search"}]

Copy
重要提示：关于提示词传递

在 Windows 命令行（cmd / PowerShell）中使用 curl 直接传递中文提示词可能出现编码问题，导致生成内容与提示词不符。

推荐做法：先将请求 JSON 写入 UTF-8 编码的文件，再使用 --data-binary @文件名 发送请求。

通过 Python、Java、前端应用等编程语言调用 API 不受此影响，因为这些语言默认使用 UTF-8 编码。

错误示例（Windows 下中文可能乱码）
# 不推荐：Windows 命令行直接传中文可能编码错误
curl -X POST "{BASE_URL}/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"doubao-seedance-2-0-260128","prompt":"海豚跃出水面",...}'

Copy
正确示例（使用文件方式）
# 推荐：先写入 UTF-8 文件，再用 --data-binary 发送
printf '{"model":"doubao-seedance-2-0-260128","prompt":"占位","metadata":{"content":[{"type":"text","text":"清晨的海边，金色阳光照耀在海面上，一只海豚跃出水面，水花四溅"}],"duration":8,"resolution":"480p","ratio":"9:16","generate_audio":true}}' > request.json

curl -X POST "{BASE_URL}/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @request.json

Copy
请求示例
cURL（推荐文件方式）
文生视频
printf '{"model":"doubao-seedance-2-0-260128","prompt":"果茶广告","metadata":{"content":[{"type":"text","text":"全程第一人称视角果茶宣传广告，你的手摘下一颗带晨露的红苹果，将苹果块投入雪克杯加入冰块与茶底用力摇晃，分层果茶倒入透明杯轻挤奶盖在顶部铺展，最后手持举杯到镜头前"}],"duration":8,"resolution":"480p","ratio":"9:16","generate_audio":true}}' > request.json

curl -X POST "{BASE_URL}/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @request.json

Copy
图生视频（首帧）
printf '{"model":"doubao-seedance-2-0-260128","prompt":"图生视频","metadata":{"content":[{"type":"text","text":"让画面中的猫咪缓缓走动，阳光洒落"},{"type":"image_url","image_url":{"url":"https://example.com/cat.jpg"},"role":"first_frame"}],"duration":5,"resolution":"720p","ratio":"adaptive"}}' > request.json

curl -X POST "{BASE_URL}/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @request.json

Copy
多模态参考生视频（图片+音频+文本）
printf '{"model":"doubao-seedance-2-0-260128","prompt":"多模态","metadata":{"content":[{"type":"text","text":"一个女孩在弹吉他唱歌"},{"type":"image_url","image_url":{"url":"https://example.com/girl.jpg"},"role":"reference_image"},{"type":"audio_url","audio_url":{"url":"https://example.com/song.mp3"},"role":"reference_audio"}],"duration":10,"resolution":"720p","ratio":"9:16","generate_audio":true}}' > request.json

curl -X POST "{BASE_URL}/v1/video/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @request.json

Copy
Python
import requests
import time

BASE_URL = "{BASE_URL}"
API_KEY = "YOUR_API_KEY"
headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# ========== 文生视频 ==========
payload = {
    "model": "doubao-seedance-2-0-260128",
    "prompt": "果茶广告",
    "metadata": {
        "content": [
            {
                "type": "text",
                "text": "全程第一人称视角果茶宣传广告，你的手摘下一颗带晨露的红苹果，"
                        "将苹果块投入雪克杯加入冰块与茶底用力摇晃，"
                        "分层果茶倒入透明杯轻挤奶盖在顶部铺展，最后手持举杯到镜头前"
            }
        ],
        "duration": 8,
        "resolution": "480p",
        "ratio": "9:16",
        "generate_audio": True
    }
}

response = requests.post(f"{BASE_URL}/v1/video/generations", headers=headers, json=payload)
result = response.json()
print(f"任务ID: {result['task_id']}")

# ========== 图生视频（首帧） ==========
payload_i2v = {
    "model": "doubao-seedance-2-0-260128",
    "prompt": "图生视频",
    "metadata": {
        "content": [
            {"type": "text", "text": "让画面中的猫咪缓缓走动，阳光洒落"},
            {"type": "image_url", "image_url": {"url": "https://example.com/cat.jpg"}, "role": "first_frame"}
        ],
        "duration": 5,
        "resolution": "720p",
        "ratio": "adaptive"
    }
}

# ========== 多模态参考（图片+视频+音频） ==========
payload_multi = {
    "model": "doubao-seedance-2-0-260128",
    "prompt": "多模态",
    "metadata": {
        "content": [
            {"type": "text", "text": "一个女孩在弹吉他唱歌，背景是夕阳海滩"},
            {"type": "image_url", "image_url": {"url": "https://example.com/girl.jpg"}, "role": "reference_image"},
            {"type": "video_url", "video_url": {"url": "https://example.com/ref.mp4"}, "role": "reference_video"},
            {"type": "audio_url", "audio_url": {"url": "https://example.com/song.mp3"}, "role": "reference_audio"}
        ],
        "duration": 10,
        "resolution": "720p",
        "ratio": "9:16",
        "generate_audio": True
    }
}

# ========== 轮询查询任务结果 ==========
task_id = result["task_id"]
while True:
    query_resp = requests.get(
        f"{BASE_URL}/v1/video/generations/{task_id}",
        headers={"Authorization": f"Bearer {API_KEY}"}
    )
    task_data = query_resp.json()
    status = task_data["data"]["status"]
    progress = task_data["data"]["progress"]
    print(f"状态: {status}, 进度: {progress}")

    if status == "SUCCESS":
        video_url = task_data["data"]["data"]["content"]["video_url"]
        print(f"视频地址: {video_url}")
        break
    elif status == "FAILURE":
        print(f"生成失败: {task_data['data']['fail_reason']}")
        break

    time.sleep(15)

Copy
Java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

public class SeedanceVideoGen {
    private static final String BASE_URL = "{BASE_URL}";
    private static final String API_KEY = "YOUR_API_KEY";

    public static void main(String[] args) throws Exception {
        HttpClient client = HttpClient.newHttpClient();

        // 文生视频
        String requestBody = """
            {
                "model": "doubao-seedance-2-0-260128",
                "prompt": "果茶广告",
                "metadata": {
                    "content": [
                        {
                            "type": "text",
                            "text": "全程第一人称视角果茶宣传广告，你的手摘下一颗带晨露的红苹果，将苹果块投入雪克杯加入冰块与茶底用力摇晃"
                        }
                    ],
                    "duration": 8,
                    "resolution": "480p",
                    "ratio": "9:16",
                    "generate_audio": true
                }
            }
            """;

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(BASE_URL + "/v1/video/generations"))
            .header("Authorization", "Bearer " + API_KEY)
            .header("Content-Type", "application/json; charset=utf-8")
            .POST(HttpRequest.BodyPublishers.ofString(requestBody, StandardCharsets.UTF_8))
            .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println("提交结果: " + response.body());

        // 图生视频（首帧）
        String i2vBody = """
            {
                "model": "doubao-seedance-2-0-260128",
                "prompt": "图生视频",
                "metadata": {
                    "content": [
                        {"type": "text", "text": "让画面中的猫咪缓缓走动，阳光洒落"},
                        {"type": "image_url", "image_url": {"url": "https://example.com/cat.jpg"}, "role": "first_frame"}
                    ],
                    "duration": 5,
                    "resolution": "720p",
                    "ratio": "adaptive"
                }
            }
            """;

        // 查询任务状态
        String taskId = "cgt-xxxxx"; // 替换为实际 task_id
        HttpRequest queryRequest = HttpRequest.newBuilder()
            .uri(URI.create(BASE_URL + "/v1/video/generations/" + taskId))
            .header("Authorization", "Bearer " + API_KEY)
            .GET()
            .build();

        HttpResponse<String> queryResponse = client.send(queryRequest, HttpResponse.BodyHandlers.ofString());
        System.out.println("查询结果: " + queryResponse.body());
    }
}

Copy
查询结果
查询请求
curl "{BASE_URL}/v1/video/generations/{task_id}" \
  -H "Authorization: Bearer YOUR_API_KEY"

Copy
查询响应示例
生成中
{
  "code": "success",
  "data": {
    "task_id": "cgt-20260326182734-68xp4",
    "status": "IN_PROGRESS",
    "progress": "30%",
    "data": {
      "model": "doubao-seedance-2-0-260128",
      "status": "running",
      "generate_audio": true
    }
  }
}

Copy
生成成功
{
  "code": "success",
  "data": {
    "task_id": "cgt-20260326182734-68xp4",
    "status": "SUCCESS",
    "progress": "100%",
    "data": {
      "model": "doubao-seedance-2-0-260128",
      "ratio": "9:16",
      "duration": 8,
      "resolution": "480p",
      "generate_audio": true,
      "framespersecond": 24,
      "content": {
        "video_url": "https://...mp4?..."
      },
      "usage": {
        "total_tokens": 80770,
        "completion_tokens": 80770
      }
    }
  }
}

Copy
生成失败
{
  "code": "success",
  "data": {
    "task_id": "cgt-xxxxx",
    "status": "FAILURE",
    "fail_reason": "task failed",
    "data": {
      "error": {
        "code": "OutputVideoSensitiveContentDetected",
        "message": "The request failed because the output video may contain sensitive information."
      }
    }
  }
}

Copy
任务状态说明
状态	说明
NOT_START	任务已提交，尚未开始
IN_PROGRESS	任务正在生成中
SUCCESS	生成成功，可获取视频 URL
FAILURE	生成失败，查看 fail_reason
取消任务

取消正在进行中的视频生成任务。取消后会自动全额退还预扣费额度，同时向上游 Volcengine API 发送取消请求以停止任务。

请求
DELETE {BASE_URL}/v1/videos/{task_id}

Copy
参数	位置	类型	必填	说明
task_id	URL 路径	string	是	提交任务时返回的任务 ID（如 cgt-20260423162600-9tzw4）
Authorization	Header	string	是	Bearer YOUR_API_KEY
cURL 示例
curl -X DELETE "{BASE_URL}/v1/videos/cgt-20260423162600-9tzw4" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY"

Copy
Python 示例
import requests

BASE_URL = "{BASE_URL}"
API_KEY = "YOUR_API_KEY"
task_id = "cgt-20260423162600-9tzw4"

response = requests.delete(
    f"{BASE_URL}/v1/videos/{task_id}",
    headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
)
print(response.json())

Copy
Java 示例
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class CancelVideoTask {
    public static void main(String[] args) throws Exception {
        String baseUrl = "{BASE_URL}";
        String apiKey = "YOUR_API_KEY";
        String taskId = "cgt-20260423162600-9tzw4";

        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + "/v1/videos/" + taskId))
            .header("Authorization", "Bearer " + apiKey)
            .header("Content-Type", "application/json")
            .DELETE()
            .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println("取消结果: " + response.body());
    }
}

Copy
响应示例
取消成功
{
  "id": "cgt-20260423162600-9tzw4",
  "object": "video",
  "model": "doubao-seedance-2-0-fast-260128",
  "status": "cancelled",
  "progress": 100,
  "created_at": 1776932757,
  "completed_at": 1776932863,
  "error": {
    "message": "Task cancelled by user",
    "code": "task_cancelled"
  }
}

Copy
任务已完成（无法取消）
{
  "error": {
    "message": "Cannot cancel a completed task",
    "type": "invalid_request_error"
  }
}

Copy
任务不存在
{
  "error": {
    "message": "Task not found",
    "type": "invalid_request_error"
  }
}

Copy
注意事项
只能取消状态为 NOT_START 或 IN_PROGRESS 的任务
已成功（SUCCESS）或已失败（FAILURE）的任务无法取消
---
## 素材库接口文档

素材库 API 接口文档

素材库用于管理视频生成所需的图片、视频、音频素材。上传后的素材会获得 asset:// 格式的引用地址，可直接用于视频生成请求中。

令牌隔离机制

素材库按**令牌（Token）**进行隔离，同一用户下不同令牌拥有各自独立的素材库空间。

隔离规则
使用令牌 A 的 API Key 创建的素材，令牌 B 无法查看、修改或删除
创建素材时必须指定 group_id，需先通过「创建素材库」接口创建分组
查询素材列表（group_id <= 0 或不传）时，返回当前令牌的所有素材 + 账号历史素材
分组可通过「转移素材库」接口在令牌之间转移
全部素材

「全部素材」视图包含：

当前令牌所有分组中的素材
账号的历史素材（升级前创建的，token_id=0）

其他令牌的素材不可见。

历史数据兼容

升级前已创建的素材库和素材保留为历史数据（token_id=0）：

通过「全部素材」视图可见，可正常使用
历史素材的 asset:// 引用地址不变，已有的视频生成请求无需修改
可通过「转移素材库」接口将历史分组移至指定令牌管理
Playground（视频生成广场）

Playground 通过 URL 参数 ?token_id=X 切换令牌视角：

必须选择令牌才能操作素材库
选择令牌后，显示「全部素材」和令牌专属的自定义分组
在选定令牌下创建的分组和素材归入该令牌
创建素材前必须先选择或创建一个分组
认证方式

所有接口需要在请求头中携带 API Key：

Authorization: Bearer sk-xxxx
Content-Type: application/json

Copy
基础地址
{BASE_URL}/v1/assets

Copy
1. 创建素材

上传一个素材（图片/视频/音频）到素材库。必须先创建素材库分组，然后指定 group_id 参数。

请求

POST /v1/assets

Copy

请求参数

参数	类型	必填	说明
url	string	是	素材文件的公网可访问 URL
asset_type	string	是	素材类型：Image、Video、Audio
name	string	否	素材名称（上限 64 字符）
group_id	int	是	素材库 ID，必须指定素材归属的素材库（通过「创建素材库」接口获得）

图片要求

高度：300px ~ 6000px
URL 必须公网可访问（火山引擎服务端会下载该文件）

请求示例

curl -X POST "{BASE_URL}/v1/assets" \
  -H "Authorization: Bearer sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/sunflower.jpg",
    "asset_type": "Image",
    "name": "test-sunflower",
    "group_id": 8
  }'

Copy
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

public class CreateAsset {
    public static void main(String[] args) throws Exception {
        String baseUrl = "{BASE_URL}";
        String apiKey = "sk-xxxx";

        String body = """
            {
                "url": "https://example.com/sunflower.jpg",
                "asset_type": "Image",
                "name": "test-sunflower",
                "group_id": 8
            }
            """;

        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + "/v1/assets"))
            .header("Authorization", "Bearer " + apiKey)
            .header("Content-Type", "application/json; charset=utf-8")
            .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
            .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.body());
    }
}

Copy

响应示例

{
  "code": "success",
  "data": {
    "id": "asset-20260403150605-bfjwz",
    "asset_url": "asset://asset-20260403150605-bfjwz"
  }
}

Copy

说明

id：素材唯一标识
asset_url：素材引用地址，格式为 asset://{id}，可直接用于视频生成请求
素材创建后需要等待处理完成（状态变为 Active）才能使用，通常耗时几秒到几十秒
素材归入指定的素材库分组，仅该分组所属令牌可访问
必须先通过「创建素材库」接口创建分组，获得 group_id 后才能创建素材
2. 查询素材列表

分页查询当前令牌的素材列表。

请求

POST /v1/assets/list

Copy

请求参数

参数	类型	必填	说明
page_number	int	否	页码，默认 1
page_size	int	否	每页数量，默认 20，最大 100
statuses	string[]	否	按状态筛选，可选值：Active、Processing、Failed
name	string	否	按名称模糊搜索
sort_by	string	否	排序字段
sort_order	string	否	排序方向
group_id	int	否	素材库 ID。-2：仅查历史分组（token_id=0）；<= 0（其他值）或不传：查当前令牌所有素材 + 历史素材；> 0：查指定分组

请求示例

curl -X POST "{BASE_URL}/v1/assets/list" \
  -H "Authorization: Bearer sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "page_number": 1,
    "page_size": 20
  }'

Copy
String body = """
    {
        "page_number": 1,
        "page_size": 20
    }
    """;

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create(baseUrl + "/v1/assets/list"))
    .header("Authorization", "Bearer " + apiKey)
    .header("Content-Type", "application/json; charset=utf-8")
    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
    .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());

Copy

响应示例

{
  "code": "success",
  "data": {
    "items": [
      {
        "id": "asset-20260403150605-bfjwz",
        "name": "sunflower-renamed",
        "url": "https://ark-media-asset.tos-cn-beijing.volces.com/...(签名URL，有效期12小时)",
        "asset_url": "asset://asset-20260403150605-bfjwz",
        "asset_type": "Image",
        "status": "Active",
        "create_time": "2026-04-03T07:06:05Z",
        "update_time": "2026-04-03T07:15:40Z"
      }
    ],
    "total_count": 1,
    "page_number": 1,
    "page_size": 20
  }
}

Copy

响应字段说明

字段	说明
id	素材 ID
name	素材名称
url	素材原始文件访问地址（签名 URL，有效期 12 小时）
asset_url	素材引用地址，用于视频生成
asset_type	素材类型：Image / Video / Audio
status	素材状态：Active（可用）/ Processing（处理中）/ Failed（失败）
create_time	创建时间
update_time	更新时间
3. 查询单个素材

根据素材 ID 查询详细信息。仅能查询当前令牌可见范围内的素材。

请求

POST /v1/assets/get

Copy

请求参数

参数	类型	必填	说明
id	string	是	素材 ID

请求示例

curl -X POST "{BASE_URL}/v1/assets/get" \
  -H "Authorization: Bearer sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "asset-20260403150605-bfjwz"
  }'

Copy
String body = """
    {"id": "asset-20260403150605-bfjwz"}
    """;

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create(baseUrl + "/v1/assets/get"))
    .header("Authorization", "Bearer " + apiKey)
    .header("Content-Type", "application/json; charset=utf-8")
    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
    .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());

Copy

响应示例

{
  "code": "success",
  "data": {
    "id": "asset-20260403150605-bfjwz",
    "name": "sunflower-renamed",
    "url": "https://ark-media-asset.tos-cn-beijing.volces.com/...(签名URL，有效期12小时)",
    "asset_url": "asset://asset-20260403150605-bfjwz",
    "asset_type": "Image",
    "status": "Active",
    "create_time": "2026-04-03T07:06:05Z",
    "update_time": "2026-04-03T07:15:40Z"
  }
}

Copy

典型用途：创建素材后轮询此接口等待状态变为 Active。

4. 更新素材

更新素材的名称。仅能更新当前令牌可见范围内的素材。

请求

POST /v1/assets/update

Copy

请求参数

参数	类型	必填	说明
id	string	是	素材 ID
name	string	是	新名称（上限 64 字符）

请求示例

curl -X POST "{BASE_URL}/v1/assets/update" \
  -H "Authorization: Bearer sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "asset-20260403150605-bfjwz",
    "name": "sunflower-renamed"
  }'

Copy
String body = """
    {
        "id": "asset-20260403150605-bfjwz",
        "name": "sunflower-renamed"
    }
    """;

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create(baseUrl + "/v1/assets/update"))
    .header("Authorization", "Bearer " + apiKey)
    .header("Content-Type", "application/json; charset=utf-8")
    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
    .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());

Copy

响应示例

{
  "code": "success",
  "data": {
    "id": "asset-20260403150605-bfjwz"
  }
}

Copy
5. 删除素材

删除指定素材。仅能删除当前令牌可见范围内的素材。

请求

POST /v1/assets/delete

Copy

请求参数

参数	类型	必填	说明
id	string	是	素材 ID

请求示例

curl -X POST "{BASE_URL}/v1/assets/delete" \
  -H "Authorization: Bearer sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "asset-20260403150605-bfjwz"
  }'

Copy
String body = """
    {"id": "asset-20260403150605-bfjwz"}
    """;

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create(baseUrl + "/v1/assets/delete"))
    .header("Authorization", "Bearer " + apiKey)
    .header("Content-Type", "application/json; charset=utf-8")
    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
    .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());

Copy

响应示例

{
  "code": "success",
  "data": {
    "id": "asset-20260403150605-bfjwz"
  }
}

Copy
6. 获取素材库列表

获取当前令牌的素材库分组列表。必须指定令牌（通过 API Key 自动识别，或 Playground 中选择令牌）。

注意：如果用户存在历史未绑定令牌的分组（token_id=0），接口会在列表头部返回一个合成的「历史分组」条目（id=-2），方便查看历史素材。新用户没有历史分组时，只返回令牌专属的自定义分组。

请求

GET /v1/assets/groups

Copy

请求参数

无需请求体。

请求示例

curl "{BASE_URL}/v1/assets/groups" \
  -H "Authorization: Bearer sk-xxxx"

Copy
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create(baseUrl + "/v1/assets/groups"))
    .header("Authorization", "Bearer " + apiKey)
    .GET()
    .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());

Copy

响应示例

{
  "code": "success",
  "data": [
    {
      "id": -2,
      "name": "历史分组",
      "group_name": "历史分组",
      "is_default": false,
      "asset_count": 12
    },
    {
      "id": 8,
      "name": "人像素材",
      "group_name": "user-10-token-5-人像素材",
      "is_default": false,
      "asset_count": 5
    },
    {
      "id": 12,
      "name": "风景素材",
      "group_name": "user-10-token-5-风景素材",
      "is_default": false,
      "asset_count": 3
    }
  ]
}

Copy

响应字段说明

字段	说明
id	素材库 ID（本地）。-2 为历史分组（合成条目），> 0 为自定义分组，可在创建素材、查询素材列表时作为 group_id 使用
name	素材库显示名称（如 人像素材），可直接展示给用户
group_name	素材库完整名称，格式为 user-{用户ID}-token-{令牌ID}-{自定义名称}
is_default	是否为默认素材库（固定返回 false）
asset_count	该素材库中的素材数量

说明

如果用户有历史分组（token_id=0），列表头部会包含 id=-2 的「历史分组」条目
新用户没有历史分组时，只返回令牌专属的自定义分组
不能在历史分组中创建新素材，仅用于查看和管理历史数据
查询历史分组的素材请使用「查询素材列表」接口，group_id 设为 -2
创建素材前需先通过此接口获取可用的 group_id（> 0），或通过「创建素材库」接口新建分组
7. 创建素材库

创建一个自定义素材库，归入当前令牌的专属区。创建后可在上传素材时通过 group_id 参数指定素材归属。

请求

POST /v1/assets/groups

Copy

请求参数

参数	类型	必填	说明
name	string	是	素材库名称

请求示例

curl -X POST "{BASE_URL}/v1/assets/groups" \
  -H "Authorization: Bearer sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "人像素材"
  }'

Copy
String body = """
    {"name": "人像素材"}
    """;

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create(baseUrl + "/v1/assets/groups"))
    .header("Authorization", "Bearer " + apiKey)
    .header("Content-Type", "application/json; charset=utf-8")
    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
    .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());

Copy

响应示例

{
  "code": "success",
  "data": {
    "group_name": "user-10-token-5-人像素材"
  }
}

Copy

说明

素材库名称会自动添加前缀，格式为 user-{用户ID}-token-{令牌ID}-{自定义名称}
创建后通过「获取素材库列表」接口获取分配的 id，后续使用该 id 作为 group_id
新建的分组仅当前令牌可见，其他令牌无法访问
8. 删除素材库

删除素材库分组及其中所有素材。删除操作会同时删除上游（火山引擎）的素材数据，不可恢复。

id > 0：删除指定的自建分组及其中全部素材
id = -2：删除所有历史分组及其中全部素材

请求

POST /v1/assets/groups/delete

Copy

请求参数

参数	类型	必填	说明
id	int	是	素材库 ID（通过获取素材库列表接口获得）。传 -2 可删除所有历史分组

请求示例

curl -X POST "{BASE_URL}/v1/assets/groups/delete" \
  -H "Authorization: Bearer sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "id": 8
  }'

Copy
String body = """
    {"id": 8}
    """;

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create(baseUrl + "/v1/assets/groups/delete"))
    .header("Authorization", "Bearer " + apiKey)
    .header("Content-Type", "application/json; charset=utf-8")
    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
    .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());

Copy

响应示例

{
  "code": "success"
}

Copy
9. 转移素材库

将素材库分组转移到另一个令牌。

典型用途：

将历史分组移到某个令牌进行管理
在不同令牌之间调整素材分组归属

支持两种模式：

id > 0：转移指定的自建分组到目标令牌，自建分组可在令牌间双向互转
id = -2：将所有历史分组（token_id=0）整体转移到目标令牌，转移后历史分组消失，各分组以真实 ID 作为独立的自建分组展示

请求

POST /v1/assets/groups/transfer

Copy

请求参数

参数	类型	必填	说明
id	int	是	素材库 ID（通过获取素材库列表接口获得）。传 -2 可转移所有历史分组
token_id	int	是	目标令牌 ID，必须为正整数，且必须属于当前用户

请求示例

将分组移到令牌 5：

curl -X POST "{BASE_URL}/v1/assets/groups/transfer" \
  -H "Authorization: Bearer sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "id": 3,
    "token_id": 5
  }'

Copy
String body = """
    {"id": 3, "token_id": 5}
    """;

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create(baseUrl + "/v1/assets/groups/transfer"))
    .header("Authorization", "Bearer " + apiKey)
    .header("Content-Type", "application/json; charset=utf-8")
    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
    .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());

Copy

响应示例

{
  "code": "success"
}

Copy

说明

转移只修改本地归属记录，不影响上游素材数据
转移后，原令牌将无法看到该分组及其中的素材
目标令牌可通过分组列表访问该分组
目标令牌必须属于当前用户，否则返回错误
历史分组（id=-2）转移后，id=-2 条目消失，各分组以真实数据库 ID 独立展示
自建分组可在令牌之间双向互转，不限方向
素材库与令牌的关系
用户（User）
├── 令牌 A（Token）
│   ├── 自定义素材库 1（仅令牌 A 可见）
│   └── 自定义素材库 2（仅令牌 A 可见）
├── 令牌 B（Token）
│   └── 自定义素材库 3（仅令牌 B 可见）
└── 历史素材（token_id=0，升级前创建）
    └── 通过「历史分组」（id=-2）可见，可转移到具体令牌

Copy
创建素材时必须指定 group_id（> 0），需先通过「创建素材库」接口创建分组
group_id == -2 查询历史分组的素材
group_id <= 0（其他值）或不传时查询当前令牌的所有素材 + 历史素材
group_id > 0 查询指定分组，该分组必须在当前令牌可见范围内
分组可通过「转移素材库」接口在令牌之间转移
系统不再自动创建默认分组
获取分组列表时，如果用户有历史数据会自动包含「历史分组」条目
升级前后对比
行为	升级前	升级后
素材归属	按用户隔离，同一用户所有令牌共享	按令牌隔离，不同令牌各自独立
创建素材	不指定 group_id 时自动归入默认分组	必须指定 group_id，需先创建分组
历史素材	—	通过「历史分组」（id=-2）可见，可转移到令牌管理
asset:// 引用	正常使用	不受影响，历史引用继续有效
默认分组	系统自动创建	不再自动创建，需手动创建分组
自定义分组命名	user-{uid}-{name}	user-{uid}-token-{tid}-{name}
获取分组列表	返回所有分组（含默认）	返回令牌专属自定义分组 + 条件性「历史分组」
分组显示名称	需前端解析	接口直接返回 name 字段
10. 在视频生成中使用素材

素材上传并处于 Active 状态后，可通过 asset:// URL 在视频生成请求中引用。

请求

POST /v1/video/generations

Copy

图生视频示例（使用素材作为参考图）

curl -X POST "{BASE_URL}/v1/video/generations" \
  -H "Authorization: Bearer sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedance-2-0-fast-260128",
    "prompt": "向日葵随风摆动",
    "metadata": {
      "content": [
        {
          "type": "text",
          "text": "图片中的向日葵在微风中轻轻摇曳摆动，阳光洒落，花瓣随风飘动"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "asset://asset-20260403150605-bfjwz"
          },
          "role": "reference_image"
        }
      ],
      "duration": 5,
      "resolution": "720p",
      "ratio": "adaptive"
    }
  }'

Copy
String body = """
    {
        "model": "doubao-seedance-2-0-fast-260128",
        "prompt": "向日葵随风摆动",
        "metadata": {
            "content": [
                {"type": "text", "text": "图片中的向日葵在微风中轻轻摇曳摆动，阳光洒落，花瓣随风飘动"},
                {"type": "image_url", "image_url": {"url": "asset://asset-20260403150605-bfjwz"}, "role": "reference_image"}
            ],
            "duration": 5,
            "resolution": "720p",
            "ratio": "adaptive"
        }
    }
    """;

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create(baseUrl + "/v1/video/generations"))
    .header("Authorization", "Bearer " + apiKey)
    .header("Content-Type", "application/json; charset=utf-8")
    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
    .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());

Copy

响应示例

{
  "task_id": "cgt-20260403152344-dtdwq"
}

Copy

查询视频生成结果

curl "{BASE_URL}/v1/video/generations/cgt-20260403152344-dtdwq" \
  -H "Authorization: Bearer sk-xxxx"

Copy

成功响应示例

{
  "code": "success",
  "data": {
    "task_id": "cgt-20260403152344-dtdwq",
    "status": "SUCCESS",
    "progress": "100%",
    "data": {
      "id": "cgt-20260403152344-dtdwq",
      "model": "doubao-seedance-2-0-fast-260128",
      "status": "succeeded",
      "duration": 5,
      "resolution": "720p",
      "ratio": "16:9",
      "content": {
        "video_url": "https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/...(签名URL，有效期24小时)"
      },
      "usage": {
        "total_tokens": 108900,
        "completion_tokens": 108900
      }
    }
  }
}

Copy
content 中支持的素材引用类型
type	role	说明
image_url	reference_image	参考图片
image_url	first_frame	首帧图片
image_url	last_frame	尾帧图片
video_url	reference_video	参考视频
audio_url	reference_audio	参考音频

每种类型的 URL 均支持 https:// 公网地址和 asset:// 素材库引用两种格式。

完整流程示例（Python）

以下示例演示完整流程：创建分组 → 上传图片素材 → 等待就绪 → 生成视频 → 获取结果。

import requests
import time

BASE_URL = "{BASE_URL}"
API_KEY = "sk-xxxx"
headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# 1. 创建素材库分组（如已有分组可跳过）
print("创建素材库分组...")
resp = requests.post(f"{BASE_URL}/v1/assets/groups", headers=headers, json={
    "name": "我的素材"
})
print(f"分组名称: {resp.json()['data']['group_name']}")

# 获取分组列表，拿到 group_id
resp = requests.get(f"{BASE_URL}/v1/assets/groups", headers=headers)
groups = resp.json()["data"]
group_id = groups[0]["id"]
print(f"使用分组ID: {group_id}")

# 2. 上传素材（必须指定 group_id）
print("上传素材...")
resp = requests.post(f"{BASE_URL}/v1/assets", headers=headers, json={
    "url": "https://example.com/sunflower.jpg",
    "asset_type": "Image",
    "name": "my-sunflower",
    "group_id": group_id
})
asset_data = resp.json()["data"]
asset_id = asset_data["id"]
asset_url = asset_data["asset_url"]  # asset://asset-xxxxx
print(f"素材ID: {asset_id}")
print(f"素材URL: {asset_url}")

# 3. 等待素材处理完成
print("等待素材就绪...")
while True:
    resp = requests.post(f"{BASE_URL}/v1/assets/get", headers=headers, json={"id": asset_id})
    status = resp.json()["data"]["status"]
    print(f"  状态: {status}")
    if status == "Active":
        break
    if status == "Failed":
        print("素材处理失败")
        exit()
    time.sleep(5)

# 4. 使用素材生成视频
print("提交视频生成任务...")
resp = requests.post(f"{BASE_URL}/v1/video/generations", headers=headers, json={
    "model": "doubao-seedance-2-0-fast-260128",
    "prompt": "向日葵随风摆动",
    "metadata": {
        "content": [
            {"type": "text", "text": "图片中的向日葵在微风中轻轻摇曳摆动"},
            {"type": "image_url", "image_url": {"url": asset_url}, "role": "reference_image"}
        ],
        "duration": 5,
        "resolution": "720p",
        "ratio": "adaptive"
    }
})
task_id = resp.json()["task_id"]
print(f"任务ID: {task_id}")

# 5. 轮询任务结果
print("等待视频生成...")
while True:
    resp = requests.get(
        f"{BASE_URL}/v1/video/generations/{task_id}",
        headers={"Authorization": f"Bearer {API_KEY}"}
    )
    result = resp.json()
    data = result.get("data", {})
    status = data.get("status", "")
    progress = data.get("progress", "")
    print(f"  状态: {status}, 进度: {progress}")

    if status == "SUCCESS":
        video_url = data["data"]["content"]["video_url"]
        print(f"视频地址: {video_url}")
        break
    elif status == "FAILURE":
        print(f"生成失败: {data.get('fail_reason', '')}")
        break

    time.sleep(15)

Copy
完整流程示例（Java）

以下示例演示完整流程：创建分组 → 上传图片素材 → 等待就绪 → 生成视频 → 获取结果。

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

public class AssetWorkflow {
    private static final String BASE_URL = "{BASE_URL}";
    private static final String API_KEY = "sk-xxxx";
    private static final HttpClient client = HttpClient.newHttpClient();
    private static final ObjectMapper mapper = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        // 1. 创建素材库分组
        System.out.println("创建素材库分组...");
        String createGroupBody = """
            {"name": "我的素材"}
            """;
        String createGroupResp = post("/v1/assets/groups", createGroupBody);
        System.out.println("分组名称: " + parseField(createGroupResp, "data", "group_name"));

        // 获取分组列表，拿到 group_id
        String groupsResp = get("/v1/assets/groups");
        JsonNode groups = mapper.readTree(groupsResp).get("data");
        int groupId = groups.get(0).get("id").asInt();
        System.out.println("使用分组ID: " + groupId);

        // 2. 上传素材
        System.out.println("上传素材...");
        String createAssetBody = String.format("""
            {
                "url": "https://example.com/sunflower.jpg",
                "asset_type": "Image",
                "name": "my-sunflower",
                "group_id": %d
            }
            """, groupId);
        String assetResp = post("/v1/assets", createAssetBody);
        JsonNode assetData = mapper.readTree(assetResp).get("data");
        String assetId = assetData.get("id").asText();
        String assetUrl = assetData.get("asset_url").asText();
        System.out.println("素材ID: " + assetId + ", 素材URL: " + assetUrl);

        // 3. 等待素材处理完成
        System.out.println("等待素材就绪...");
        while (true) {
            String getBody = String.format("""
                {"id": "%s"}
                """, assetId);
            String statusResp = post("/v1/assets/get", getBody);
            String status = parseField(statusResp, "data", "status");
            System.out.println("  状态: " + status);
            if ("Active".equals(status)) break;
            if ("Failed".equals(status)) {
                System.out.println("素材处理失败");
                return;
            }
            Thread.sleep(5000);
        }

        // 4. 使用素材生成视频
        System.out.println("提交视频生成任务...");
        String videoBody = String.format("""
            {
                "model": "doubao-seedance-2-0-fast-260128",
                "prompt": "向日葵随风摆动",
                "metadata": {
                    "content": [
                        {"type": "text", "text": "图片中的向日葵在微风中轻轻摇曳摆动"},
                        {"type": "image_url", "image_url": {"url": "%s"}, "role": "reference_image"}
                    ],
                    "duration": 5,
                    "resolution": "720p",
                    "ratio": "adaptive"
                }
            }
            """, assetUrl);
        String taskResp = post("/v1/video/generations", videoBody);
        String taskId = mapper.readTree(taskResp).get("task_id").asText();
        System.out.println("任务ID: " + taskId);

        // 5. 轮询任务结果
        System.out.println("等待视频生成...");
        while (true) {
            String queryResp = get("/v1/video/generations/" + taskId);
            JsonNode data = mapper.readTree(queryResp).get("data");
            String taskStatus = data.get("status").asText();
            String progress = data.has("progress") ? data.get("progress").asText() : "";
            System.out.println("  状态: " + taskStatus + ", 进度: " + progress);

            if ("SUCCESS".equals(taskStatus)) {
                String videoUrl = data.get("data").get("content").get("video_url").asText();
                System.out.println("视频地址: " + videoUrl);
                break;
            } else if ("FAILURE".equals(taskStatus)) {
                System.out.println("生成失败: " + data.path("fail_reason").asText(""));
                break;
            }
            Thread.sleep(15000);
        }
    }

    private static String post(String path, String body) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(BASE_URL + path))
            .header("Authorization", "Bearer " + API_KEY)
            .header("Content-Type", "application/json; charset=utf-8")
            .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
            .build();
        return client.send(request, HttpResponse.BodyHandlers.ofString()).body();
    }

    private static String get(String path) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(BASE_URL + path))
            .header("Authorization", "Bearer " + API_KEY)
            .GET()
            .build();
        return client.send(request, HttpResponse.BodyHandlers.ofString()).body();
    }

    private static String parseField(String json, String... path) throws Exception {
        JsonNode node = mapper.readTree(json);
        for (String key : path) node = node.get(key);
        return node.asText();
    }
}

Copy
错误码
HTTP 状态码	错误信息	说明
400	group_id 必须指定，请先创建素材库分组	创建素材时未指定 group_id
400	请选择令牌	获取分组列表或创建分组时未选择令牌
400	asset_type 必须为 Image、Video 或 Audio	素材类型参数错误
400	参数错误	缺少必填字段或格式错误
400	target_token_id 必须为正整数	转移分组时目标令牌 ID 无效
400	token_id 格式错误	Playground 传入的 token_id 不是有效的正整数
403	未找到可用的素材资产渠道	管理员未配置素材资产渠道 AK/SK
403	无权访问此素材	素材不属于当前令牌的可见范围
403	无权访问该令牌的素材库	Playground 指定的令牌不属于当前用户
500	InvalidParameter.DownloadFailed	素材 URL 无法访问或下载失败
500	InvalidParameter.HeightTooSmall	图片高度不满足 300px ~ 6000px 要求
500	NotFound.asset_id	素材 ID 不存在
---
