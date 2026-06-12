/**
 * Asset Router 共享件 —— helper / schema / 常量。
 *
 * P2(ADR-31):从 asset.ts(2636 行 god 文件)抽出,供拆分后的各 sub-module
 *   (asset-crud / asset-generate / asset-breakdown / asset-candidates / asset-bindings)复用,
 *   破"sibling 引 helper ↔ asset.ts 引 sibling procedure"的循环依赖。纯搬运,无行为变化。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { TRAINABLE_TEXT_FIELDS as TRAINABLE_TEXT_FIELD_LIST } from '@ss/shared';

import type { Context } from '../context.js';
import { assertProjectAccess } from '../middleware/access.js';

export async function loadAssetWithAccess(ctx: Context, assetId: string) {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const asset = await ctx.prisma.asset.findFirst({
    where: { id: assetId, deletedAt: null },
  });
  if (!asset) throw new TRPCError({ code: 'NOT_FOUND', message: '资产不存在' });
  await assertProjectAccess(ctx, asset.projectId);
  return asset;
}

/**
 * 聚合项目「完整剧本」(五六-2 剧本拆解 / 定点重生成的输入)。
 * 取所有集 isCurrent 剧本(含项目级 episodeId=null),按集号拼接,带集标题分隔。
 * maxChars 截断防超 context(剧本拆解传大值用全文,定点重生成传小值省 token)。
 */
export async function loadProjectFullScript(
  ctx: Context,
  projectId: string,
  maxChars = 200_000,
  // 2026-06-08:按集分块拆解 — 只取指定集号的剧本(不传=全集)
  episodeNumbers?: number[],
): Promise<{ text: string; scriptCount: number; truncated: boolean }> {
  const scripts = await ctx.prisma.script.findMany({
    where: {
      projectId,
      isCurrent: true,
      deletedAt: null,
      ...(episodeNumbers && episodeNumbers.length > 0
        ? { episode: { number: { in: episodeNumbers } } }
        : {}),
    },
    select: { content: true, episode: { select: { number: true, title: true } } },
  });
  if (scripts.length === 0) return { text: '', scriptCount: 0, truncated: false };
  const sorted = [...scripts].sort(
    (a, b) => (a.episode?.number ?? 1e9) - (b.episode?.number ?? 1e9),
  );
  const full = sorted
    .map((s) => {
      const ep = s.episode;
      const header = ep ? `=== 第${ep.number}集${ep.title ? ' ' + ep.title : ''} ===` : '=== 剧本 ===';
      return `${header}\n${s.content}`;
    })
    .join('\n\n');
  const truncated = full.length > maxChars;
  return { text: truncated ? full.slice(0, maxChars) : full, scriptCount: scripts.length, truncated };
}

// ---------------------------------------------------------------------------
// PromptEdit — 资产文本字段训练集采集(训练字段从 @ss/shared 拉,跟 storyboard.ts 同源)
// ---------------------------------------------------------------------------

export const TRAINABLE_ASSET_FIELDS = new Set<string>(TRAINABLE_TEXT_FIELD_LIST);

