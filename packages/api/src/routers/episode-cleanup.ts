import type { Prisma, PrismaClient } from '@ss/db';

/**
 * 七二第六波(用户反馈:剧本拆解/分镜界面冒出「99集」幽灵内容):
 * 删除/清空集后,把各资产 Asset.episodes[] 修剪为「项目现存的集号」。
 *
 * 根因 — Asset.episodes 是独立 Int[] 字段(无外键约束),删 Episode 不级联;历史 LLM 拆解
 * (core/asset/breakdown.ts parseDraftArray)可能写入项目里并不存在的集号(99 等),
 * 删剧本/集后这些孤儿集号残留,在剧本拆解 / 分镜 / 美术总览按 episodes[] 展示时显示为幽灵集。
 *
 * 只删孤儿集号(不在 project 现存 Episode.number 集合内),保留有效集号。返回被修剪的资产数。
 * 幂等、无副作用 — 删除链路收尾调用,也可单独跑做存量清理。
 */
export async function pruneOrphanAssetEpisodes(
  db: Prisma.TransactionClient | PrismaClient,
  projectId: string,
): Promise<number> {
  const validNumbers = new Set(
    (
      await db.episode.findMany({
        where: { projectId, deletedAt: null },
        select: { number: true },
      })
    ).map((e) => e.number),
  );
  const assets = await db.asset.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true, episodes: true },
  });
  let touched = 0;
  for (const a of assets) {
    const pruned = a.episodes.filter((n) => validNumbers.has(n));
    if (pruned.length !== a.episodes.length) {
      await db.asset.update({
        where: { id: a.id },
        data: { episodes: { set: pruned } },
      });
      touched += 1;
    }
  }
  return touched;
}
