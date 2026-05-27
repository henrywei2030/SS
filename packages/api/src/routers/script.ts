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

import { parseEpisodeBoundaries, parseScriptText } from '@ss/core/script';
// 第 18 轮 audit P1:LLM 失败错误信息脱敏入库
import { sanitizeErrorMsg } from '@ss/shared';

import { router, protectedProcedure } from '../trpc.js';
import type { Context } from '../context.js';
import { logOperation } from '../middleware/audit.js';
import { isEpisodeLockedNow } from '../utils/episode-lock.js';
import { extractScriptText } from '../utils/script-extract.js';
// 三十一收工 S3:SystemSetting 单 key 读 helper
import { loadSystemSetting } from '../utils/system-bindings.js';

// ---------------------------------------------------------------------------
// W1-W5 audit P0(C1):上传剧本前的软锁守卫
// generateForEpisode 跑到一半另一请求换剧本会导致跨版本 shot
// ---------------------------------------------------------------------------

async function assertEpisodeNotGenerating(
  ctx: Context,
  projectId: string,
  episodeNumber: number,
): Promise<void> {
  const existing = await ctx.prisma.episode.findUnique({
    where: {
      projectId_number: { projectId, number: episodeNumber },
    },
    select: { id: true, status: true, generatingStartedAt: true },
  });
  if (existing && isEpisodeLockedNow(existing)) {
    throw new TRPCError({
      code: 'CONFLICT',
      message:
        '本集正在生成分镜,请等生成完成或在管理员后台解锁后再上传剧本(防跨版本 shot)',
    });
  }
}

// ---------------------------------------------------------------------------
// 通用：项目访问
// ---------------------------------------------------------------------------

// W7+ audit R10:assertProjectAccess 抽到 middleware/access.ts
import { assertProjectAccess } from '../middleware/access.js';

