/**
 * 资产草稿跨块合并去重(2026-06-08 · 完整剧本拆解「按集分块」)
 *
 * 按集分块拆解时,同一人物 / 场景 / 道具会在多个块各出现一次 → 需跨块合并为一条:
 *   - 去重键:type + (archetypeKey || name)(小写),同键视为同一资产
 *   - episodes / alias / tags:并集
 *   - description / prompt / bio:取更长者(更丰富 = 更完整的设定)
 *   - 其余标量字段(gender / age / characterRole / matchedAssetId …):保留首个出现的非空值
 *
 * 纯函数,无副作用,前端(分块累积)与后端共用。不依赖 node / server。
 */

export interface MergeableDraft {
  type: 'CHARACTER' | 'SCENE' | 'PROP';
  name: string;
  archetypeKey?: string;
  episodes?: number[];
  alias?: string[];
  tags?: string[];
  description?: string | null;
  prompt?: string | null;
  bio?: string | null;
}

/** 去重键:同 type 下按 archetypeKey 主干(无则 name)归并 */
export function assetDraftDedupKey(d: MergeableDraft): string {
  const stem = (d.archetypeKey?.trim() || d.name.trim()).toLowerCase();
  return `${d.type}::${stem}`;
}

function longer(a?: string | null, b?: string | null): string {
  const av = (a ?? '').trim();
  const bv = (b ?? '').trim();
  return av.length >= bv.length ? av : bv;
}

function unionStr(a: string[] | undefined, b: string[] | undefined, cap: number): string[] {
  return [
    ...new Set([...(a ?? []), ...(b ?? [])].map((s) => s.trim()).filter(Boolean)),
  ].slice(0, cap);
}

function unionNum(a?: number[], b?: number[]): number[] {
  return [...new Set([...(a ?? []), ...(b ?? [])])].sort((x, y) => x - y);
}

/**
 * 把 incoming 合并进 acc(去重 + 字段合并),返回新数组(不改原数组)。
 *
 * 合并规则见文件头。泛型 T 保留草稿上的额外字段(matchedAssetId / gender / age …):
 *   spread 顺序 `{...next, ...prev}` 让 prev(首个出现)的标量优先,
 *   prev 缺失的键由 next 补上(键不存在不覆盖)→ 实现"保留首个非空"。
 */
export function mergeAssetDrafts<T extends MergeableDraft>(acc: T[], incoming: T[]): T[] {
  const out = [...acc];
  const idx = new Map<string, number>();
  out.forEach((d, i) => idx.set(assetDraftDedupKey(d), i));

  for (const next of incoming) {
    const key = assetDraftDedupKey(next);
    const at = idx.get(key);
    if (at === undefined) {
      idx.set(key, out.length);
      out.push(next);
      continue;
    }
    const prev = out[at]!;
    out[at] = {
      ...next, // 先铺 incoming(带其标量),
      ...prev, // 再用 prev 覆盖(首个出现优先;prev 缺失的键由 next 补)
      // 显式合并(覆盖上面 spread):并集 + 取更丰富
      episodes: unionNum(prev.episodes, next.episodes),
      alias: unionStr(prev.alias, next.alias, 5),
      tags: unionStr(prev.tags, next.tags, 30),
      description: longer(prev.description, next.description),
      prompt: longer(prev.prompt, next.prompt),
      bio: longer(prev.bio, next.bio),
    } as T;
  }
  return out;
}
