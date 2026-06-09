/**
 * Script Router — 上传/导入/清空组(upload / linkInspirationEpisodes / uploadFile /
 *   previewParseFile / uploadMultiEpisode / saveContent / deleteAllForEpisode /
 *   deleteAllForProject)。
 *
 * 机械重构(ADR-31):从 script.ts 按逻辑组拆出,纯搬运无行为变化。
 *   跨组共用 helper 见 script-shared.ts;本组私有 helper(assertEpisodeNotGenerating /
 *   createNextVersion)留在本文件。
 */
import { TRPCError } from '@trpc/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { parseEpisodeBoundaries, parseScriptText } from '@ss/core/script';

import { protectedProcedure } from '../trpc.js';
import type { Context } from '../context.js';
import { logOperation } from '../middleware/audit.js';
import { isEpisodeLockedNow } from '../utils/episode-lock.js';
import { acquireTxAdvisoryLock } from '../utils/advisory-lock.js';
import { extractScriptText } from '../utils/script-extract.js';
// 三十一收工 S3:SystemSetting 单 key 读 helper
import { loadSystemSetting } from '../utils/system-bindings.js';

// W7+ audit R10:assertProjectAccess 抽到 middleware/access.ts
import { assertProjectAccess, loadEpisodeOrThrow } from '../middleware/access.js';

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
// 核心：写入新版本（事务）
// ---------------------------------------------------------------------------

interface NewVersionInput {
  projectId: string;
  episodeId: string;
  title?: string;
  content: string;
  language: string;
  source: 'UPLOAD' | 'AI_GENERATED' | 'IMPORTED';
  /** 需求2B:true 时若 current 版本已锁定则跳过(不覆盖)— 重新上传场景用,锁定集保留原内容 */
  skipIfLocked?: boolean;
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
    await acquireTxAdvisoryLock(tx, 'script_version', input.episodeId);

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
      return { script: current, created: false, skippedLocked: false };
    }

    // 需求2B:重新上传时 current 已锁定 → 不覆盖,保留锁定集原内容
    if (input.skipIfLocked && current?.lockedAt) {
      return { script: current, created: false, skippedLocked: true };
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

    return { script, created: true, skippedLocked: false };
  });
}

