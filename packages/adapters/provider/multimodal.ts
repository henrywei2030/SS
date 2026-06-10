/**
 * 多模态 user content 构造(M3c,蓝图 docs/06 §M3 "TextRequest 扩 imageUrls")。
 *
 * TextRequest.imageUrls 支持两种形态:
 *   - http(s) URL:直接透传(上游服务端自己拉取 — 需公网可达)
 *   - data:image/...;base64,xxx:内联图(QC 抽帧走这条 — 本地 MinIO 对外不可达,
 *     由我们抽帧后 base64 内联,不依赖存储公网性)
 *
 * 纯函数,无 IO — 单测锁两家 API 的 content part 形状(multimodal.test.ts)。
 * 无图时返回原字符串:存量纯文本调用路径零行为变化。
 */

// ---------- OpenAI chat/completions 形状 ----------

export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/** OpenAI 兼容(moyu 中转等):有图转 parts 数组(图在前文在后),无图返回纯字符串 */
export function buildOpenAIUserContent(
  prompt: string,
  imageUrls?: string[],
): string | OpenAIContentPart[] {
  if (!imageUrls?.length) return prompt;
  return [
    ...imageUrls.map((url): OpenAIContentPart => ({ type: 'image_url', image_url: { url } })),
    { type: 'text', text: prompt },
  ];
}

// ---------- Anthropic messages 形状 ----------

export type AnthropicImageSource =
  | { type: 'url'; url: string }
  | { type: 'base64'; media_type: string; data: string };

export type AnthropicContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: AnthropicImageSource };

/**
 * data: URL → Anthropic base64 source;非 data: / 解析不出 → url source 透传。
 * 仅接受 base64 编码的 data URL(`;base64,` 分隔)— QC 抽帧产物固定此格式。
 */
export function parseAnthropicImageSource(url: string): AnthropicImageSource {
  if (url.startsWith('data:')) {
    const m = /^data:([^;,]+);base64,(.+)$/s.exec(url);
    if (m) return { type: 'base64', media_type: m[1]!, data: m[2]! };
  }
  return { type: 'url', url };
}

/** Anthropic 直连:有图转 content parts(图在前文在后),无图返回纯字符串 */
export function buildAnthropicUserContent(
  prompt: string,
  imageUrls?: string[],
): string | AnthropicContentPart[] {
  if (!imageUrls?.length) return prompt;
  return [
    ...imageUrls.map(
      (url): AnthropicContentPart => ({ type: 'image', source: parseAnthropicImageSource(url) }),
    ),
    { type: 'text', text: prompt },
  ];
}
