/**
 * M6 优化器守卫(纯函数,单测覆盖)。
 *
 * 核心护栏 — @token 保全:组提示词里的 @图片N/@音频N 绑定着 refSlotIdx 参考资源,
 * 优化器若改写/丢失这些 token,编译期 unknownTokens/missingMedia 检查会直接拒生成
 * (占位+退款空转)。LLM 输出必须逐 token 校验,缺一即回退原文。
 */

/**
 * 与编译器**严格同源**的 token 正则(storyboard/video.ts:288 `/@(图片|音频)(\d+)/g`):
 *   只认 @图片N / @音频N,数字边界即止。
 *
 * ⚠️ 2026-06-13 修真 bug:此前用贪婪的 `@[一-龥A-Za-z0-9_-]+` 想「宁可多匹配不可漏」,
 *   但 @图片N 后紧跟中文描述(无空格)时会被吞成假 token —— 实测组 33-35 抽出
 *   「@图片1虚化」「@图片6钥匙」「@图片1与雪山虚化成清透冷调光斑」等。优化器重写描述后
 *   这些假 token 必然「丢失」→ findLostTokens 误报 → 深度优化恒撞 TOKEN_LOST/HARD_GATE 被拒。
 *   编译器只解析 @图片N/@音频N(数字边界),守卫必须与之严格一致,绝不可比它更宽。
 */
const AT_TOKEN_RE = /@(?:图片|音频)\d+/g;

/** 提取提示词里的全部 @token(去重,保持出现顺序) */
export function extractAtTokens(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.match(AT_TOKEN_RE) ?? []) seen.add(m);
  return Array.from(seen);
}

/**
 * 校验优化输出是否保全了原文全部 @token。
 * 返回缺失清单(空数组 = 通过)。只查"原有的必须还在",新增 token 不拦
 * (LLM 自行新增 @ 引用没意义但无害 — 编译期 unknownTokens 会拦截真问题)。
 */
export function findLostTokens(original: string, optimized: string): string[] {
  const need = extractAtTokens(original);
  if (need.length === 0) return [];
  const have = new Set(extractAtTokens(optimized));
  return need.filter((t) => !have.has(t));
}

/** 默认启用的 contributor 集(与 seed.ts prompt.optimizer.contributors 默认值一致)
 *  H1 增 knowledge:未配 embedding binding 时走 tags/keyword 检索,零成本零外呼 */
export const DEFAULT_CONTRIBUTORS = ['shot', 'assets', 'style', 'continuity', 'knowledge'] as const;

/**
 * 解析 SystemSetting prompt.optimizer.contributors(CSV)→ 去重小写 key 列表。
 * 空/缺省 → 默认五件套;全非法(解析后为空)同样回默认 — 开关写错不至于把优化器喂空。
 */
export function parseEnabledContributors(raw: string | null | undefined): string[] {
  const parsed = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const deduped = Array.from(new Set(parsed));
  return deduped.length > 0 ? deduped : [...DEFAULT_CONTRIBUTORS];
}

/** LLM 输出清理:剥常见包裹(```/```text 围栏、首尾引号)+ trim;不改正文内容 */
export function stripLlmWrapping(raw: string): string {
  let s = raw.trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(s);
  if (fence) s = fence[1]!.trim();
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length > 2) ||
    (s.startsWith('“') && s.endsWith('”') && s.length > 2)
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}
