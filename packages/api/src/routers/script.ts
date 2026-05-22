/**
 * Script Router — 剧本与剧本分析（W2.7 + W3.2 版本化）
 *
 * 版本子系统约定：
 *   - 同 episode 可有多个 Script 行，每个对应一个版本号 version（@@unique([episodeId, version])）
 *   - 任意时刻同 episode 至多一个 isCurrent=true（应用层事务保证）
 *   - lockedAt!=null 的版本只读，禁止 update / delete / setCurrent 之外的操作
 *   - 上传新内容总是 create new version，不再 update 旧版本
 */
import { TRPCError } from '@trpc/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { parseScriptText } from '@ss/core/script';

import { router, protectedProcedure } from '../trpc.js';
import type { Context } from '../context.js';
import { logOperation } from '../middleware/audit.js';
import { extractScriptText } from '../utils/script-extract.js';

// ---------------------------------------------------------------------------
// 通用：项目访问
// ---------------------------------------------------------------------------

async function assertProjectAccess(
  ctx: Context,
  projectId: string,
  userId: string,
): Promise<void> {
  const p = await ctx.prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
  });
  if (!p) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '无项目访问权限' });
  }
}

async function loadScriptWithAccess(ctx: Context, scriptId: string) {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const script = await ctx.prisma.script.findFirst({
    where: { id: scriptId, deletedAt: null },
  });
  if (!script) throw new TRPCError({ code: 'NOT_FOUND', message: '剧本不存在' });
  await assertProjectAccess(ctx, script.projectId, ctx.user.id);
  return script;
}

// ---------------------------------------------------------------------------
// 核心：写入新版本（事务）
// ---------------------------------------------------------------------------

interface NewVersionInput {
  projectId: string;
  episodeId: string;
  title?: string;
  content: string;
  language: string;
  source: 'UPLOAD' | 'AI_GENERATED' | 'IMPORTED';
}

/**
 * 在同一事务里：
 *   1. 用 advisory lock 序列化同一 episode 的并发版本生成
 *   2. 把同 episode 现有 Script 的 isCurrent 全部置 false
 *   3. 创建新版本（version = max+1, isCurrent=true）
 *
 * 不用 advisory lock 时，两个并发请求会各自读到 max=3,都算出 nextVersion=4 → unique 撞车。
 * Postgres 的 advisory transaction lock 在事务结束时自动释放。
 */
