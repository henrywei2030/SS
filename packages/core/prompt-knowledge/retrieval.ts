/**
 * H0(docs/07 §2/§5):PromptKnowledge 八维知识库 — 检索纯函数层。
 *
 * 纯函数,无 DB / LLM I/O,单测覆盖;DB 读写与懒回填在 backfill.ts / H1 contributor 层。
 *
 * 退化阶梯(docs/07 §5,每档可用):
 *   1. embedding 模式:queryEmbedding 给了且条目有向量 → 余弦相似度排序
 *   2. keyword 模式:无向量 → 条目 keywords/title 在 queryText 中的命中计分
 *   3. tag 模式:keyword 全零命中(画质/稳定这类通用维天然如此)→ tag 过滤后按 hitCount 排序
 *
 * "八个独立 RAG"的隔离在 dimension 列 + 检索过滤,不在物理拆分(docs/07 §4.4 / D-A)。
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** tagsJson 的结构化形状(docs/07 §3) */
export interface KnowledgeTags {
  /** 模型家族:seedance / kling / happyhorse / generic …(空 = 全家族通用) */
  family?: string[];
  /** 风格倾向(空 = 通用) */
  style?: string[];
  /** 氛围(空 = 通用) */
  mood?: string[];
  /** 年代(空 = 通用) */
  era?: string[];
  /** 关键词 — 降级链 keyword 检索用 */
  keywords?: string[];
}

/** 检索条目(PromptKnowledge 行的纯数据子集 — 不 import Prisma,保持纯函数层独立) */
export interface RetrievableKnowledgeEntry {
  id: string;
  /** 八维之一(SUBJECT/ACTION/SCENE/LIGHTING/CAMERA/STYLE/QUALITY/CONSTRAINT) */
  dimension: string;
  title: string;
  content: string;
  tags: KnowledgeTags;
  /** null/undefined = 未回填(懒 embedding,docs/07 §4.5) */
  embedding?: number[] | null;
  hitCount?: number;
  /** H3 飞轮权重(qcScore 相关性升降,默认 1)— tag 模式主排序,语义/关键词模式平分破并列 */
  weight?: number;
  enabled?: boolean;
}

export interface RetrieveFilter {
  /** 目标模型家族 — 条目无 family 约束(空数组/缺失)= 全家族通用,始终命中 */
  family?: string;
  style?: string;
  mood?: string;
  era?: string;
}

export interface RetrieveOptions {
  /** 逐维检索(docs/07 §2 Retriever:八维逐维 top-k)— 缺省不过滤维度 */
  dimension?: string;
  /** top-k,默认 3(docs/07:top-k≤3) */
  k?: number;
  filter?: RetrieveFilter;
  /** 查询向量(H1 由组正文 embed 而来);null/缺省 = 走 keyword/tag 降级链 */
  queryEmbedding?: number[] | null;
  /** 查询文本(keyword 降级链匹配源;通常 = 组 prompt 正文 + 镜头内容) */
  queryText?: string;
  /** embedding 模式的余弦下限(低于剔除),默认 0 = 不设限 */
  minSimilarity?: number;
  /**
   * H1 Planner 闸:false = 对症维(光影/氛围/动作等)keyword 零命中时**不**走 tag 兜底 —
   * tag 模式按热度返回会把「治愈清新」塞进紧张戏。默认 true(通用维:画质/稳定/主体纪律)。
   */
  allowTagFallback?: boolean;
}

export interface RetrievedEntry<T extends RetrievableKnowledgeEntry = RetrievableKnowledgeEntry> {
  entry: T;
  /** embedding=余弦值 / keyword=命中数 / tag=hitCount(口径不同,仅同 method 内可比) */
  score: number;
  method: 'embedding' | 'keyword' | 'tag';
}

/** 八维中文标签(渲染检索片段用 — knowledge contributor / 分镜侧注入共用) */
export const PROMPT_DIMENSION_LABEL: Record<string, string> = {
  SUBJECT: '主体',
  ACTION: '动作',
  SCENE: '场景',
  LIGHTING: '光影',
  CAMERA: '镜头',
  STYLE: '风格',
  QUALITY: '画质',
  CONSTRAINT: '稳定',
};

// ---------------------------------------------------------------------------
// 余弦相似度
// ---------------------------------------------------------------------------

/**
 * 余弦相似度 ∈ [-1, 1]。
 * 维数不一致(模型中途换了,旧向量未重算)/ 零范数 → 返回 0(该条目自然沉底,
 * 懒回填按 embeddingModel 对账后会重算 — 不抛错防一条坏向量废掉整次检索)。
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// tag 过滤
// ---------------------------------------------------------------------------

/**
 * tag 过滤语义:对 filter 的每个给定键,条目**无该键约束(缺失/空数组)= 通用,命中**;
 * 有约束则必须包含该值。例:family=['seedance'] 的条目只投喂 seedance 系。
 */
