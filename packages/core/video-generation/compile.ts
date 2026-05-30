import type { PrismaClient } from '@ss/db';
import type { Prisma } from '@ss/db';
import {
  compileShotGroupVideoPrompt,
  kindFromUsage,
  type VideoReference,
} from '../storyboard/index.js';
import { pickAssetMediaId } from '../asset/index.js';

/**
 * 编译视频提示词 — 读 project style + bindings + media + 构造 refs + 调 compileShotGroupVideoPrompt
 *
 * 三十六收工 R2 完整推进:从 aigc.ts:1342-1474 抽出(132 行 → 1 函数调用)。
 *
 * 业务规则:
 *   - 7 槽位 fallback 链(W1-W5 audit P1 followup P1-6):portrait → threeView → mainMedia 等
 *   - Relay provider 用 asset:// URL 免文件重传(Phase 1.5 P0-5)
 *   - 合规守卫(若 requireComplianceForVideo)前置 CHARACTER 资产 APPROVED check —
 *     **抽出后由 router 调 helper 后再做 compliance check**(因为 helper return 含 dbBindings)
 *
 * @returns compiled result + isRelayProvider(供后续 refImageUrls 决策)+ blockedChars
 */
export async function compileVideoPromptForGroup(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    group: {
      id: string;
      prompt: string;
      durationS: number;
      episode: { projectId: string };
    };
    providerId: string;
    durationS: number;
    aspectRatio: string;
    extraInstruction?: string;
    extraNegative?: string[];
  },
): Promise<{
  compiled: ReturnType<typeof compileShotGroupVideoPrompt>;
  isRelayProvider: boolean;
  characterBindingsForCompliance: {
    assetName: string;
    complianceStatus: string;
  }[];
}> {
  // 1. 取项目风格
  const project = await tx.project.findUnique({
    where: { id: args.group.episode.projectId },
    include: { style: true },
  });

  // W1-W5 audit P1 followup(P1-6):查全 7 槽位 mediaId
  const dbBindings = await tx.assetUsageBinding.findMany({
    where: { shotGroupId: args.group.id, deletedAt: null, refSlotIdx: { not: null } },
    orderBy: { refSlotIdx: 'asc' },
    include: {
      asset: {
        select: {
          id: true,
          name: true,
          type: true,
          portraitMediaId: true,
          threeViewMediaId: true,
          sceneMainMediaId: true,
          sceneFrontMediaId: true,
          sceneLeftMediaId: true,
          sceneRightMediaId: true,
          sceneBackMediaId: true,
          panoramaMediaId: true,
          mainMediaId: true,
          voiceMediaId: true,
          complianceStatus: true,
        },
      },
    },
  });

  // 把 CHARACTER 资产的 complianceStatus 拎出来供 router 做前置守卫
  // 注:schema 定义 complianceStatus ComplianceStatus @default(NOT_REQUIRED) — 非空 + 有默认
  //   `?? 'UNKNOWN'` 是防御性兜底,实际 prisma generated type 非空,此分支不触发
  const characterBindingsForCompliance = dbBindings
    .filter((b) => b.asset.type === 'CHARACTER')
    .map((b) => ({
      assetName: b.asset.name,
      complianceStatus: b.asset.complianceStatus ?? 'UNKNOWN',
    }));

  const mediaIds = new Set<string>();
  for (const b of dbBindings) {
    for (const id of [
      b.asset.portraitMediaId,
      b.asset.threeViewMediaId,
      b.asset.sceneMainMediaId,
      b.asset.sceneFrontMediaId,
      b.asset.sceneLeftMediaId,
      b.asset.sceneRightMediaId,
      b.asset.sceneBackMediaId,
      b.asset.panoramaMediaId,
      b.asset.mainMediaId,
      b.asset.voiceMediaId,
    ]) {
      if (id) mediaIds.add(id);
    }
  }
  const medias =
    mediaIds.size > 0
      ? await tx.mediaItem.findMany({
          where: { id: { in: Array.from(mediaIds) } },
          // Phase 1.5 P0-5:meta 含 relayAssetUrl 时 provider=relay-* 优先用 asset://(免重传)
          select: { id: true, cdnUrl: true, meta: true },
        })
      : [];
  // Phase 1.5 P0-5:provider 是 relay-* (OpenAI 兼容中转站)时优先用 meta.relayAssetUrl
  const isRelayProvider = args.providerId.startsWith('relay-');
  const mediaMap = new Map(
    medias.map((m) => {
      let chosenUrl: string | null = m.cdnUrl;
      if (
        isRelayProvider &&
        m.meta &&
        typeof m.meta === 'object' &&
        !Array.isArray(m.meta)
      ) {
        const relayUrl = (m.meta as Record<string, unknown>).relayAssetUrl;
        if (typeof relayUrl === 'string' && relayUrl.startsWith('asset://')) {
          chosenUrl = relayUrl;
        }
      }
      return [m.id, chosenUrl] as const;
    }),
  );

  // W1-W5 audit P1 followup(P1-6):全 7 槽位 fallback 链
  const refs: VideoReference[] = dbBindings.map((b) => {
    const kind = kindFromUsage(b.usageType);
    const chosen = pickAssetMediaId(b.asset, kind);
    return {
      refSlotIdx: b.refSlotIdx!,
      kind,
      assetId: b.asset.id,
      name: b.asset.name,
      mediaUrl: chosen ? (mediaMap.get(chosen) ?? null) : null,
    };
  });

  const compiled = compileShotGroupVideoPrompt({
    text: args.group.prompt,
    durationS: args.durationS,
    references: refs,
    style: project?.style
      ? {
          characterPrompt: project.style.characterPrompt,
          scenePrompt: project.style.scenePrompt,
          propPrompt: project.style.propPrompt,
          forbiddenWords: project.style.forbiddenWords,
        }
      : null,
    aspectRatio: args.aspectRatio,
    extraInstruction: args.extraInstruction,
    extraNegative: args.extraNegative,
  });

  return { compiled, isRelayProvider, characterBindingsForCompliance };
}
