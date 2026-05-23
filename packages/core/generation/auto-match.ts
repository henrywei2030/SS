/**
 * 资产自动 @ 匹配
 *
 * 业务背景:
 *   - 分镜里写"陆萌萌打开抽屉"，AIGC 时应自动关联人物 @陆萌萌、道具 @抽屉
 *   - 用本地字典精确字符串匹配(非 AI 模糊匹配),更稳更便宜
 *
 * 算法：
 *   1. 收集项目所有 confirmed 资产 + 其别名
 *   2. 按"长名优先"排序（避免"陆"误匹配到"陆萌萌"的"陆"）
 *   3. 在剧本/分镜文本中做精确字符串扫描
 *   4. 区分 VISIBLE / MENTIONED / VOICE_ONLY 三种引用类型
 */

export interface MatchableAsset {
  id: string;
  type: 'CHARACTER' | 'SCENE' | 'PROP';
  name: string;
  alias: string[];
}

export interface MatchResult {
  assetId: string;
  assetName: string;
  type: 'CHARACTER' | 'SCENE' | 'PROP';
  refKind: 'VISIBLE' | 'MENTIONED' | 'VOICE_ONLY';
  /** 匹配的关键词 */
  matchedTerm: string;
  /** 文本中的位置 */
  position: number;
}

export interface AutoMatchOptions {
  /** 是否将 OS / 旁白 / 对话提及但不出画的人物记为 MENTIONED */
  detectMentionedOnly?: boolean;
  /** 是否忽略大小写（中文场景默认 false） */
  caseInsensitive?: boolean;
}

/**
 * 在文本中自动匹配资产
 *
 * 示例输入文本：
 *   "陆萌萌（脸红地）：哥，你欺负人！陆乘抓起协议拍在桌上。"
 *
 * 应识别：
 *   - 陆萌萌 (CHARACTER, VISIBLE)
 *   - 陆乘 (CHARACTER, VISIBLE)
 *   - 协议 (PROP, VISIBLE)
 *   - 桌子 (PROP, VISIBLE) — 若道具库有 "桌子" 资产
 */
export function autoMatchAssets(
  text: string,
  assets: MatchableAsset[],
  opts: AutoMatchOptions = {},
): MatchResult[] {
  if (!text || assets.length === 0) return [];

  // 1. 展开 name + alias，记录归属 asset
  const terms: { term: string; asset: MatchableAsset }[] = [];
  for (const a of assets) {
    terms.push({ term: a.name, asset: a });
    for (const al of a.alias) {
      if (al && al.trim()) terms.push({ term: al.trim(), asset: a });
    }
  }

  // 2. 按 term 长度倒序（长名优先）
  terms.sort((a, b) => b.term.length - a.term.length);

  // 3. 扫描文本，避免重复匹配同一区域
  const results: MatchResult[] = [];
  const matched = new Array<boolean>(text.length).fill(false);
  const seenAssetTerms = new Set<string>(); // 避免同一 asset 多次重复（保留首次位置）

  const haystack = opts.caseInsensitive ? text.toLowerCase() : text;

  for (const { term, asset } of terms) {
    const needle = opts.caseInsensitive ? term.toLowerCase() : term;
    let from = 0;
    let idx: number;
    while ((idx = haystack.indexOf(needle, from)) !== -1) {
      // 检查该区段是否已被更长的匹配占用
      let isCovered = false;
      for (let i = idx; i < idx + needle.length; i++) {
        if (matched[i]) {
          isCovered = true;
          break;
        }
      }
      if (!isCovered) {
        // 同一 asset + 同一 term 只记一次
        const key = `${asset.id}|${term}`;
        if (!seenAssetTerms.has(key)) {
          seenAssetTerms.add(key);
          results.push({
            assetId: asset.id,
            assetName: asset.name,
            type: asset.type,
            refKind: classifyRef(text, idx, term, opts),
            matchedTerm: term,
            position: idx,
          });
        }
        for (let i = idx; i < idx + needle.length; i++) matched[i] = true;
      }
      from = idx + needle.length;
    }
  }

  return results.sort((a, b) => a.position - b.position);
}

/**
 * 判断引用类型
 * 简化规则:
 *   - 紧邻 "OS"、"(OS)"、"画外音"、"旁白" → VOICE_ONLY
 *   - 仅在台词中提及（前后是引号/对话冒号）且没有动作描写 → MENTIONED
 *   - 默认 VISIBLE
 *
 * Phase 2 可换 NLP 模型做更精细分类。
 */
function classifyRef(
  text: string,
  position: number,
  term: string,
  opts: AutoMatchOptions,
): 'VISIBLE' | 'MENTIONED' | 'VOICE_ONLY' {
  const windowStart = Math.max(0, position - 20);
  const windowEnd = Math.min(text.length, position + term.length + 20);
  const ctx = text.slice(windowStart, windowEnd);

  if (/\bOS\b|（OS）|\(OS\)|画外音|旁白/i.test(ctx)) {
    return 'VOICE_ONLY';
  }

  if (opts.detectMentionedOnly) {
    // 简单启发: 在台词引号内 + 没有动作动词
    const inDialogue = /[""].*$/.test(ctx.slice(0, position - windowStart));
    if (inDialogue) return 'MENTIONED';
  }

  return 'VISIBLE';
}

/**
 * 工具：从匹配结果生成 prompt 中的 @ 占位符
 *
 * 输入: "陆萌萌打开抽屉"
 * 输出: "@角色1[陆萌萌] 打开 @道具3[抽屉]"
 */
export function injectMentions(text: string, matches: MatchResult[]): string {
  let out = text;
  const sorted = [...matches].sort((a, b) => b.position - a.position); // 从后往前替换避免位置漂移
  for (const m of sorted) {
    const tag = `@${typeShortCode(m.type)}[${m.assetName}]`;
    out = out.slice(0, m.position) + tag + out.slice(m.position + m.matchedTerm.length);
  }
  return out;
}

function typeShortCode(t: 'CHARACTER' | 'SCENE' | 'PROP'): string {
  return t === 'CHARACTER' ? '角色' : t === 'SCENE' ? '场景' : '道具';
}
