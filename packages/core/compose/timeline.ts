/**
 * 成片时间线 — M1(蓝图 docs/06 §3 M1)
 *
 * 把一集的生成段(ShotGroup)按**组内首镜 positionIdx**排成时间线(对齐 aigc-overview
 * listGroups 的排序语义),每组取「**最新未拒成功 take**」(createdAt 最新的
 * action=VIDEO + status=SUCCESS + rejected=false + 有 outputMediaId 的 attempt —
 * 与工作台视频预览展示的当前 take 一致;schema 无"最终采纳"字段,这是 v1 确定性规则)。
 * 没有合格 take 的组列入 gaps(allowGaps=false 时阻断成片)。
 *
 * 无镜头的空组不进时间线(无时间轴位置、无内容,是编辑期遗留噪音)。
 */
import type { PrismaClient } from '@ss/db';

export interface TimelineTake {
  attemptId: string;
  mediaId: string;
  createdAt: Date;
}

export interface TimelineEntry {
  groupId: string;
  /** 组编号(如 "1-8"),展示/报错用 */
  number: string;
  firstShotPos: number;
  /** 组首镜所属场(SRT 台词按场切分到组;镜头跨场时以首镜为准) */
  sceneId: string | null;
  /** 组内镜头原文(positionIdx 升序) */
  shotContents: string[];
  take: TimelineTake | null;
}

export interface EpisodeTimeline {
  /** 全部有镜头的组,按首镜 positionIdx 升序 */
  entries: TimelineEntry[];
  /** 有合格 take 的组(成片实际素材) */
  ready: TimelineEntry[];
  /** 缺 take 的组 */
  gaps: Array<{ groupId: string; number: string }>;
}

interface AttemptLike {
  id: string;
  outputMediaId: string | null;
  createdAt: Date;
}

/** 纯函数:从某组的候选 attempts(已按 createdAt desc 排序)挑当前 take */
export function pickLatestTake(attemptsDesc: AttemptLike[]): TimelineTake | null {
  const hit = attemptsDesc.find((a) => !!a.outputMediaId);
  return hit
    ? { attemptId: hit.id, mediaId: hit.outputMediaId!, createdAt: hit.createdAt }
    : null;
}

/** 纯函数:按组内首镜位置排序并组装时间线(无镜头的组被排除) */
export function assembleTimeline(
  groups: Array<{ id: string; number: string }>,
  shots: Array<{
    groupId: string | null;
    positionIdx: number;
    content: string;
    sceneId?: string | null;
  }>,
  attemptsByGroup: Map<string, AttemptLike[]>,
): EpisodeTimeline {
  const shotsByGroup = new Map<
    string,
    Array<{ positionIdx: number; content: string; sceneId?: string | null }>
  >();
  for (const s of shots) {
    if (!s.groupId) continue;
    const list = shotsByGroup.get(s.groupId);
    if (list) list.push(s);
    else shotsByGroup.set(s.groupId, [s]);
  }

  const entries: TimelineEntry[] = [];
  for (const g of groups) {
    const groupShots = shotsByGroup.get(g.id);
    if (!groupShots || groupShots.length === 0) continue; // 空组不进时间线
    groupShots.sort((a, b) => a.positionIdx - b.positionIdx);
    entries.push({
      groupId: g.id,
      number: g.number,
      firstShotPos: groupShots[0]!.positionIdx,
      sceneId: groupShots[0]!.sceneId ?? null,
      shotContents: groupShots.map((s) => s.content),
      take: pickLatestTake(attemptsByGroup.get(g.id) ?? []),
    });
  }
  entries.sort((a, b) => a.firstShotPos - b.firstShotPos);

  return {
    entries,
    ready: entries.filter((e) => e.take !== null),
    gaps: entries
      .filter((e) => e.take === null)
      .map((e) => ({ groupId: e.groupId, number: e.number })),
  };
}

/** 拉库组装一集的成片时间线(router 预检与 worker 处理共用同一真相) */
export async function buildEpisodeTimeline(
  prisma: PrismaClient,
  episodeId: string,
): Promise<EpisodeTimeline> {
  const [groups, shots, attempts] = await Promise.all([
    prisma.shotGroup.findMany({
      where: { episodeId, deletedAt: null },
      select: { id: true, number: true },
    }),
    prisma.shot.findMany({
      where: { episodeId, groupId: { not: null }, deletedAt: null },
      select: { groupId: true, positionIdx: true, content: true, sceneId: true },
      orderBy: { positionIdx: 'asc' },
    }),
    prisma.generationAttempt.findMany({
      where: {
        episodeId,
        action: 'VIDEO',
        status: 'SUCCESS',
        rejected: false,
        shotGroupId: { not: null },
        outputMediaId: { not: null },
      },
      select: { id: true, shotGroupId: true, outputMediaId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const attemptsByGroup = new Map<string, AttemptLike[]>();
  for (const a of attempts) {
    const gid = a.shotGroupId!;
    const list = attemptsByGroup.get(gid);
    if (list) list.push(a);
    else attemptsByGroup.set(gid, [a]);
  }

  return assembleTimeline(groups, shots, attemptsByGroup);
}
