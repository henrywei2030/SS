/**
 * M6 优化上下文装配 — 一次性把 group/shots/bindings/style/上组 拉齐,
 * contributor 只读渲染(避免每个 contributor 各自查库的 N 次往返)。
 */
import type { PrismaClient } from '@ss/db';

import { kindFromUsage, tokenFor } from '../storyboard/index.js';

import { detectProviderFamily } from './fallback-template.js';
import type { OptimizeContext, ProviderFamily } from './types.js';

/** 资产基础提示词进上下文前的截断(控优化器输入体积) */
const ASSET_BRIEF_MAX = 160;

export async function loadOptimizeContext(
  prisma: PrismaClient,
  args: {
    group: {
      id: string;
      number: string;
      prompt: string;
      durationS: number;
      episodeId: string;
      projectId: string;
      positionIdx: number;
    };
    /** H1:发起人(knowledge contributor 的 embedding 调用记账归属) */
    userId: string;
    /** 目标视频 provider(binding.shot.video.providerId)— 缺省按 generic 风格优化 */
    targetProviderId?: string | null;
    providerFamilyOverride?: ProviderFamily;
  },
): Promise<OptimizeContext> {
  const { group } = args;

  const [shots, dbBindings, project, prevGroupRow] = await Promise.all([
    prisma.shot.findMany({
      where: { groupId: group.id, deletedAt: null },
      orderBy: { positionIdx: 'asc' },
      select: {
        positionIdx: true,
        framing: true,
        angle: true,
        movement: true,
        lighting: true,
        sound: true,
        content: true,
        durationS: true,
        priority: true,
        sceneId: true,
      },
    }),
    prisma.assetUsageBinding.findMany({
      where: { shotGroupId: group.id, deletedAt: null },
      orderBy: { refSlotIdx: 'asc' },
      select: {
        refSlotIdx: true,
        usageType: true,
        asset: { select: { id: true, name: true, type: true, prompt: true } },
      },
    }),
    prisma.project.findUnique({
      where: { id: group.projectId },
      include: { style: true },
    }),
    prisma.shotGroup.findFirst({
      where: {
        episodeId: group.episodeId,
        deletedAt: null,
        positionIdx: { lt: group.positionIdx },
      },
      orderBy: { positionIdx: 'desc' },
      select: { id: true, number: true, prompt: true },
    }),
  ]);

  // 上组末镜 + 场景同异(衔接 contributor 素材;口径同 M3b 尾帧链的 sceneId 断链判定)
  let prevGroup: OptimizeContext['prevGroup'] = null;
  if (prevGroupRow) {
    const [prevLastShot, curFirstShot] = await Promise.all([
      prisma.shot.findFirst({
        where: { groupId: prevGroupRow.id, deletedAt: null },
        orderBy: { positionIdx: 'desc' },
        select: { content: true, sceneId: true },
      }),
      prisma.shot.findFirst({
        where: { groupId: group.id, deletedAt: null },
        orderBy: { positionIdx: 'asc' },
        select: { sceneId: true },
      }),
    ]);
    const sameScene =
      !prevLastShot?.sceneId ||
      !curFirstShot?.sceneId ||
      prevLastShot.sceneId === curFirstShot.sceneId;
    prevGroup = {
      number: prevGroupRow.number,
      prompt: prevGroupRow.prompt,
      lastShotContent: prevLastShot?.content ?? null,
      sameScene,
    };
  }

  // 绑定按 assetId 去重(同资产多 usage 取首条带槽位的)
  const seenAsset = new Set<string>();
  const assets: OptimizeContext['assets'] = [];
  for (const b of dbBindings) {
    if (seenAsset.has(b.asset.id)) continue;
    seenAsset.add(b.asset.id);
    const brief = (b.asset.prompt ?? '').replace(/\s+/g, ' ').trim();
    assets.push({
      name: b.asset.name,
      type: b.asset.type,
      token: b.refSlotIdx !== null ? tokenFor(kindFromUsage(b.usageType), b.refSlotIdx) : null,
      promptBrief: brief.length > ASSET_BRIEF_MAX ? `${brief.slice(0, ASSET_BRIEF_MAX)}…` : brief,
    });
  }

  return {
    prisma,
    userId: args.userId,
    group: {
      id: group.id,
      number: group.number,
      prompt: group.prompt,
      durationS: group.durationS,
      episodeId: group.episodeId,
      projectId: group.projectId,
    },
    shots: shots.map((s) => ({
      positionIdx: s.positionIdx,
      framing: s.framing,
      angle: s.angle,
      movement: s.movement,
      lighting: s.lighting,
      sound: s.sound,
      content: s.content,
      durationS: s.durationS,
      priority: s.priority,
    })),
    assets,
    style: project?.style
      ? {
          characterPrompt: project.style.characterPrompt,
          scenePrompt: project.style.scenePrompt,
          propPrompt: project.style.propPrompt,
          forbiddenWords: project.style.forbiddenWords ?? [],
        }
      : null,
    prevGroup,
    providerFamily:
      args.providerFamilyOverride ?? detectProviderFamily(args.targetProviderId),
  };
}
