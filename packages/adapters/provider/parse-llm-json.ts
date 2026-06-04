/**
 * 全盘审查 #12:LLM JSON 容错解析 — 共享 helper
 *
 * 原 openai-compat.ts(4 级 fallback)与 claude.ts(仅 2 级)各有一份实现且已漂移
 * (claude 缺"正则提内嵌 ```json``` block"那级)。抽到这里两个 text provider 共用,
 * 消除重复 + 防未来再漂移。
 *
 * 4 级 fallback(LLM 常把 JSON 包进 markdown / 混解释文字):
 *   1. 直接 JSON.parse
 *   2. 剥首尾 ```json fence
 *   3. 正则提取内嵌 ```json ... ``` block
 *   4. 裸花括号:首个 { 到最后一个 }
 *
 * 全部失败返回 undefined,交给业务层(配合 TextResult.truncated 判断是截断还是格式问题)。
 */
export function tryParseLlmJson(content: string): unknown {
  if (!content) return undefined;

  // 1. 直接 parse
  try {
    return JSON.parse(content);
  } catch {
    /* fall through */
  }

  // 2. 剥首尾 markdown fence
  const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through */
  }

  // 3. 正则提取内嵌 ```json ... ``` block(Claude 习惯把 JSON 包 markdown)
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }

  // 4. 裸花括号:首个 { 到最后一个 }
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(content.slice(start, end + 1));
    } catch {
      /* 留给业务层处理 */
    }
  }

  return undefined;
}
