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
import { jsonrepair } from 'jsonrepair';

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
  const candidate = start >= 0 && end > start ? content.slice(start, end + 1) : null;
  if (candidate) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* fall through */
    }
  }

  // 5. jsonrepair 修 broken JSON(灵感真打 2026-06:LLM 在中文字符串值内塞未转义半角双引号、
  //    尾逗号、单引号等 — 前 4 级只处理 markdown 包裹,救不了「内容本身非法」)。
  //    对裸花括号子串优先(去 markdown 噪声),没有则用剥 fence 后的 cleaned。
  try {
    return JSON.parse(jsonrepair(candidate ?? cleaned));
  } catch {
    /* 留给业务层处理 */
  }

  return undefined;
}