export async function recordAssetEdit(
  ctx: Context,
  args: {
    assetId: string;
    field: string;
    before: unknown;
    after: unknown;
    projectId: string;
    diffNote?: string;
  },
): Promise<void> {
  if (!ctx.user) return;
  if (!TRAINABLE_ASSET_FIELDS.has(args.field)) return;
  if (typeof args.before !== 'string' || typeof args.after !== 'string') return;
  if (args.before === args.after) return;
  try {
    await ctx.prisma.promptEdit.create({
      data: {
        targetType: 'ASSET',
        targetId: args.assetId,
        field: args.field,
        before: args.before,
        after: args.after,
        diffNote: args.diffNote,
        projectId: args.projectId,
        userId: ctx.user.id,
      },
    });
  } catch (e) {
    console.error('[assetEdit] PromptEdit write failed:', {
      assetId: args.assetId,
      field: args.field,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ---------------------------------------------------------------------------
// 输入 schema
// ---------------------------------------------------------------------------

export const AssetTypeSchema = z.enum(['CHARACTER', 'SCENE', 'PROP', 'STYLE_REFERENCE']);
export const CharacterRoleSchema = z.enum([
  '主演-男主',
  '主演-女主',
  '主演-反派',
  '配角-正派',
  '配角-反派',
  '配角-中性',
  '群演',
]);

// 剧本拆解角色档案 — 人生节点 + profileJson(2026-06 P1)
export const LifeNodeSchema = z.object({
  year: z.string().max(20),
  title: z.string().max(100),
  desc: z.string().max(2000),
});
export const ProfileJsonSchema = z.object({
  lifeNodes: z.array(LifeNodeSchema).max(50).optional(),
  voiceLabel: z.string().max(100).optional(),
});
// 档案字段(均可选 — 拆解可能不全;MBTI/性格/独白/人生节点等深度设定留空待 AI 生成 / 人工填)
export const ProfileFieldsSchema = {
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  age: z.number().int().min(0).max(200).optional(),
  heightCm: z.number().int().min(0).max(300).optional(),
  mbti: z.string().max(8).optional(),
  personalityTags: z.array(z.string().max(30)).max(20).optional(),
  monologue: z.string().max(2000).optional(),
  // 五六-2:人物小传(背景故事,LLM 拆解生成 + 人工微调)
  bio: z.string().max(4000).optional(),
  // 五七-3:出场集号(据剧本 ===第N集=== 拆解;排序 + 标注出场用)
  episodes: z.array(z.number().int().min(1).max(99999)).max(2000).optional(),
  profileJson: ProfileJsonSchema.optional(),
};

export const DraftInputSchema = z.object({
  type: AssetTypeSchema,
  name: z.string().min(1).max(100),
  alias: z.array(z.string().max(50)).max(5).default([]),
  description: z.string().max(2000).default(''),
  prompt: z.string().min(1).max(5000),
  characterRole: CharacterRoleSchema.optional(),
  tags: z.array(z.string().max(50)).max(20).default([]),
  styleId: z.string().cuid().optional(),
  archetypeKey: z.string().max(100).optional(),
  importance: z.enum(['S', 'A', 'B', 'C']).optional(),
  ...ProfileFieldsSchema,
});

export const SlotSchema = z.enum([
  'portrait',
  'three_view',
  'scene_main',
  'scene_front',
  'scene_left',
  'scene_right',
  'scene_back',
  'panorama',
  'main',
  'detail',
  'reference',
]);

export const UsageTypeSchema = z.enum([
  'APPEAR',
  'SPEAK',
  'HOLD',
  'WEAR',
  'ENVIRONMENT',
  'BACKGROUND',
  'SOUND_BG',
  'SOUND_VOICE',
  'THEME',
  'REFERENCE',
]);

// ---------------------------------------------------------------------------
// 槽位写入 + 成熟度计算
// ---------------------------------------------------------------------------

/** slot → Asset 上对应字段名 */
export const SLOT_FIELD: Record<z.infer<typeof SlotSchema>, string> = {
  portrait: 'portraitMediaId',
  three_view: 'threeViewMediaId',
  scene_main: 'sceneMainMediaId',
  scene_front: 'sceneFrontMediaId',
  scene_left: 'sceneLeftMediaId',
  scene_right: 'sceneRightMediaId',
  scene_back: 'sceneBackMediaId',
  panorama: 'panoramaMediaId',
  main: 'mainMediaId',
  detail: 'mainMediaId', // detail 用作 main 的别名(暂)
  reference: 'mainMediaId', // 不该被用作槽位 confirm,先指 main
};

/**
 * 根据已填槽位 + 合规状态计算 L0-L5
 *
 * - L0:无任何字段
 * - L1:有 prompt
 * - L2:有任意候选(GenerationAttempt 存在,但前端先简化为槽位还未填)
 * - L3:对应 type 的主槽位已填(人物=portrait / 场景=sceneMain or mainMedia / 道具=main)
 * - L4:一致性槽位齐(人物=portrait+threeView / 场景=mainMedia+至少一个 front/left/right/back / 道具=main)
 * - L5:complianceStatus=APPROVED + L4 满足(人物);非人物只要 L4 满足
 */
export function computeMaturity(asset: {
  type: string;
  prompt: string;
  portraitMediaId: string | null;
  threeViewMediaId: string | null;
  sceneMainMediaId: string | null;
  sceneFrontMediaId: string | null;
  sceneLeftMediaId: string | null;
  sceneRightMediaId: string | null;
  sceneBackMediaId: string | null;
  panoramaMediaId: string | null;
  mainMediaId: string | null;
  complianceStatus: string;
}):
  | 'L0_IDENTIFIED'
  | 'L1_PROMPT_READY'
  | 'L2_CANDIDATE'
  | 'L3_MAIN_CONFIRMED'
  | 'L4_CONSISTENCY_READY'
  | 'L5_PRODUCTION_READY' {
  if (!asset.prompt.trim()) return 'L0_IDENTIFIED';

  const hasMain =
    asset.type === 'CHARACTER'
      ? !!asset.portraitMediaId
      : asset.type === 'SCENE'
        ? !!asset.panoramaMediaId || !!asset.mainMediaId // 用户定调:场景主资产=360°全景(panorama)
        : !!asset.mainMediaId;

  if (!hasMain) return 'L1_PROMPT_READY';

  const consistencyReady =
    asset.type === 'CHARACTER'
      ? true // 七二第九波:人物三视图已并入「主体形象」一张图,有主图(L3)即达一致性(L4)
      : asset.type === 'SCENE'
        ? !!asset.threeViewMediaId // 用户定调:主资产改 360°全景后,一致性=九宫格(次要视角)
        : true; // 道具 / 风格只要主图即可

  if (!consistencyReady) return 'L3_MAIN_CONFIRMED';

  if (asset.type === 'CHARACTER' && asset.complianceStatus !== 'APPROVED') {
    return 'L4_CONSISTENCY_READY';
  }
  return 'L5_PRODUCTION_READY';
}
