/**
 * Asset Router · 剧本拆解组(breakdown / breakdownProject / applyBreakdown)
 *
 * P2(ADR-31):从 asset.ts(god 路由)按组拆出的 sibling。纯搬运,无行为变化。
 * helper / schema / 常量见 ./asset-shared.ts;在 asset.ts 里 spread 回 assetRouter。
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { type AssetDraft, breakdownAssets, breakdownFullSettings } from "@ss/core/asset";
import { Prisma } from "@ss/db";
import { protectedProcedure } from "../trpc.js";
import { logOperation } from "../middleware/audit.js";
import { loadSystemSettings, resolveBoundModelId } from "../utils/system-bindings.js";
import { runTextGenerationAttempt } from "../utils/generation-attempt.js";
import { assertProjectAccess } from "../middleware/access.js";
import { DraftInputSchema, loadProjectFullScript } from "./asset-shared.js";

export const breakdownProcedures = {
  /**
   * 2026-06-08「按集分块」:列出本项目有 current 剧本的集号(升序)+ 总剧本数,
   *   供前端判断能否按集分块拆解(episodes 覆盖全部剧本才分块,否则退回整本一次拆)。
   */
  breakdownEpisodeList: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const scripts = await ctx.prisma.script.findMany({
        where: { projectId: input.projectId, isCurrent: true, deletedAt: null },
        select: { episode: { select: { number: true } } },
      });
      const episodes = [
        ...new Set(
          scripts.map((s) => s.episode?.number).filter((n): n is number => typeof n === 'number'),
        ),
      ].sort((a, b) => a - b);
      return { episodes, totalScripts: scripts.length };
    }),

  /**
   * 从剧本拆解资产 — 调 LLM
   *
   * 不直接入库,返回 drafts 给前端预览。前端用户审阅后再调 batchCreate。
   * (避免 LLM 乱拆把脏数据直接写库,人工把关一遍)
   */
  breakdown: protectedProcedure
    // 第 20 轮 audit / ADR-27:LLM 调用,有真成本,Mastra agent 需 budget 决策
    .meta({
      agentTool: {
        description: '调 Claude/豆包 从剧本拆解出角色/场景/道具/特效,返回草稿(不入库)',
        sideEffects: ['extern.api:TextProvider', 'cost.deduct', 'db.create:GenerationAttempt'],
        costEstimateCny: 0.3,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        projectId: z.string().cuid(),
        scriptId: z.string().cuid().optional(),
        episodeId: z.string().cuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      // 取剧本 — 优先 scriptId,其次 episodeId 的 isCurrent,最后整剧 isCurrent
      const script = input.scriptId
        ? await ctx.prisma.script.findFirst({
            where: {
              id: input.scriptId,
              projectId: input.projectId,
              deletedAt: null,
            },
          })
        : input.episodeId
          ? await ctx.prisma.script.findFirst({
              where: {
                episodeId: input.episodeId,
                projectId: input.projectId,
                isCurrent: true,
                deletedAt: null,
              },
            })
          : await ctx.prisma.script.findFirst({
              where: {
                projectId: input.projectId,
                isCurrent: true,
                deletedAt: null,
              },
              orderBy: { createdAt: 'desc' },
            });

      if (!script) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '未找到可拆解的剧本(请先上传剧本)',
        });
      }

      // 取项目类型 + 风格
      const project = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
        include: { style: true },
      });

      // 读绑定 model + maxCharacters(三十二收工 S3 followup:helper batch)
      const settings = await loadSystemSettings(ctx.prisma, [
        'binding.asset.breakdown.modelId',
        'asset.breakdown.maxCharacters',
      ]);
      // 悬空/停用自动 fallback(见 resolveBoundModelId),不再因换模型硬崩
      const modelId = await resolveBoundModelId(ctx.prisma, {
        bindingKey: 'binding.asset.breakdown.modelId',
        kind: 'TEXT',
        value: settings['binding.asset.breakdown.modelId'],
        purpose: '资产拆解',
      });
      const maxCharacters = Number(settings['asset.breakdown.maxCharacters'] ?? '20');

      // W1-W5 audit P0(B1):写 GenerationAttempt(action=TEXT),Phase 1 资产拆解扣费回溯链路
      // P3-A:状态机走 runTextGenerationAttempt(create RUNNING / SUCCESS / 软失败 result.warning→FAILED 统一,有单测锁)。
      //   breakdown 引擎不返回 token 数 → 传 inputTokens/outputTokens=0(与原 update 不写这两列等价)。
      return runTextGenerationAttempt(
        ctx,
        {
          projectId: input.projectId,
          episodeId: input.episodeId,
          modelId,
          inputJson: {
            kind: 'asset.breakdown',
            scriptId: script.id,
            projectType: project?.type,
            styleSlug: project?.style?.slug,
            maxCharacters,
          },
          failPrefix: '资产拆解失败',
          wrapError: async (e, sanitized) => {
            // 第 18 轮 audit P1:errMsg 入 attempt.errorMsg(helper 写)+ TRPCError + log 前脱敏
            console.error('[asset.breakdown] LLM failed (raw):', e);
            await logOperation(ctx, 'asset.breakdown.failed', 'project', input.projectId, null, {
              error: sanitized,
              scriptId: script.id,
            });
            return new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: sanitized || '资产拆解失败',
              cause: e, // W7 audit R9
            });
          },
        },
        async (attemptId) => {
          const result = await breakdownAssets({
            scriptText: script.content,
            projectType: project?.type,
            styleSlug: project?.style?.slug,
            modelId,
            maxCharacters,
            ctx: {
              userId: ctx.user.id,
              projectId: input.projectId,
              episodeId: input.episodeId,
              attemptId,
            },
          });

          await logOperation(ctx, 'asset.breakdown', 'project', input.projectId, null, {
            scriptId: script.id,
            characters: result.characters.length,
            scenes: result.scenes.length,
            props: result.props.length,
            cost: result.cost,
            modelId,
          });

          // 把 drafts 标记 type(给前端 batchCreate 时复用)
          const charactersTyped: AssetDraft[] = result.characters;
          const scenesTyped: AssetDraft[] = result.scenes;
          const propsTyped: AssetDraft[] = result.props;

          return {
            inputTokens: 0,
            outputTokens: 0,
            costCny: result.cost,
            warning: result.warning,
            value: {
              characters: charactersTyped.map((d) => ({ ...d, type: 'CHARACTER' as const })),
              scenes: scenesTyped.map((d) => ({ ...d, type: 'SCENE' as const })),
              props: propsTyped.map((d) => ({ ...d, type: 'PROP' as const })),
              cost: result.cost,
              modelId,
              scriptId: script.id,
              warning: result.warning,
            },
          };
        },
      );
    }),


  /**
   * 五六-2:从「完整剧本」拆解富设定 → 返回草稿(不写库,草稿审阅再应用)。
   * 聚合项目所有集当前剧本喂 LLM,产人物(形象 + 小传)/ 场景 / 道具富设定;
   * 每条附 matchedAssetId(按 archetypeKey/name 匹配已有资产),前端据此区分 新建/更新。
   */
  breakdownProject: protectedProcedure
    .meta({
      agentTool: {
        description: '从完整剧本拆解人物/场景/道具完整文字设定(形象+小传),返回草稿不入库',
        sideEffects: ['extern.api:TextProvider', 'cost.deduct', 'db.create:GenerationAttempt'],
        costEstimateCny: 0.5,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        projectId: z.string().cuid(),
        modelId: z.string().max(100).optional(),
        // 五六-2:分类型拆(整本剧本作上下文,只产一类)避免单请求超时;不传=一次全拆
        type: z.enum(['CHARACTER', 'SCENE', 'PROP']).optional(),
        // 2026-06-08「按集分块」:只拆指定集号(前端循环驱动 + 跨块合并去重),
        //   每块小而快彻底绕开非流式中转 250-300s 超时;不传=全集(旧行为)。
        episodeNumbers: z.array(z.number().int().positive()).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const { text: scriptText, scriptCount } = await loadProjectFullScript(
        ctx,
        input.projectId,
        200_000,
        input.episodeNumbers,
      );
      if (!scriptText.trim()) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '本项目还没有剧本 — 先在「剧本管理」上传,或从「灵感创作」关联剧本',
        });
      }

      const project = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
        include: { style: true },
      });
      const modelId = await resolveBoundModelId(ctx.prisma, {
        bindingKey: 'binding.asset.breakdown.modelId',
        kind: 'TEXT',
        override: input.modelId,
        purpose: '剧本拆解',
      });

      // P3-A:状态机走 runTextGenerationAttempt(create RUNNING / SUCCESS / 软失败 result.warning→FAILED 统一,有单测锁)。
      //   breakdownFullSettings 引擎不返回 token 数 → 传 inputTokens/outputTokens=0(与原 update 不写这两列等价)。
      return runTextGenerationAttempt(
        ctx,
        {
          projectId: input.projectId,
          modelId,
          inputJson: { kind: 'asset.breakdownProject', scriptCount, focusType: input.type, styleSlug: project?.style?.slug },
          failPrefix: '剧本拆解失败',
          wrapError: (e, sanitized) => {
            console.error('[asset.breakdownProject] LLM failed (raw):', e);
            return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: sanitized || '剧本拆解失败', cause: e });
          },
        },
        async (attemptId) => {
          const result = await breakdownFullSettings({
            scriptText,
            projectType: project?.type,
            styleSlug: project?.style?.slug,
            modelId,
            maxCharacters: 40,
            focusType: input.type,
            ctx: { userId: ctx.user.id, projectId: input.projectId, attemptId },
          });

          // 匹配已有资产(archetypeKey 优先,其次 name + 同 type)→ 前端区分 新建/更新
          const existing = await ctx.prisma.asset.findMany({
            where: { projectId: input.projectId, deletedAt: null },
            select: { id: true, name: true, archetypeKey: true, type: true },
          });
          const matchOf = (
            name: string,
            archetypeKey: string | undefined,
            type: 'CHARACTER' | 'SCENE' | 'PROP',
          ): string | undefined => {
            if (archetypeKey) {
              const m = existing.find((a) => a.archetypeKey === archetypeKey && a.type === type);
              if (m) return m.id;
            }
            return existing.find((a) => a.name === name && a.type === type)?.id;
          };

          await logOperation(ctx, 'asset.breakdownProject', 'project', input.projectId, null, {
            scriptCount,
            characters: result.characters.length,
            scenes: result.scenes.length,
            props: result.props.length,
            cost: result.cost,
            modelId,
          });

          return {
            inputTokens: 0,
            outputTokens: 0,
            costCny: result.cost,
            warning: result.warning,
            value: {
              characters: result.characters.map((d) => ({
                ...d,
                type: 'CHARACTER' as const,
                matchedAssetId: matchOf(d.name, d.archetypeKey, 'CHARACTER'),
              })),
              scenes: result.scenes.map((d) => ({
                ...d,
                type: 'SCENE' as const,
                matchedAssetId: matchOf(d.name, d.archetypeKey, 'SCENE'),
              })),
              props: result.props.map((d) => ({
                ...d,
                type: 'PROP' as const,
                matchedAssetId: matchOf(d.name, d.archetypeKey, 'PROP'),
              })),
              cost: result.cost,
              modelId,
              scriptCount,
              warning: result.warning,
            },
          };
        },
      );
    }),


  /**
   * 五六-2:应用拆解草稿 — 逐条 create 新的 / update 匹配的(草稿审阅再应用)。
   * create 跳过重名;update 跳过已锁定;只写用户审阅过的字段。
   */
  applyBreakdown: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        items: z
          .array(
            DraftInputSchema.extend({
              mode: z.enum(['create', 'update']),
              assetId: z.string().cuid().optional(),
            }),
          )
          .min(1)
          .max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const creates = input.items.filter((i) => i.mode === 'create');
      const updates = input.items.filter((i) => i.mode === 'update' && i.assetId);

      // 创建:跳过同项目重名
      const existing = await ctx.prisma.asset.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        select: { name: true },
      });
      const names = new Set(existing.map((a) => a.name));
      const toCreate = creates.filter((i) => {
        if (names.has(i.name)) return false;
        names.add(i.name);
        return true;
      });
      const skippedNames = creates.filter((i) => !toCreate.includes(i)).map((i) => i.name);

      // 更新:校验存在 + 同项目 + 未删 + 未锁
      const updIds = updates.map((u) => u.assetId!).filter(Boolean);
      const valid =
        updIds.length > 0
          ? await ctx.prisma.asset.findMany({
              where: { id: { in: updIds }, projectId: input.projectId, deletedAt: null },
              select: { id: true, lockedAt: true },
            })
          : [];
      const validMap = new Map(valid.map((a) => [a.id, a]));

      const result = await ctx.prisma.$transaction(async (tx) => {
        const created =
          toCreate.length > 0
            ? await tx.asset.createManyAndReturn({
                data: toCreate.map(({ mode: _m, assetId: _a, profileJson, ...d }) => ({
                  projectId: input.projectId,
                  ...d,
                  ...(profileJson !== undefined
                    ? { profileJson: profileJson as Prisma.InputJsonValue }
                    : {}),
                })),
                select: { id: true, name: true, type: true },
              })
            : [];
        let updatedCount = 0;
        const skippedLocked: string[] = [];
        for (const u of updates) {
          const v = validMap.get(u.assetId!);
          if (!v) continue;
          if (v.lockedAt) {
            skippedLocked.push(u.name);
            continue;
          }
          const { mode: _m, assetId, profileJson, ...patch } = u;
          await tx.asset.update({
            where: { id: assetId! },
            data: {
              ...patch,
              ...(profileJson !== undefined
                ? { profileJson: profileJson as Prisma.InputJsonValue }
                : {}),
            },
          });
          updatedCount++;
        }
        return { created, updatedCount, skippedLocked };
      });

      await logOperation(ctx, 'asset.applyBreakdown', 'project', input.projectId, null, {
        created: result.created.length,
        updated: result.updatedCount,
        skippedNames,
        skippedLocked: result.skippedLocked,
      });
      return {
        created: result.created,
        updated: result.updatedCount,
        skippedNames,
        skippedLocked: result.skippedLocked,
      };
    }),

};