export function matchesTagFilter(tags: KnowledgeTags, filter?: RetrieveFilter): boolean {
  if (!filter) return true;
  const dims: Array<[string[] | undefined, string | undefined]> = [
    [tags.family, filter.family],
    [tags.style, filter.style],
    [tags.mood, filter.mood],
    [tags.era, filter.era],
  ];
  for (const [constraint, want] of dims) {
    if (!want) continue; // filter 未指定该键 → 不过滤
    if (!constraint || constraint.length === 0) continue; // 条目通用 → 命中
    if (!constraint.includes(want)) return false;
  }
  return true;
}

/** Prisma Json → KnowledgeTags 防御解析(非法形状回退空 = 通用条目) */
export function parseKnowledgeTags(tagsJson: unknown): KnowledgeTags {
  if (!tagsJson || typeof tagsJson !== 'object' || Array.isArray(tagsJson)) return {};
  const raw = tagsJson as Record<string, unknown>;
  const arr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : undefined;
  return {
    family: arr(raw.family),
    style: arr(raw.style),
    mood: arr(raw.mood),
    era: arr(raw.era),
    keywords: arr(raw.keywords),
  };
}

// ---------------------------------------------------------------------------
// 检索主函数
// ---------------------------------------------------------------------------

/**
 * 八维知识库 top-k 检索(纯函数)。
 *
 * 入参 entries 由调用方从 DB 取(按 projectId 全局+私有合取、enabled=true 预过滤可在
 * SQL 层做;这里再防御一遍)。返回按 score 降序的前 k 条。
 */
export function retrieveTopK<T extends RetrievableKnowledgeEntry>(
  entries: T[],
  opts: RetrieveOptions = {},
): Array<RetrievedEntry<T>> {
  const k = Math.max(1, opts.k ?? 3);
  const pool = entries.filter(
    (e) =>
      e.enabled !== false &&
      (!opts.dimension || e.dimension === opts.dimension) &&
      matchesTagFilter(e.tags, opts.filter),
  );
  if (pool.length === 0) return [];

  // 1) embedding 模式:查询向量在手,且池里有已回填向量的条目
  const queryVec = opts.queryEmbedding;
  if (queryVec && queryVec.length > 0) {
    const withVec = pool.filter((e) => Array.isArray(e.embedding) && e.embedding.length > 0);
    if (withVec.length > 0) {
      const minSim = opts.minSimilarity ?? 0;
      const scored = withVec
        .map((entry) => ({
          entry,
          score: cosineSimilarity(queryVec, entry.embedding as number[]),
          method: 'embedding' as const,
        }))
        .filter((r) => r.score >= minSim)
        .sort(
          (a, b) =>
            b.score - a.score ||
            weightOf(b.entry) - weightOf(a.entry) ||
            hitOf(b.entry) - hitOf(a.entry),
        );
      return scored.slice(0, k);
      // 注:池里"无向量"条目本轮不参赛(分数口径不可混)— 懒回填补完即自动参赛
    }
  }

  // 2) keyword 模式:条目 keywords/title 在 queryText 中的命中计分
  const queryText = (opts.queryText ?? '').trim();
  if (queryText.length > 0) {
    const scored = pool
      .map((entry) => ({
        entry,
        score: keywordHits(entry, queryText),
        method: 'keyword' as const,
      }))
      .filter((r) => r.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          weightOf(b.entry) - weightOf(a.entry) ||
          hitOf(b.entry) - hitOf(a.entry),
      );
    if (scored.length > 0) return scored.slice(0, k);
  }

  // 3) tag 模式:通用维(画质/稳定等)天然无 keyword 命中 → tag 过滤后按 H3 权重排序
  //    (weight 主序,hitCount 热度破并列)。对症维(allowTagFallback=false)宁缺毋滥,零命中返回空。
  if (opts.allowTagFallback === false) return [];
  return pool
    .map((entry) => ({ entry, score: weightOf(entry), method: 'tag' as const }))
    .sort((a, b) => b.score - a.score || hitOf(b.entry) - hitOf(a.entry))
    .slice(0, k);
}

function weightOf(e: RetrievableKnowledgeEntry): number {
  return Number.isFinite(e.weight) ? (e.weight as number) : 1;
}

/** keyword 命中数:条目 keywords(+title 整串)在查询文本中出现的个数 */
function keywordHits(entry: RetrievableKnowledgeEntry, queryText: string): number {
  let hits = 0;
  for (const kw of entry.tags.keywords ?? []) {
    if (kw && queryText.includes(kw)) hits++;
  }
  if (entry.title && queryText.includes(entry.title)) hits++;
  return hits;
}

function hitOf(e: RetrievableKnowledgeEntry): number {
  return e.hitCount ?? 0;
}
