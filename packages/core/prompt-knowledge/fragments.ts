/**
 * H2(docs/07 §2 Repair):按指定维度取知识片段 — 定向修复"只喂不及格维度+对应片段"用。
 *
 * 与 contributor 的差异:维度由判官/硬门点名(不走 Planner),且允许 tag 兜底 —
 * 该维已被判不及格,宁可给通用素材也不空手修。
 */
import type { PrismaClient } from '@ss/db';

import { parseKnowledgeTags, PROMPT_DIMENSION_LABEL, retrieveTopK } from './retrieval.js';

export interface DimFragment {
  id: string;
  dimension: string;
  line: string; // `- [维度] 标题:内容`
}

export async function retrieveFragmentsForDims(
  prisma: PrismaClient,
  args: {
    dims: string[];
    queryText: string;
    projectId: string;
    family: string;
    kPerDim?: number;
  },
): Promise<DimFragment[]> {
  if (args.dims.length === 0) return [];
  const rows = await prisma.promptKnowledge.findMany({
    where: {
      enabled: true,
      dimension: { in: args.dims as never },
      OR: [{ projectId: null }, { projectId: args.projectId }],
    },
    select: {
      id: true,
      dimension: true,
      title: true,
      content: true,
      tagsJson: true,
      hitCount: true,
      weight: true,
    },
  });
  if (rows.length === 0) return [];
  const entries = rows.map((r) => ({
    id: r.id,
    dimension: r.dimension as string,
    title: r.title,
    content: r.content,
    tags: parseKnowledgeTags(r.tagsJson),
    hitCount: r.hitCount,
    weight: r.weight,
    enabled: true,
  }));
  const out: DimFragment[] = [];
  for (const dimension of args.dims) {
    const hits = retrieveTopK(entries, {
      dimension,
      k: args.kPerDim ?? 2,
      filter: { family: args.family },
      queryText: args.queryText,
      allowTagFallback: true, // 修复语境:该维已不及格,通用素材也比空手强
    });
    for (const h of hits) {
      const label = PROMPT_DIMENSION_LABEL[h.entry.dimension] ?? h.entry.dimension;
      out.push({ id: h.entry.id, dimension: h.entry.dimension, line: `- [${label}] ${h.entry.title}:${h.entry.content}` });
    }
  }
  return out;
}
