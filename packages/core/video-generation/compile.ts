import type { PrismaClient } from '@ss/db';
import type { Prisma } from '@ss/db';
import { getStorageAdapter } from '@ss/adapters/storage';
import { characterNeedsVoice } from '@ss/shared';
import {
  compileShotGroupVideoPrompt,
  kindFromUsage,
  type VideoReference,
} from '../storyboard/index.js';
import { extractVoiceLabel, pickAssetMediaId } from '../asset/index.js';

/** 六八:人物参考声线(不走 @音频N token 闸门,人在声在) */
export interface CharacterVoiceRef {
  assetId: string;
  name: string;
  mediaUrl: string;
}

/** 六八:绑定了人物但拿不到参考声线(没配 voiceMediaId / 媒体 URL 解析不出)— UI 提示补声线 */
export interface CharacterVoiceMissing {
  assetId: string;
  name: string;
}

/** 六八下:人物身份级图参考(形象 + 三视图,人在图在,不依赖 @token;按 assetId 聚合) */
export interface CharacterImageRef {
  assetId: string;
  name: string;
  kind: 'portrait' | 'three_view';
  mediaUrl: string;
}

/**
 * H0(docs/07):强化词默认值 — 八要素文章模板("质量保险丝"五类中的画质/稳定两类)。
 * ⚠️ 与 packages/db/prisma/seed.ts 的 prompt.enhancer.* 设置默认值**双写**,改一处须同步另一处。
 * 语义:SystemSetting 行缺失(老库未 db:sync)= 用这里的默认;行存在但值为空 = 用户显式关闭。
 */
export const DEFAULT_ENHANCER_QUALITY = '4K超高清、电影质感、细节丰富';
export const DEFAULT_ENHANCER_STABILITY =
  '面部清晰不变形、人体比例自然、动作流畅连贯无跳帧、五官一致';

/**
 * 六八(人到声必到):从 group 绑定里收集人物参考声线 — 纯函数,单测覆盖。
 *
 * 规则:**只要人物绑定在该生成段(不论 usageType / 是否被 @token 引用),其 voiceMediaId
 * 必然进参考声线**。这是身份级关联(人物形象和声音的一致性),区别于位置级的 @图片N token。
 * 同一人物多条 binding(APPEAR + SOUND_VOICE 等)按 assetId 去重。
 *
 * 范围(六八下,用户定调):只有主演/配角需要声线 —
 *   - voiceRefs:有声线就带(群演被手动配了声线 = 明确意图,照常附带)
 *   - voiceMissing:只对「需要声线」的角色提示缺失(群演/未分类没声线不唠叨)
 */
