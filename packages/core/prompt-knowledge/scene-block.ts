/**
 * H1(docs/07 §5):分镜侧轻量知识注入 — storyboard 生成 user prompt 的【创作知识】块。
 *
 * "轻量"纪律(与优化器侧 knowledge contributor 的区别):
 *   - 只走 keyword/tag 检索,**不碰 embedding**(分镜是批量 LLM 调用,不为注入加外呼/延迟)
 *   - 项目私有条目(D-E 世界观:projectId 作用域)**无条件全注入**(capped)— 用户给项目写的
 *     年代/世界观设定,每一场分镜都该看到,不靠关键词碰运气
 *   - 全局条目按场原文对症检索(ACTION 翻译对 / SCENE 年代氛围 / LIGHTING 时段),
 *     零命中不硬塞(allowTagFallback=false)
 *   - 总量 ≤ maxItems(默认 8)≈ 400 字,不挤占剧本原文的注意力
 *
 * 镜头语言/画质/稳定不在此注入:通则由 storyboard_main v3 模板承载,
 * 强化词由编译期 enhancerPart 追加(H0)— 三层各管一段,不重复。
 */
import type { PrismaClient } from '@ss/db';

import {
  parseKnowledgeTags,
  PROMPT_DIMENSION_LABEL,
  retrieveTopK,
  type RetrievableKnowledgeEntry,
} from './retrieval.js';

/** 分镜侧检索的全局维(对症):动作翻译对 / 场景年代氛围 / 光影时段 */
const SCENE_SIDE_DIMENSIONS = ['ACTION', 'SCENE', 'LIGHTING'] as const;
const PER_DIMENSION_K = 2;
/** 项目私有(世界观)条目上限 — 防项目堆条目挤爆 prompt */
const PROJECT_ENTRIES_CAP = 3;

export async function buildSceneKnowledgeBlock(
  prisma: PrismaClient,
  args: {
    projectId: string;
    /** 场原文(keyword 匹配源)— router 传 Scene.content */
    sceneText: string;
    /** 总条目上限,默认 8 */
    maxItems?: number;
  },
): Promise<string | null> {
  const maxItems = Math.max(1, args.maxItems ?? 8);
  const sceneText = args.sceneText.slice(0, 4000);

  const rows = await prisma.promptKnowledge.findMany({
    where: {
      enabled: true,
      OR: [
        // 项目私有条目不限维度(世界观可挂任意维,常见 SCENE/SUBJECT)
        { projectId: args.projectId },
        { projectId: null, dimension: { in: SCENE_SIDE_DIMENSIONS as unknown as never } },
      ],
    },
    select: {
      id: true,
      dimension: true,
      title: true,
      content: true,
      tagsJson: true,
      projectId: true,
      hitCount: true,
      weight: true,
    },
  });
  if (rows.length === 0) return null;

  const toEntry = (r: (typeof rows)[number]): RetrievableKnowledgeEntry => ({
    id: r.id,
    dimension: r.dimension as string,
    title: r.title,
    content: r.content,
    tags: parseKnowledgeTags(r.tagsJson),
    hitCount: r.hitCount,
    weight: r.weight,
    enabled: true,
  });

  const lines: string[] = [];
  const usedIds: string[] = [];
  const push = (e: RetrievableKnowledgeEntry): void => {
    const label = PROMPT_DIMENSION_LABEL[e.dimension] ?? e.dimension;
    lines.push(`- [${label}] ${e.title}:${e.content}`);
    usedIds.push(e.id);
  };

  // 1) 项目世界观条目:无条件注入(capped,hitCount 热度序)
  rows
    .filter((r) => r.projectId !== null)
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, PROJECT_ENTRIES_CAP)
    .forEach((r) => push(toEntry(r)));

  // 2) 全局对症条目:逐维 keyword 检索(零命中不硬塞)
  const globalEntries = rows.filter((r) => r.projectId === null).map(toEntry);
  for (const dimension of SCENE_SIDE_DIMENSIONS) {
    if (lines.length >= maxItems) break;
    const out = retrieveTopK(globalEntries, {
      dimension,
      k: PER_DIMENSION_K,
      queryText: sceneText,
      allowTagFallback: false,
    });
    for (const hit of out) {
      if (lines.length >= maxItems) break;
      push(hit.entry);
    }
  }
  if (lines.length === 0) return null;

  // 飞轮数据(H3 同口径):命中计数(失败不阻塞分镜生成)
  try {
    await prisma.promptKnowledge.updateMany({
      where: { id: { in: usedIds } },
      data: { hitCount: { increment: 1 }, lastUsedAt: new Date() },
    });
  } catch {
    /* 计数失败无碍 */
  }

  return `【创作知识】(按需吸收进分镜设计与提示词,与剧本事实冲突时以剧本为准)\n${lines.slice(0, maxItems).join('\n')}`;
}