export const uploadProcedures = {
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
        content: z.string().min(1, '剧本内容不能为空').max(5_000_000, '剧本内容过长(上限 5MB)'),
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
          // 对齐 uploadMultiEpisode 复活:清空(软删)后重新上传同一集须复活,否则分集列表查不到 → 0 集
          deletedAt: null,
          status: 'NOT_STARTED',
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
   * 四九收工:关联灵感剧本(多集)— 把灵感草稿的多集一次性导入为正式剧本
   *   - 默认全部导入,也可只选部分集;每集 source=AI_GENERATED
   *   - 灵感第 N 集 → 本项目第 N 集(1:1,跟多集上传一致)
   *   - 复用 upload 同款逻辑:upsert Episode + createNextVersion(内容哈希去重 + setCurrent)
   *   - 生成中的集自动跳过(防覆盖),返回每集结果供前端汇报
   */
  linkInspirationEpisodes: protectedProcedure
    .input(
      z.object({
        draftId: z.string().cuid(),
        episodeNumbers: z.array(z.number().int().positive()).min(1, '至少选一集').max(200, '一次最多 200 集'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const draft = await ctx.prisma.inspirationDraft.findFirst({
        where: { id: input.draftId, deletedAt: null },
      });
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: '灵感草稿不存在' });
      await assertProjectAccess(ctx, draft.projectId);

      // JSON 列防御:episodes 被脏数据污染成非数组时 .filter 会直接 500,这里按空处理走 BAD_REQUEST
      const allEps = Array.isArray(draft.episodes)
        ? (draft.episodes as unknown as { number: number; title: string; content: string }[])
        : [];
      const selected = allEps.filter(
        (e) => e?.content?.trim() && input.episodeNumbers.includes(e.number),
      );
      if (selected.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '所选集均无内容(去灵感创作先展开)' });
      }

      const results: { number: number; version: number; created: boolean; skipped?: boolean }[] = [];
      for (const ep of selected) {
        // 生成中的集跳过(防覆盖正在抽卡的集)。只把"生成中"锁冲突(CONFLICT)当跳过;
        // 其余异常(DB 抖动等)向上抛,不静默误判为"已跳过"而丢失真实错误
        try {
          await assertEpisodeNotGenerating(ctx, draft.projectId, ep.number);
        } catch (e) {
          if (e instanceof TRPCError && e.code === 'CONFLICT') {
            results.push({ number: ep.number, version: 0, created: false, skipped: true });
            continue;
          }
          throw e;
        }
        const episode = await ctx.prisma.episode.upsert({
          where: { projectId_number: { projectId: draft.projectId, number: ep.number } },
          create: { projectId: draft.projectId, number: ep.number, title: ep.title },
          // 关键(对齐 uploadMultiEpisode 的 Phase 1.5.3 复活):命中软删 Episode(清空全部后)时
          //   必须复活 deletedAt=null,否则"关联成功"但分集列表(where deletedAt:null)查不到 → 0 集
          update: { title: ep.title, deletedAt: null, status: 'NOT_STARTED' },
        });
        const { script, created } = await createNextVersion(ctx, {
          projectId: draft.projectId,
          episodeId: episode.id,
          title: `${draft.title} 第${ep.number}集:${ep.title}`,
          content: ep.content,
          language: 'zh-CN',
          source: 'AI_GENERATED',
        });
        results.push({ number: ep.number, version: script.version, created });
      }
      await logOperation(ctx, 'script.linkInspiration', 'inspirationDraft', draft.id, null, {
        draftId: draft.id,
        episodes: selected.map((e) => e.number),
      });
      return {
        linked: results,
        created: results.filter((r) => r.created).length,
        skipped: results.filter((r) => r.skipped).length,
        total: selected.length,
      };
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
          // 对齐 uploadMultiEpisode 复活:清空(软删)后重新上传同一集须复活,否则分集列表查不到 → 0 集
          deletedAt: null,
          status: 'NOT_STARTED',
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
        skippedLocked: boolean;
        sceneCount: number;
      }> = [];

      for (const b of boundaries) {
        // 需求2:重新上传**覆盖所有集**(不管发布/锁定等一切情况)— 以最新上传内容为准。
        // Phase 1.5.3 bugfix:upsert 命中软删 Episode(deletedAt!=null)时复活它。
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

        const { script, created, skippedLocked } = await createNextVersion(ctx, {
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
          skippedLocked,
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
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId, {
        // 软锁守卫:生成分镜中禁止改剧本(防跨版本 shot)
        lockMessage: '本集正在生成分镜,无法保存编辑(等生成完成或解锁后重试)',
      });

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
      const ep = await loadEpisodeOrThrow(ctx, input.episodeId, {
        lockMessage: '本集正在生成分镜,无法清空剧本',
      });
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
   * 需求2A:清空全部剧本 — 软删项目所有集(分集列表)+ 各集剧本 + 级联 scenes/shots/shotGroups/bindings
   *
   * 保护(跳过不删):生成分镜中 / 已发布(下游 AIGC 引用) / current 剧本已锁定的集。
   * 返回清理 + 跳过统计供前端提示。
   */
  deleteAllForProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        confirmDelete: z.literal(true, {
          errorMap: () => ({ message: '需显式 confirmDelete=true(防误删)' }),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const episodes = await ctx.prisma.episode.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        select: {
          id: true,
          number: true,
          status: true,
          generatingStartedAt: true,
          batchLocked: true,
        },
      });
      const now = new Date();
      let cleared = 0;
      let skippedGenerating = 0;
      let skippedLocked = 0;
      for (const ep of episodes) {
        // 生成分镜中 → 保护(worker 在跑,清了会孤儿;非用户意图的技术约束)
        if (isEpisodeLockedNow(ep)) {
          skippedGenerating++;
          continue;
        }
        // 需求2c:仅保护"分集列表锁定"(Episode.batchLocked),其余一切情形(含已发布/版本锁定)全清
        if (ep.batchLocked) {
          skippedLocked++;
          continue;
        }
        // 级联软删 — 复用 storyboard.archiveEpisode 模式(Episode + scene/shot/shotGroup/binding + script)
        await ctx.prisma.$transaction([
          ctx.prisma.episode.update({
            where: { id: ep.id },
            data: { deletedAt: now, status: 'ARCHIVED' },
          }),
          ctx.prisma.scene.updateMany({
            where: { episodeId: ep.id, deletedAt: null },
            data: { deletedAt: now },
          }),
          ctx.prisma.shot.updateMany({
            where: { episodeId: ep.id, deletedAt: null },
            data: { deletedAt: now },
          }),
          ctx.prisma.shotGroup.updateMany({
            where: { episodeId: ep.id, deletedAt: null },
            data: { deletedAt: now },
          }),
          ctx.prisma.assetUsageBinding.updateMany({
            where: { episodeId: ep.id, deletedAt: null },
            data: { deletedAt: now },
          }),
          ctx.prisma.script.updateMany({
            where: { episodeId: ep.id, deletedAt: null },
            data: { deletedAt: now, isCurrent: false },
          }),
        ]);
        cleared++;
      }
      await logOperation(ctx, 'script.delete.all.project', 'project', input.projectId, null, {
        cleared,
        skippedGenerating,
        skippedLocked,
        total: episodes.length,
      });
      return { cleared, skippedGenerating, skippedLocked, total: episodes.length };
    }),
};
