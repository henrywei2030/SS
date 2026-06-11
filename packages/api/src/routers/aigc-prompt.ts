/**
 * AIGC Router — 自动匹配 / 自动@ / 提示词编辑 / 预览编译(机械拆分 ADR-31,纯搬运)。
 *   autoMatchAssets / autoTagPrompt / updateGroupPrompt / previewCompiledPrompt
 */
import { z } from 'zod';

import { autoMatchAssets, type MatchableAsset } from '@ss/core/generation';
import {
  autoTagPromptWithReferences,
  kindFromUsage,
  type AutoTagBinding,
} from '@ss/core/storyboard';
import { compileVideoPromptForGroup } from '@ss/core/video-generation';
import { normalizePrompt } from '@ss/shared';
import { aspectRatioSchema } from '@ss/shared/schemas';

import { protectedProcedure } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';
import { acquireTxAdvisoryLock } from '../utils/advisory-lock.js';
import { loadSystemSettings } from '../utils/system-bindings.js';

import { loadGroupOrThrow } from './aigc-shared.js';

export const promptProcedures = {
  /**
   * 自动匹配 — 把项目资产库扫一遍,对在 ShotGroup.prompt + shots.content 中
   * 出现的资产创建 binding,分配 refSlotIdx(scene→1, characters→2..., props→...,音频另起)
   *
   * 规则:
   *   - 已有 binding(同 assetId+shotGroupId+usageType)→ 跳过,不覆盖
   *   - 新建 binding 时 refSlotIdx 续号(图片类 / 音频类各自一个计数器,基于本 group 现有最大值续接)
   *   - 只建 IMAGE 类 binding(scene/character/prop)— 人物参考声线**不需要**建 SOUND_VOICE
   *     binding:六八起编译期 voiceRefs 按「人在声在」规则自动附带(compile.ts),
   *     人物绑定即声音绑定,显式 SOUND_VOICE 仅留给手动绑非人物音频(BGM/主题曲)场景
   */
  autoMatchAssets: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);

      // 1. 取本 group 所有 shots,合并文本扫描
      const shots = await ctx.prisma.shot.findMany({
        where: { groupId: grp.id, deletedAt: null },
        select: { content: true, prompt: true },
      });
      const fullText = [
        grp.prompt,
        ...shots.flatMap((s) => [s.content, s.prompt]),
      ]
        .filter((s) => s && s.trim().length > 0)
        .join('\n');

      if (!fullText) {
        return { created: 0, skipped: 0, matches: [] };
      }

      // 2. 取项目资产(已确认 + 未软删 + IMAGE 类)
      const assets = await ctx.prisma.asset.findMany({
        where: {
          projectId: grp.episode.projectId,
          deletedAt: null,
          type: { in: ['CHARACTER', 'SCENE', 'PROP'] },
        },
        select: { id: true, type: true, name: true, alias: true },
      });

      // 3. 跑 auto-match
      const matchable: MatchableAsset[] = assets.map((a) => ({
        id: a.id,
        type: a.type as 'CHARACTER' | 'SCENE' | 'PROP',
        name: a.name,
        alias: a.alias,
      }));
      const matches = autoMatchAssets(fullText, matchable);

      if (matches.length === 0) {
        return { created: 0, skipped: 0, matches: [] };
      }

      // 4. W5 audit R1:全部写入在事务里 + advisory lock,防两个用户同时点"自动匹配"
      //    导致 refSlotIdx 双分配(partial unique 会拦,但拦到第二个用户那边抛 P2002 体验差)
      const result = await ctx.prisma.$transaction(async (tx) => {
        await acquireTxAdvisoryLock(tx, 'aigc_match', grp.id);

        // 锁内 re-read 现有 bindings 查重 + 算 next slot
        const existing = await tx.assetUsageBinding.findMany({
          where: { shotGroupId: grp.id, deletedAt: null },
          select: { assetId: true, usageType: true, refSlotIdx: true },
        });
        const existingKey = new Set(
          existing.map((e) => `${e.assetId}:${e.usageType}`),
        );
        const existingImageSlots = existing
          .filter((e) => !['SOUND_BG', 'SOUND_VOICE', 'THEME'].includes(e.usageType))
          .map((e) => e.refSlotIdx ?? 0);
        let nextImageIdx = Math.max(0, ...existingImageSlots) + 1;

        // 5. 按 (type=SCENE 优先, 然后 CHARACTER, 然后 PROP) 重排,稳定 refSlotIdx
        const typeOrder: Record<string, number> = { SCENE: 0, CHARACTER: 1, PROP: 2 };
        const sortedMatches = [...matches].sort((a, b) => {
          const ta = typeOrder[a.type] ?? 9;
          const tb = typeOrder[b.type] ?? 9;
          if (ta !== tb) return ta - tb;
          return a.position - b.position;
        });

        const created: Array<{
          bindingId: string;
          assetId: string;
          assetName: string;
          refSlotIdx: number;
        }> = [];
        const skipped: string[] = [];

        for (const m of sortedMatches) {
          const usageType = m.type === 'SCENE' ? 'ENVIRONMENT' : 'APPEAR';
          const key = `${m.assetId}:${usageType}`;
          if (existingKey.has(key)) {
            skipped.push(m.assetName);
            continue;
          }
          const refSlotIdx = nextImageIdx++;
          const binding = await tx.assetUsageBinding.create({
            data: {
              assetId: m.assetId,
              projectId: grp.episode.projectId,
              episodeId: grp.episodeId,
              shotGroupId: grp.id,
              usageType,
              refSlotIdx,
              note: `auto-match: ${m.refKind} @${m.matchedTerm}`,
            },
          });
          existingKey.add(key);
          created.push({
            bindingId: binding.id,
            assetId: m.assetId,
            assetName: m.assetName,
            refSlotIdx,
          });
        }

        // 七二第六波(用户反馈:自动匹配的资产没出现在美术工坊该集总览):
        //   美术总览按 Asset.episodes[] 过滤展示;autoMatch 原来只建 binding 不更新 episodes[] →
        //   匹配的资产在该集总览缺席。这里并集补回本组所属集号(只增不删,与 recomputeEpisodes 同一真相源)。
        if (created.length > 0) {
          const epRow = await tx.episode.findUnique({
            where: { id: grp.episodeId },
            select: { number: true },
          });
          if (epRow) {
            const matchedAssetIds = Array.from(new Set(created.map((c) => c.assetId)));
            const assetsToTouch = await tx.asset.findMany({
              where: { id: { in: matchedAssetIds } },
              select: { id: true, episodes: true },
            });
            for (const a of assetsToTouch) {
              if (!a.episodes.includes(epRow.number)) {
                await tx.asset.update({
                  where: { id: a.id },
                  data: { episodes: { set: [...a.episodes, epRow.number].sort((x, y) => x - y) } },
                });
              }
            }
          }
        }

        return { created, skipped };
      });

      await logOperation(
        ctx,
        'aigc.autoMatch',
        'shotGroup',
        grp.id,
        null,
        {
          groupNumber: grp.number,
          episodeId: grp.episodeId,
          projectId: grp.episode.projectId,
          createdCount: result.created.length,
          skippedCount: result.skipped.length,
        },
      );

      return {
        created: result.created.length,
        skipped: result.skipped.length,
        matches: result.created,
      };
    }),

  /**
   * 自动 @ — 在 ShotGroup.prompt 中给已 binding 的资产插入 @图片N / @音频N token。
   * 保存回 ShotGroup.prompt(用户接下来可编辑)。
   */
  autoTagPrompt: protectedProcedure
    .input(z.object({ groupId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);

      const bindings = await ctx.prisma.assetUsageBinding.findMany({
        where: { shotGroupId: grp.id, deletedAt: null, refSlotIdx: { not: null } },
        orderBy: { refSlotIdx: 'asc' },
        include: { asset: { select: { name: true, alias: true } } },
      });

      const tagBindings: AutoTagBinding[] = bindings.map((b) => ({
        refSlotIdx: b.refSlotIdx!,
        kind: kindFromUsage(b.usageType),
        name: b.asset.name,
        aliases: b.asset.alias,
      }));

      const tagged = autoTagPromptWithReferences(grp.prompt, tagBindings);

      if (tagged === grp.prompt) {
        return { changed: false, prompt: grp.prompt };
      }

      const updated = await ctx.prisma.shotGroup.update({
        where: { id: grp.id },
        data: { prompt: tagged },
      });

      await logOperation(ctx, 'aigc.autoTag', 'shotGroup', grp.id, { prompt: grp.prompt }, {
        prompt: tagged,
        groupNumber: grp.number,
        episodeId: grp.episodeId,
        projectId: grp.episode.projectId,
      });

      return { changed: true, prompt: updated.prompt };
    }),

  /**
   * 编辑 ShotGroup.prompt — 写 PromptEdit 训练集(target=SHOT_GROUP)
   */
  updateGroupPrompt: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        prompt: z.string().min(1).max(20000),
        diffNote: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId);
      // 2026-05-27 audit r12 P0-C1:server 端 normalize 跟前端显示对齐
      // 训练集 PromptEdit before/after 用 normalize 版本(否则 LLM 原始 raw 跟用户改后的 compact 对不上,数据失真)
      const normalizedAfter = normalizePrompt(input.prompt);
      const normalizedBefore = normalizePrompt(grp.prompt);
      if (normalizedBefore === normalizedAfter) {
        return { changed: false, prompt: grp.prompt };
      }
      const updated = await ctx.prisma.$transaction(async (tx) => {
        const u = await tx.shotGroup.update({
          where: { id: grp.id },
          data: { prompt: normalizedAfter },
        });
        await tx.promptEdit.create({
          data: {
            targetType: 'SHOT_GROUP',
            targetId: grp.id,
            projectId: grp.episode.projectId,
            episodeId: grp.episodeId,
            field: 'prompt',
            before: normalizedBefore,
            after: normalizedAfter,
            diffNote: input.diffNote ?? null,
            userId: ctx.user.id,
          },
        });
        return u;
      });
      return { changed: true, prompt: updated.prompt };
    }),

  /**
   * 预览编译后的 prompt(调 compileShotGroupVideoPrompt)
   * 给 UI 实时显示"送 Seedance 的 prompt 长什么样"+ warnings
   */
  previewCompiledPrompt: protectedProcedure
    .input(
      z.object({
        groupId: z.string().cuid(),
        // 2026-05-27 audit r12:int 强制,跟 generateVideo 一致防小数预扣偏差
        durationS: z.number().int().min(1).max(15).optional(),
        // W1-W5 audit 三轮 P2-13:aspectRatio 改 enum 与 generateVideo 一致(用 shared 真相源)
        aspectRatio: aspectRatioSchema.optional(),
        extraInstruction: z.string().max(500).optional(),
        extraNegative: z.array(z.string().max(50)).max(20).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const grp = await loadGroupOrThrow(ctx, input.groupId, { skipLockCheck: true });

      // 六八重构:复用 compileVideoPromptForGroup(与 generateVideo 同一真相源)—
      // 原先此处手工重复 70 行 binding→references 组装,且拿不到「人到声必到」的 voiceRefs。
      // providerId 用真实绑定值 → relay 商时 URL 解析(asset:// 优先)与正式生成同口径。
      // 【声线】段跟随系统默认有声开关;抽卡面板临时改开关时预览不重算,正式口径以 generateVideo 为准。
      const settings = await loadSystemSettings(ctx.prisma, [
        'shot.video.generateAudio.default',
        'binding.shot.video.providerId',
      ]);
      const wantAudio =
        (settings['shot.video.generateAudio.default'] ?? 'true') === 'true';

      const { compiled, voiceRefs, voiceMissing, characterImageRefs } = await compileVideoPromptForGroup(
        ctx.prisma,
        {
          group: {
            id: grp.id,
            prompt: grp.prompt,
            durationS: grp.durationS,
            episode: { projectId: grp.episode.projectId },
          },
          providerId: settings['binding.shot.video.providerId'] ?? '',
          durationS: input.durationS ?? grp.durationS,
          aspectRatio: input.aspectRatio ?? '',
          extraInstruction: input.extraInstruction,
          extraNegative: input.extraNegative,
          includeVoiceDescriptions: wantAudio,
        },
      );

      // voiceRefs/voiceMissing/characterImageRefs 给 UI:「将自动附带参考声线/人物图」提示
      return { ...compiled, voiceRefs, voiceMissing, characterImageRefs };
    }),
};