export function collectCharacterVoiceInfo(
  bindings: Array<{
    asset: {
      id: string;
      name: string;
      type: string;
      voiceMediaId: string | null;
      characterRole?: string | null;
    };
  }>,
  mediaUrlOf: (mediaId: string) => string | null,
): { voiceRefs: CharacterVoiceRef[]; voiceMissing: CharacterVoiceMissing[] } {
  const voiceRefs: CharacterVoiceRef[] = [];
  const voiceMissing: CharacterVoiceMissing[] = [];
  const seen = new Set<string>();
  for (const b of bindings) {
    if (b.asset.type !== 'CHARACTER' || seen.has(b.asset.id)) continue;
    seen.add(b.asset.id);
    const url = b.asset.voiceMediaId ? mediaUrlOf(b.asset.voiceMediaId) : null;
    if (url) {
      voiceRefs.push({ assetId: b.asset.id, name: b.asset.name, mediaUrl: url });
    } else if (characterNeedsVoice(b.asset.characterRole)) {
      voiceMissing.push({ assetId: b.asset.id, name: b.asset.name });
    }
  }
  return { voiceRefs, voiceMissing };
}

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
 *   - 六八(人到声必到):绑定 CHARACTER 的 voiceMediaId 一律进 voiceRefs(替代五七-3 的
 *     幽灵 AUDIO 引用 — 旧实现共用图片 refSlotIdx,被 @音频N token 闸门挡死从未实际生效,
 *     且与真音频 binding 的 slot 编号可能撞号)。SOUND_VOICE 等显式音频 binding 仍走 token。
 *
 * @returns compiled result + voiceRefs/voiceMissing + isRelayProvider + blockedChars
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
    /**
     * 六八:声音设定描述(profileJson.voiceLabel)编进 prompt【声线】段。
     * 仅 generateAudio=true 时传 true(无声生成塞声线描述浪费 token)。
     */
    includeVoiceDescriptions?: boolean;
  },
): Promise<{
  compiled: ReturnType<typeof compileShotGroupVideoPrompt>;
  /** 六八:人物参考声线(router 并进 refAudioUrls;preview 给 UI 展示「将自动附带」) */
  voiceRefs: CharacterVoiceRef[];
  /** 六八:绑定了人物但缺参考声线(UI 提示去美术工坊生成) */
  voiceMissing: CharacterVoiceMissing[];
  /** 六八下:人物身份级图参考(形象+三视图全送,router 并进 refImageUrls 去重) */
  characterImageRefs: CharacterImageRef[];
  isRelayProvider: boolean;
  characterBindingsForCompliance: {
    assetName: string;
    complianceStatus: string;
  }[];
  // 项目类型 —— router 据此只对 AI_REAL(伪真人剧)启用合规门禁(动漫/国漫等不做合规)
  projectType: string | undefined;
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
          characterRole: true,
          complianceStatus: true,
          profileJson: true,
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

  // 七二·跨集换装:本组所属集若有造型覆盖(AssetVersion),非空槽位顶替 Asset 默认形象 —
  //   就地改写 dbBindings[].asset 的槽位字段,下游 mediaIds 收集 / pickAssetMediaId /
  //   characterImageRefs 自动用覆盖图(按 group.id 主键轻查 episodeId,零调用方改动)。
  //   ⚠️ 防御:换装是增量增强,查询/覆盖任何失败都只降级为"用默认形象",绝不阻断核心视频编译。
  //   (典型环境态:运行中进程持迁移前的旧 prisma client、表迁移未到位 — 不能因此让所有视频生成被拒)
  try {
    const grp = await tx.shotGroup.findUnique({
      where: { id: args.group.id },
      select: { episodeId: true },
    });
    if (grp?.episodeId) {
      const bindingAssetIds = Array.from(new Set(dbBindings.map((b) => b.asset.id)));
      const outfits =
        bindingAssetIds.length > 0
          ? await tx.assetVersion.findMany({
              where: { episodeId: grp.episodeId, assetId: { in: bindingAssetIds } },
              select: {
                assetId: true,
                portraitMediaId: true,
                threeViewMediaId: true,
                sceneMainMediaId: true,
              },
            })
          : [];
      const outfitMap = new Map(outfits.map((o) => [o.assetId, o]));
      for (const b of dbBindings) {
        const ov = outfitMap.get(b.asset.id);
        if (!ov) continue;
        if (ov.portraitMediaId) b.asset.portraitMediaId = ov.portraitMediaId;
        if (ov.threeViewMediaId) b.asset.threeViewMediaId = ov.threeViewMediaId;
        if (ov.sceneMainMediaId) b.asset.sceneMainMediaId = ov.sceneMainMediaId;
      }
    }
  } catch (err) {
    console.error(
      '[compileVideoPromptForGroup] 按集造型覆盖查询失败,降级用默认形象(不阻断视频编译):',
      err,
    );
  }

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
          // 六八:storageKey 供声线媒体签名 URL 兜底(TTS 本地生成的音频无 cdnUrl)
          select: { id: true, cdnUrl: true, meta: true, storageKey: true },
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
  // (六八:五七-3 的幽灵 AUDIO 追加已移除 — 见下方 voiceRefs,不再依赖 token 闸门)
  const refs: VideoReference[] = dbBindings.map((b) => {
    const kind = kindFromUsage(b.usageType);
    const chosen = pickAssetMediaId(b.asset, kind);
    return {
      refSlotIdx: b.refSlotIdx!,
      kind,
      assetId: b.asset.id,
      name: b.asset.name,
      mediaUrl: chosen ? (mediaMap.get(chosen) ?? null) : null,
      required: b.required, // 七二 ⑤-2:可缺引用缺图不硬拦(尾帧自动链等)
    };
  });

  // 六八:声线媒体 URL 三级兜底 — relayAssetUrl(relay 商)> cdnUrl > 12h 签名 URL。
  //   TTS 本地生成 / 上传的音频常只有 MinIO storageKey(cdnUrl=null),没有兜底则声线
  //   永远解析不出(旧五七-3 链同样死在这里)。签名口径与 media.upload 喂中转站一致;
  //   远端 provider 能否真拉到取决于存储是否公网可达 — 本地 dev + 远端商的投喂
  //   由「seedance 配音真打债」跟进 relay 素材同步。仅人物声线做签名兜底,图片引用语义不变。
  const voiceSignedMap = new Map<string, string>();
  for (const b of dbBindings) {
    const vid = b.asset.type === 'CHARACTER' ? b.asset.voiceMediaId : null;
    if (!vid || mediaMap.get(vid) || voiceSignedMap.has(vid)) continue;
    const m = medias.find((x) => x.id === vid);
    if (!m?.storageKey || m.storageKey.startsWith('placeholder://')) continue;
    if (m.storageKey.startsWith('external://')) {
      voiceSignedMap.set(vid, m.storageKey.slice('external://'.length));
      continue;
    }
    try {
      voiceSignedMap.set(vid, await getStorageAdapter().getSignedUrl(m.storageKey, 12 * 3600));
    } catch {
      // 签名失败(存储不可用等)→ 该人物进 voiceMissing,UI 提示
    }
  }

  // 六八(人到声必到):人物绑定 → 参考声线必然收集(身份级,不走 @token)
  const { voiceRefs, voiceMissing } = collectCharacterVoiceInfo(
    dbBindings,
    (mediaId) => mediaMap.get(mediaId) ?? voiceSignedMap.get(mediaId) ?? null,
  );

  // 七二第九波(用户报超 9 张参考):三视图已并入「主体形象」(portrait)单图 —— 每个人物**只送一张**
  //   主体形象作身份参考,不再 portrait+three_view 双送(旧数据残留的三视图也不附带),从源头收敛参考图
  //   数量(happyhorse R2V 硬限 9 张;5 人物×2 + 场景/道具就超了)。threeView 字段保留兜底但不进参考链。
  const characterImageRefs: CharacterImageRef[] = [];
  {
    const seenChar = new Set<string>();
    for (const b of dbBindings) {
      if (b.asset.type !== 'CHARACTER' || seenChar.has(b.asset.id)) continue;
      seenChar.add(b.asset.id);
      // 优先主体形象(portrait);极旧数据无 portrait 时兜底用 three_view 作单张身份参考
      const mediaId = b.asset.portraitMediaId ?? b.asset.threeViewMediaId;
      const url = mediaId ? (mediaMap.get(mediaId) ?? null) : null;
      if (url) {
        characterImageRefs.push({
          assetId: b.asset.id,
          name: b.asset.name,
          kind: 'portrait',
          mediaUrl: url,
        });
      }
    }
  }

  // 六八:声音设定描述进 prompt【声线】段(generateAudio=true 时;按 assetId 去重)
  let voiceDescriptions: Array<{ name: string; desc: string }> | undefined;
  if (args.includeVoiceDescriptions) {
    const seenDesc = new Set<string>();
    voiceDescriptions = [];
    for (const b of dbBindings) {
      if (b.asset.type !== 'CHARACTER' || seenDesc.has(b.asset.id)) continue;
      seenDesc.add(b.asset.id);
      const desc = extractVoiceLabel(b.asset.profileJson);
      if (desc) voiceDescriptions.push({ name: b.asset.name, desc });
    }
  }

  // H0(docs/07 §4.1):【时间轴】结构段数据 — 组内 shots 按 positionIdx 升序(从 Shot 表读,
  // 正文零接触 → 默认拼接/手编/AI 优化三态统一生效;submit/preview/keyframe 复用本真相源自动受益)
  const timelineShots = await tx.shot.findMany({
    where: { groupId: args.group.id, deletedAt: null },
    orderBy: { positionIdx: 'asc' },
    select: { durationS: true, framing: true, angle: true, movement: true, lighting: true },
  });

  // H0:强化词设置(八要素 #7 画质 / #8 稳定)— 行缺失用默认(文章模板),行存在但空 = 显式关闭
  const enhancerRows = await tx.systemSetting.findMany({
    where: { key: { in: ['prompt.enhancer.quality', 'prompt.enhancer.stability'] } },
    select: { key: true, value: true },
  });
  const enhancerMap = new Map(enhancerRows.map((r) => [r.key, r.value]));
  const enhancers = {
    quality: enhancerMap.get('prompt.enhancer.quality') ?? DEFAULT_ENHANCER_QUALITY,
    stability: enhancerMap.get('prompt.enhancer.stability') ?? DEFAULT_ENHANCER_STABILITY,
  };

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
    voiceDescriptions,
    timelineShots,
    enhancers,
  });

  return {
    compiled,
    voiceRefs,
    voiceMissing,
    characterImageRefs,
    isRelayProvider,
    characterBindingsForCompliance,
    projectType: project?.type,
  };
}