async function loadScriptWithAccess(ctx: Context, scriptId: string) {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const script = await ctx.prisma.script.findFirst({
    where: { id: scriptId, deletedAt: null },
  });
  if (!script) throw new TRPCError({ code: 'NOT_FOUND', message: '剧本不存在' });
  await assertProjectAccess(ctx, script.projectId);
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

    // Phase 1.5.3 bugfix:version 号计算必须基于"全部"(含软删)的 script,
    // 否则用户清空剧本(deleteAllForEpisode)后再上传,会撞 unique (episodeId, version)
    // — 软删后旧行仍占用 unique key 空间。
    const all = await tx.script.findMany({
      where: { episodeId: input.episodeId },
      orderBy: { version: 'desc' },
    });
    const liveExisting = all.filter((s) => !s.deletedAt);

    // 同内容已存在且仍是当前版本 → 直接返回，避免无意义新建
    const current = liveExisting.find((s) => s.isCurrent);
    if (current && current.contentHash === contentHash) {
      return { script: current, created: false };
    }

    // 关键:nextVersion 跨过软删的最大 version,防止 unique 撞车
    const nextVersion = (all[0]?.version ?? 0) + 1;

    // 1. 旧的 isCurrent 清空(只动 live)
    if (liveExisting.length > 0) {
      await tx.script.updateMany({
        where: { episodeId: input.episodeId, isCurrent: true, deletedAt: null },
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
    // 第 19 轮 audit / ADR-27:script 上传是 W3 分镜的前置入口
    .meta({
      agentTool: {
        description: '上传剧本到指定 Episode:幂等(content hash 同则不新建版本),触发 generate 前置',
        sideEffects: [
          'db.create:Script(版本)',
          'db.update:Episode.softLock',
          'OperationLog.write',
        ],
        costEstimateCny: 0,
        requireConfirm: false,
      },
    })
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
      await assertProjectAccess(ctx, input.projectId);
      await assertEpisodeNotGenerating(ctx, input.projectId, input.episodeNumber);

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
      await assertProjectAccess(ctx, input.projectId);
      await assertEpisodeNotGenerating(ctx, input.projectId, input.episodeNumber);

      // 1. base64 → Buffer → 按格式提取纯文本
      // W1-W5 audit P1 followup(P1-5):读 binding.script.docx.parser 传给 extract
      let text: string;
      let format: string;
      try {
        const buffer = Buffer.from(input.fileBase64, 'base64');
        const docxParser = await loadSystemSetting(ctx.prisma, 'binding.script.docx.parser');
        const extracted = await extractScriptText(buffer, input.filename, {
          docxParser,
        });
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
   * 预览文件 — 多集切分前看一眼解析结果(不入库)
   *
   * Phase 1.5.3:一份 docx 含 Ep1-N 时,前端用此接口拿到切分预览,
   * 弹确认对话框让用户校对集号/标题/场数,确认后再调 uploadMultiEpisode。
   */
  previewParseFile: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        filename: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[^/\\\x00]+$/, '文件名不能包含 / \\ 或控制字符'),
        fileBase64: z.string().min(1).max(11_000_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      let text: string;
      let format: string;
      try {
        const buffer = Buffer.from(input.fileBase64, 'base64');
        const docxParser = await loadSystemSetting(ctx.prisma, 'binding.script.docx.parser');
        const extracted = await extractScriptText(buffer, input.filename, {
          docxParser,
        });
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
      if (text.length > 5_000_000) {
        throw new TRPCError({
          code: 'PAYLOAD_TOO_LARGE',
          message: `解压后文本过大 (${(text.length / 1024 / 1024).toFixed(1)}MB)`,
        });
      }

      const boundaries = parseEpisodeBoundaries(text);
      return {
        format,
        textLength: text.length,
        episodes: boundaries.map((b) => ({
          episodeNumber: b.episodeNumber,
          title: b.title,
          sceneCount: b.sceneCount,
          contentLength: b.content.length,
          preview: b.content.slice(0, 120),
        })),
        multiEpisode: boundaries.length > 1,
      };
    }),

  /**
   * 多集上传 — 一份 docx 含 Ep1-N,自动切到各集
   *
   * Phase 1.5.3:与 uploadFile 区别在于不指定 episodeNumber,parser 按 "第N集" 切分。
   * 每个识别到的集 → upsert Episode + 创建 Script 版本。
   * 单集 fallback:全文没匹配到标题 → 等同于 uploadFile 上传到 episode 1。
   *
   * 注:并发安全由 createNextVersion 内部 advisory_xact_lock 保证。
   */
  uploadMultiEpisode: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        filename: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[^/\\\x00]+$/, '文件名不能包含 / \\ 或控制字符'),
        fileBase64: z.string().min(1).max(11_000_000),
        language: z.string().default('zh-CN'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      let text: string;
      let format: string;
      try {
        const buffer = Buffer.from(input.fileBase64, 'base64');
        const docxParser = await loadSystemSetting(ctx.prisma, 'binding.script.docx.parser');
        const extracted = await extractScriptText(buffer, input.filename, {
          docxParser,
        });
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
      if (text.length > 5_000_000) {
        throw new TRPCError({
          code: 'PAYLOAD_TOO_LARGE',
          message: `解压后文本过大 (${(text.length / 1024 / 1024).toFixed(1)}MB)`,
        });
      }

      const boundaries = parseEpisodeBoundaries(text);

      // 防覆盖正在生成分镜的集
      for (const b of boundaries) {
        await assertEpisodeNotGenerating(ctx, input.projectId, b.episodeNumber);
      }

      const results: Array<{
        episodeNumber: number;
        title: string;
        scriptId: string;
        version: number;
        created: boolean;
        sceneCount: number;
      }> = [];

      for (const b of boundaries) {
        // Phase 1.5.3 bugfix:upsert 若命中软删 Episode(deletedAt!=null),复活它
        // 否则用户删了的集再上传会更新 title 但留 deletedAt,导致 listEpisodes 看不到
        const episode = await ctx.prisma.episode.upsert({
          where: {
            projectId_number: { projectId: input.projectId, number: b.episodeNumber },
          },
          create: {
            projectId: input.projectId,
            number: b.episodeNumber,
            title: b.title || undefined,
          },
          update: {
            ...(b.title && { title: b.title }),
            deletedAt: null,
            status: 'NOT_STARTED',
          },
        });

        const { script, created } = await createNextVersion(ctx, {
          projectId: input.projectId,
          episodeId: episode.id,
          title: b.title || undefined,
          content: b.content,
          language: input.language,
          source: 'UPLOAD',
        });

        results.push({
          episodeNumber: b.episodeNumber,
          title: b.title,
          scriptId: script.id,
          version: script.version,
          created,
          sceneCount: b.sceneCount,
        });
      }

      await logOperation(ctx, 'script.file.upload.multi', 'project', input.projectId, null, {
        projectId: input.projectId,
        format,
        textLength: text.length,
        episodeCount: results.length,
        episodes: results.map((r) => ({ n: r.episodeNumber, v: r.version, created: r.created })),
      });

      return {
        format,
        textLength: text.length,
        episodeCount: results.length,
        episodes: results,
      };
    }),

  /**
   * 在线编辑剧本 — 用 episodeId 直接存新版本(不需 projectId / episodeNumber)
   *
   * Phase 1.5.3 追加 2:剧本工坊右栏直接编辑 textarea + 保存。
   * 内容 hash 与当前版本相同 → 不新建,等同于无变化。
   * 复用 createNextVersion 的 advisory lock + isCurrent 翻新逻辑。
   */
  saveContent: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().cuid(),
        content: z.string().min(1, '剧本内容不能为空').max(5_000_000, '内容过大'),
        title: z.string().max(500).optional(),
        language: z.string().default('zh-CN'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const ep = await ctx.prisma.episode.findFirst({
        where: { id: input.episodeId, deletedAt: null },
      });
      if (!ep) throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
      await assertProjectAccess(ctx, ep.projectId);
      // 软锁守卫:生成分镜中禁止改剧本(防跨版本 shot)
      if (isEpisodeLockedNow(ep)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,无法保存编辑(等生成完成或解锁后重试)',
        });
      }

      const { script, created } = await createNextVersion(ctx, {
        projectId: ep.projectId,
        episodeId: ep.id,
        title: input.title,
        content: input.content,
        language: input.language,
        source: 'UPLOAD',
      });

      await logOperation(
        ctx,
        created ? 'script.edit.save' : 'script.edit.no_change',
        'script',
        script.id,
        null,
        { episodeId: ep.id, version: script.version, length: input.content.length },
      );

      return { script, created };
    }),

  /**
   * 清空本集所有剧本版本(软删) — Phase 1.5.3 精炼 1
   *
   * 不影响 Episode 本身,允许重新上传新剧本。
   * 软删 deletedAt 标记,数据库可手动恢复。
   *
   * 安全门槛:软锁中的集不允许清空(防覆盖正在生成的工作)。
   */
  deleteAllForEpisode: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().cuid(),
        confirmDelete: z.literal(true, {
          errorMap: () => ({ message: '需显式 confirmDelete=true(防误删)' }),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const ep = await ctx.prisma.episode.findFirst({
        where: { id: input.episodeId, deletedAt: null },
      });
      if (!ep) throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
      await assertProjectAccess(ctx, ep.projectId);
      if (isEpisodeLockedNow(ep)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '本集正在生成分镜,无法清空剧本',
        });
      }
      const now = new Date();
      const result = await ctx.prisma.script.updateMany({
        where: { episodeId: ep.id, deletedAt: null },
        data: { deletedAt: now, isCurrent: false },
      });
      await logOperation(ctx, 'script.delete.all', 'episode', ep.id, null, {
        episodeId: ep.id,
        deletedCount: result.count,
      });
      return { ok: true, deletedCount: result.count };
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
      await assertProjectAccess(ctx, input.projectId);
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
      await assertProjectAccess(ctx, ep.projectId);

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

  /** 取最新单集分析结果 */
  latestAnalysis: protectedProcedure
    .input(z.object({ scriptId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const script = await loadScriptWithAccess(ctx, input.scriptId);
      return ctx.prisma.scriptAnalysis.findFirst({
        where: { scriptId: script.id, scope: 'EPISODE' },
        orderBy: { createdAt: 'desc' },
      });
    }),

  /**
   * [W6 预留] 取本项目最新整剧批量分析
   *
   * 返回 ScriptAnalysis(scope=PROJECT) 最新一条,含 8 维均值 + perEpisodeStats + comparisonJson。
   * 当前 W3 阶段没有数据,UI 拿到 null 即可显示"尚未做过整剧分析"。
   */
  latestProjectAnalysis: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      return ctx.prisma.scriptAnalysis.findFirst({
        where: { projectId: input.projectId, scope: 'PROJECT' },
        orderBy: { createdAt: 'desc' },
      });
    }),

  /**
   * [W6 预留] 整剧批量分析 — 占位实现
   *
   * 真实实现需要异步 worker(BullMQ / pg-boss):
   *   1. 取本项目所有 isCurrent=true 的 Script
   *   2. 并发跑 LLM(限流 3)生成每集 analysis(scope=EPISODE)
   *   3. 聚合各集分数 + 写 ScriptAnalysis(scope=PROJECT,带 perEpisodeStats + comparisonJson)
   *   4. 触发 EVENTS.SCRIPT_BATCH_ANALYSIS_DONE(尚未定义)
   *
   * 现在直接返回 NOT_IMPLEMENTED + 占位 jobId,等 W6 worker 落地。
   * Schema 已就位(scope/projectId/episodeIds/perEpisodeStats/comparisonJson)。
   */
  analyzeProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        episodeIds: z.array(z.string().cuid()).optional(),
        modelId: z.string().default('claude-sonnet-4-5'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      // [W6] 这里要 enqueue 一个异步任务。当前返回 placeholder。
      void input.episodeIds;
      void input.modelId;
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: '整剧批量分析(W6)尚未上线 — 后端 worker + LLM 并发限流待实现',
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
   *
   * W1-W5 audit P1 followup(P1-4):modelId 优先级
   *   1. input.modelId(前端显式传)
   *   2. SystemSetting `binding.script.analysis.modelId`(admin 后台可改)
   *   3. 'claude-sonnet-4-5' 兜底
   *  原版直接默认 'claude-sonnet-4-5',绕过 binding,admin 改 binding 不生效。
   */
  analyze: protectedProcedure
    // 第 20 轮 audit / ADR-27:剧本分析 LLM 调用(8 维评分),Mastra agent 需看预算
    .meta({
      agentTool: {
        description: '调 LLM 对剧本做 8 维分析(剧情/角色/节奏/对白/...)+ overallScore',
        sideEffects: [
          'extern.api:TextProvider',
          'cost.deduct',
          'db.create:GenerationAttempt',
          'db.create:ScriptAnalysis',
        ],
        costEstimateCny: 0.5,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        scriptId: z.string().cuid(),
        modelId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const script = await ctx.prisma.script.findFirst({
        where: { id: input.scriptId, deletedAt: null },
        include: { episode: true },
      });
      if (!script) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertProjectAccess(ctx, script.projectId);

      // P1-4:从 binding 读 modelId(input 优先 > binding,无硬编码兜底)
      // 二十收工后用户反馈:不 hardcode 任何默认 provider,binding 空时显式拒绝
      let modelId = input.modelId;
      if (!modelId) {
        modelId = (await loadSystemSetting(ctx.prisma, 'binding.script.analysis.modelId')) ?? '';
      }
      if (!modelId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '剧本分析未配置 LLM Provider — 请去 /admin/bindings 选择 binding.script.analysis.modelId(或在调用时传 input.modelId 显式指定)',
        });
      }

      const { analyzeScript } = await import('@ss/core/script');

      // W1-W5 audit P0(B1):写 GenerationAttempt(action=ANALYSIS),回溯 ROI / PromptEdit 用
      const attemptStartedAt = new Date();
      const attempt = await ctx.prisma.generationAttempt.create({
        data: {
          projectId: script.projectId,
          episodeId: script.episodeId,
          providerId: modelId,
          modelId: modelId,
          action: 'ANALYSIS',
          inputJson: {
            kind: 'script.analyze',
            scriptId: input.scriptId,
            episodeNumber: script.episode?.number ?? 1,
            textLength: script.content.length,
          },
          outputMediaIds: [],
          inputUnits: 0,
          outputUnits: 0,
          unitPriceCny: '0',
          costCny: '0',
          status: 'RUNNING',
          startedAt: attemptStartedAt,
          createdBy: ctx.user.id,
        },
      });

      try {
        const result = await analyzeScript({
          scriptText: script.content,
          episodeNumber: script.episode?.number ?? 1,
          modelId,
          ctx: {
            userId: ctx.user.id,
            projectId: script.projectId,
            episodeId: script.episodeId ?? undefined,
            attemptId: attempt.id,
          },
        });

        const toJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

        const analysis = await ctx.prisma.scriptAnalysis.create({
          data: {
            scriptId: input.scriptId,
            episodeId: script.episodeId,
            modelId,
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

        const finishedAt = new Date();
        await ctx.prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'SUCCESS',
            costCny: result.cost.toFixed(4),
            finishedAt,
            durationMs: finishedAt.getTime() - attemptStartedAt.getTime(),
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
        const finishedAt = new Date();
        // 第 18 轮 audit P1:errMsg 入 attempt.errorMsg 前脱敏
        console.error('[script.analyze] LLM failed (raw):', e);
        const errMsg = sanitizeErrorMsg(e);
        await ctx.prisma.generationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'FAILED',
            errorMsg: errMsg,
            finishedAt,
            durationMs: finishedAt.getTime() - attemptStartedAt.getTime(),
          },
        });
        await logOperation(ctx, 'script.analyze.failed', 'script', script.id, null, {
          error: errMsg,
          projectId: script.projectId,
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: errMsg || '剧本分析失败',
          cause: e, // W7 audit R9
        });
      }
    }),
});