async function createNextVersion(ctx: Context, input: NewVersionInput) {
  const contentHash = createHash('sha256').update(input.content).digest('hex');

  return ctx.prisma.$transaction(async (tx) => {
    // 用 episodeId 派生一个 bigint 作为 advisory lock key
    // hashtext 给定相同 input 输出相同 i32,转 bigint 即可
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext('script_version:' || $1)::bigint)`,
      input.episodeId,
    );

    const existing = await tx.script.findMany({
      where: { episodeId: input.episodeId, deletedAt: null },
      orderBy: { version: 'desc' },
    });

    // 同内容已存在且仍是当前版本 → 直接返回，避免无意义新建
    const current = existing.find((s) => s.isCurrent);
    if (current && current.contentHash === contentHash) {
      return { script: current, created: false };
    }

    const nextVersion = (existing[0]?.version ?? 0) + 1;

    // 1. 旧的 isCurrent 清空
    if (existing.length > 0) {
      await tx.script.updateMany({
        where: { episodeId: input.episodeId, isCurrent: true },
        data: { isCurrent: false },
      });
    }

    // 2. 创建新版本
    const script = await tx.script.create({
      data: {
        projectId: input.projectId,
        episodeId: input.episodeId,
        title: input.title,
        content: input.content,
        contentHash,
        language: input.language,
        source: input.source,
        version: nextVersion,
        isCurrent: true,
      },
    });

    return { script, created: true };
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const scriptRouter = router({
  /**
   * 上传/更新剧本（按集）—— 永远创建新版本，旧版本保留
   *
   * 若同 episode 的当前剧本 content hash 与本次相同 → 不新建，返回 existing
   */
  upload: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        episodeNumber: z.number().int().positive(),
        title: z.string().optional(),
        content: z.string().min(1, '剧本内容不能为空'),
        language: z.string().default('zh-CN'),
        source: z.enum(['UPLOAD', 'AI_GENERATED', 'IMPORTED']).default('UPLOAD'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, ctx.user.id);

      // 1. upsert Episode
      const episode = await ctx.prisma.episode.upsert({
        where: {
          projectId_number: {
            projectId: input.projectId,
            number: input.episodeNumber,
          },
        },
        create: {
          projectId: input.projectId,
          number: input.episodeNumber,
          title: input.title,
        },
        update: {
          ...(input.title && { title: input.title }),
        },
      });

      // 2. 创建新版本
      const { script, created } = await createNextVersion(ctx, {
        projectId: input.projectId,
        episodeId: episode.id,
        title: input.title,
        content: input.content,
        language: input.language,
        source: input.source,
      });

      await logOperation(
        ctx,
        created ? 'script.version.create' : 'script.no_change',
        'script',
        script.id,
        null,
        { projectId: input.projectId, version: script.version, source: input.source },
      );

      return { episode, script, created };
    }),

  /**
   * 上传剧本文件 — 通用入口，支持 docx / txt / md / rtf / html
   *
   * 调用方传 base64 字符串 + filename（用于扩展名识别）。
   * 提取由 utils/script-extract.ts 按格式分发：
   *   - docx → mammoth
   *   - txt  → utf-8
   *   - md   → 去 markdown 标记
   *   - rtf  → 去 RTF 控制码
   *   - html → 去标签
   */
  uploadFile: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        episodeNumber: z.number().int().positive(),
        // filename 入审计日志,需防路径注入 + 长度上限
        filename: z
          .string()
          .min(1, '文件名不能为空')
          .max(255, '文件名过长')
          .regex(/^[^/\\\x00]+$/, '文件名不能包含 / \\ 或控制字符'),
        title: z.string().max(500).optional(),
        // base64 上限 = 原文件 8MB 上限 (base64 膨胀 ~33% → 约 10.7MB)
        fileBase64: z
          .string()
          .min(1, '文件内容不能为空')
          .max(11_000_000, '文件超过 8MB 限制'),
        language: z.string().default('zh-CN'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, ctx.user.id);

      // 1. base64 → Buffer → 按格式提取纯文本
      let text: string;
      let format: string;
      try {
        const buffer = Buffer.from(input.fileBase64, 'base64');
        const extracted = await extractScriptText(buffer, input.filename);
        text = extracted.text;
        format = extracted.format;
      } catch (e) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: e instanceof Error ? e.message : '文件解析失败',
        });
      }
      if (!text) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '文件内容为空' });
      }
      // 解压后文本上限 — 防 docx zip bomb(1KB 文件 → 1GB 解压)
      const MAX_TEXT_CHARS = 5_000_000; // 5M chars ≈ 5MB UTF-8 单字节区,中文 ~10MB
      if (text.length > MAX_TEXT_CHARS) {
        throw new TRPCError({
          code: 'PAYLOAD_TOO_LARGE',
          message: `解压后文本过大 (${(text.length / 1024 / 1024).toFixed(1)}MB),疑似异常文件`,
        });
      }

      // 2. upsert Episode
      const episode = await ctx.prisma.episode.upsert({
        where: {
          projectId_number: {
            projectId: input.projectId,
            number: input.episodeNumber,
          },
        },
        create: {
          projectId: input.projectId,
          number: input.episodeNumber,
          title: input.title,
        },
        update: {
          ...(input.title && { title: input.title }),
        },
      });

      // 3. 创建新版本
      const { script, created } = await createNextVersion(ctx, {
        projectId: input.projectId,
        episodeId: episode.id,
        title: input.title,
        content: text,
        language: input.language,
        source: 'UPLOAD',
      });

      // 4. 顺手 parse 一遍，给前端反馈"识别到几个场"
      const parsed = parseScriptText(text);

      await logOperation(
        ctx,
        created ? 'script.file.upload' : 'script.file.no_change',
        'script',
        script.id,
        null,
        {
          projectId: input.projectId,
          version: script.version,
          filename: input.filename,
          format,
          textLength: text.length,
          parsedScenes: parsed.scenes.length,
        },
      );

      return {
        episode,
        script,
        created,
        format,
        parsedSceneCount: parsed.scenes.length,
        title: parsed.title,
      };
    }),

  /**
   * 列出某项目所有剧本（当前版本视图）
   *
   * 默认 onlyCurrent=true，即每集只返回 isCurrent=true 那一份。
   * 想拿历史版本切换 UI 用 listVersions。
   */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        onlyCurrent: z.boolean().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, ctx.user.id);
      return ctx.prisma.script.findMany({
        where: {
          projectId: input.projectId,
          deletedAt: null,
          ...(input.onlyCurrent ? { isCurrent: true } : {}),
        },
        orderBy: [{ episode: { number: 'asc' } }, { version: 'desc' }],
        include: {
          episode: { select: { id: true, number: true, title: true } },
          analyses: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              overallScore: true,
              createdAt: true,
            },
          },
        },
      });
    }),

  /** 列出某集所有版本（用于版本切换 UI） */
  listVersions: protectedProcedure
    .input(z.object({ episodeId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const ep = await ctx.prisma.episode.findFirst({
        where: { id: input.episodeId, deletedAt: null },
      });
      if (!ep) throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
      await assertProjectAccess(ctx, ep.projectId, ctx.user.id);

      return ctx.prisma.script.findMany({
        where: { episodeId: input.episodeId, deletedAt: null },
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          title: true,
          contentHash: true,
          language: true,
          source: true,
          isCurrent: true,
          lockedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }),

  /** 取指定版本完整内容 — 供剧本视图显示 */
  getById: protectedProcedure
    .input(z.object({ scriptId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return loadScriptWithAccess(ctx, input.scriptId);
    }),

  /** 取最新分析结果 */
  latestAnalysis: protectedProcedure
    .input(z.object({ scriptId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const script = await loadScriptWithAccess(ctx, input.scriptId);
      return ctx.prisma.scriptAnalysis.findFirst({
        where: { scriptId: script.id },
        orderBy: { createdAt: 'desc' },
      });
    }),

  /**
   * 把指定版本设为当前 — 同 episode 其它版本 isCurrent 全部清空
   */
  setCurrentVersion: protectedProcedure
    .input(z.object({ scriptId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const script = await loadScriptWithAccess(ctx, input.scriptId);
      if (!script.episodeId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '项目级总剧本（无 episodeId）不参与版本切换',
        });
      }

      await ctx.prisma.$transaction([
        ctx.prisma.script.updateMany({
          where: {
            episodeId: script.episodeId,
            isCurrent: true,
            id: { not: script.id },
          },
          data: { isCurrent: false },
        }),
        ctx.prisma.script.update({
          where: { id: script.id },
          data: { isCurrent: true },
        }),
      ]);

      await logOperation(
        ctx,
        'script.version.setCurrent',
        'script',
        script.id,
        null,
        { projectId: script.projectId, episodeId: script.episodeId, version: script.version },
      );
      return { ok: true };
    }),

  /** 锁定版本(只读快照) */
  lockVersion: protectedProcedure
    .input(z.object({ scriptId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const script = await loadScriptWithAccess(ctx, input.scriptId);
      if (script.lockedAt) {
        return { ok: true, alreadyLocked: true };
      }
      await ctx.prisma.script.update({
        where: { id: script.id },
        data: { lockedAt: new Date() },
      });
      await logOperation(
        ctx,
        'script.version.lock',
        'script',
        script.id,
        { lockedAt: null },
        { lockedAt: new Date(), projectId: script.projectId },
      );
      return { ok: true };
    }),

  unlockVersion: protectedProcedure
    .input(z.object({ scriptId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const script = await loadScriptWithAccess(ctx, input.scriptId);
      if (!script.lockedAt) {
        return { ok: true, alreadyUnlocked: true };
      }
      await ctx.prisma.script.update({
        where: { id: script.id },
        data: { lockedAt: null },
      });
      await logOperation(
        ctx,
        'script.version.unlock',
        'script',
        script.id,
        { lockedAt: script.lockedAt },
        { lockedAt: null, projectId: script.projectId },
      );
      return { ok: true };
    }),

  /**
   * 发起分析 — 对指定 scriptId 调 Claude（W2.7 逻辑保留）
   */
  analyze: protectedProcedure
    .input(
      z.object({
        scriptId: z.string().cuid(),
        modelId: z.string().default('claude-sonnet-4-5'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const script = await ctx.prisma.script.findFirst({
        where: { id: input.scriptId, deletedAt: null },
        include: { episode: true },
      });
      if (!script) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertProjectAccess(ctx, script.projectId, ctx.user.id);

      const { analyzeScript } = await import('@ss/core/script');

      try {
        const result = await analyzeScript({
          scriptText: script.content,
          episodeNumber: script.episode?.number ?? 1,
          modelId: input.modelId,
          ctx: {
            userId: ctx.user.id,
            projectId: script.projectId,
            episodeId: script.episodeId ?? undefined,
          },
        });

        const toJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

        const analysis = await ctx.prisma.scriptAnalysis.create({
          data: {
            scriptId: input.scriptId,
            episodeId: script.episodeId,
            modelId: input.modelId,
            hookScore: result.scores.hookScore,
            suspenseScore: result.scores.suspenseScore,
            twistScore: result.scores.twistScore,
            climaxScore: result.scores.climaxScore,
            conflictScore: result.scores.conflictScore,
            dialogueScore: result.scores.dialogueScore,
            paceScore: result.scores.paceScore,
            urgencyScore: result.scores.urgencyScore,
            overallScore: result.scores.overallScore,
            summary: result.summary,
            highlights: toJson(result.highlights) as never,
            issues: toJson(result.issues) as never,
            curveJson: toJson(result.curve) as never,
            productionPlan: toJson(result.productionPlan) as never,
            costCny: result.cost,
            createdBy: ctx.user.id,
          },
        });

        await logOperation(ctx, 'script.analyze.complete', 'script', script.id, null, {
          analysisId: analysis.id,
          overallScore: result.scores.overallScore,
          cost: result.cost,
          projectId: script.projectId,
        });

        return { analysis, status: 'done' };
      } catch (e) {
        await logOperation(ctx, 'script.analyze.failed', 'script', script.id, null, {
          error: e instanceof Error ? e.message : String(e),
          projectId: script.projectId,
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: e instanceof Error ? e.message : '剧本分析失败',
        });
      }
    }),
});
