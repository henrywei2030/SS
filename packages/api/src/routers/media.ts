/**
 * Media Router — W5.6 Media Vault MVP
 *
 * 职责:用户级素材库 — 上传 / 列表 / 搜索 / 收藏 / 删除 / 批量
 *
 * 访问权:
 *   - PROJECT scope:user 是 project owner 或 member 才能看
 *   - PUBLIC scope:任何登录用户都能看(管理员才能删)
 *   - PERSONAL scope:Phase 2 启用(需 schema 加 uploadedById,Phase 1 不做)
 *
 * AIGC 自动沉淀:aigc.generateVideo 已经 source='AIGC' 写 MediaItem,
 *   list 会自动包含,无需额外接入。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getStorageAdapter, buildStorageKey } from '@ss/adapters/storage';
// Phase 1.5 P0-5(主次重审 v2.1):OpenAI 兼容中转站素材库 asset:// 引用机制
import { getRelayAssetProvider, getRelayDefaultGroupId } from '@ss/adapters/provider';
// 第 18 轮 audit P1:base64 解码错误信息脱敏 + MIME 白名单守门
import { sanitizeErrorMsg } from '@ss/shared';

import { router, protectedProcedure } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';

// MediaKind ↔ buildStorageKey 的 kind 参数(后者用 lowercase)
function kindToStorageKind(k: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'THREE_D' | 'OTHER'): 'image' | 'video' | 'audio' | 'doc' | 'other' {
  if (k === 'IMAGE') return 'image';
  if (k === 'VIDEO') return 'video';
  if (k === 'AUDIO') return 'audio';
  return 'other';
}

const KIND_ENUM = z.enum(['IMAGE', 'VIDEO', 'AUDIO', 'THREE_D', 'OTHER']);
const SCOPE_ENUM = z.enum(['PUBLIC', 'PROJECT', 'PERSONAL']);

const UPLOAD_MAX_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * 第 18 轮 audit P1:upload 的 mimeType ↔ kind 必须交叉校验,
 * 防 SVG 上传成 IMAGE 触发 XSS、PDF 假冒 IMAGE 等。
 * - IMAGE 故意不收 image/svg+xml(SVG XSS 已知风险,Phase 2 启用 DOMPurify 后再考虑放开)
 * - VIDEO/AUDIO 列常见 codec
 * - THREE_D 主流 mime 不统一,放宽到 model/* 或 application/octet-stream
 * - OTHER 兜底放宽(Phase 1 不挡,Phase 2 按业务细化)
 */
const ALLOWED_MIME_BY_KIND: Record<'IMAGE' | 'VIDEO' | 'AUDIO' | 'THREE_D' | 'OTHER', RegExp> = {
  IMAGE: /^image\/(jpeg|jpg|png|webp|gif|avif|heic|heif|bmp)$/i,
  VIDEO: /^video\/(mp4|webm|quicktime|x-matroska|x-msvideo|ogg)$/i,
  AUDIO: /^audio\/(mpeg|mp3|wav|wave|x-wav|aac|ogg|webm|flac|x-m4a|mp4)$/i,
  THREE_D: /^(model\/.+|application\/octet-stream)$/i,
  OTHER: /.+/,
};

export const mediaRouter = router({
  /**
   * 列出当前用户能看到的所有 MediaItem
   * 视图:全部 / 收藏 / 项目内 / 公共库
   * Filter:kind / search(filename + tags)
   */
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(12).max(60).default(48),
        scope: SCOPE_ENUM.optional(),
        kind: KIND_ENUM.optional(),
        projectId: z.string().cuid().optional(),
        favorited: z.boolean().optional(),
        search: z.string().max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // 算可访问的 projectId 列表(user 是 owner 或 member)
      const accessibleProjects = await ctx.prisma.project.findMany({
        where: {
          deletedAt: null,
          OR: [
            { ownerId: ctx.user.id },
            { members: { some: { userId: ctx.user.id } } },
          ],
        },
        select: { id: true },
      });
      const accessibleProjectIds = accessibleProjects.map((p) => p.id);

      // 构造 where
      const where: Record<string, unknown> = { deletedAt: null };
      if (input.kind) where.kind = input.kind;
      if (input.favorited === true) where.isFavorited = true;

      // scope 过滤(覆盖默认的访问控制)
      if (input.scope === 'PUBLIC') {
        where.scope = 'PUBLIC';
      } else if (input.scope === 'PROJECT') {
        where.scope = 'PROJECT';
        where.projectId = input.projectId
          ? { in: [input.projectId].filter((id) => accessibleProjectIds.includes(id)) }
          : { in: accessibleProjectIds };
      } else if (input.scope === 'PERSONAL') {
        // Phase 2 启用,Phase 1 直接返空(避免越权)
        where.id = '__none__';
      } else {
        // 默认:user 能看的所有
        where.OR = [
          { scope: 'PUBLIC' },
          { scope: 'PROJECT', projectId: { in: accessibleProjectIds } },
        ];
      }

      if (input.search && input.search.trim()) {
        const s = input.search.trim();
        const orSearch = [
          { filename: { contains: s, mode: 'insensitive' as const } },
          { tags: { has: s } },
        ];
        // where.OR 已经被 scope 用了,合并到 AND
        const existingOr = where.OR;
        if (existingOr) {
          where.AND = [{ OR: existingOr }, { OR: orSearch }];
          delete where.OR;
        } else {
          where.OR = orSearch;
        }
      }

      const [items, total] = await Promise.all([
        ctx.prisma.mediaItem.findMany({
          where,
          orderBy: [{ isFavorited: 'desc' }, { createdAt: 'desc' }],
          take: input.pageSize,
          skip: (input.page - 1) * input.pageSize,
          select: {
            id: true,
            projectId: true,
            scope: true,
            kind: true,
            filename: true,
            mimeType: true,
            sizeBytes: true,
            storageKey: true,
            cdnUrl: true,
            aspectRatio: true,
            tags: true,
            source: true,
            sourceRef: true,
            isFavorited: true,
            createdAt: true,
            meta: true,
          },
        }),
        ctx.prisma.mediaItem.count({ where }),
      ]);

      return {
        items,
        total,
        page: input.page,
        pageSize: input.pageSize,
        hasMore: input.page * input.pageSize < total,
      };
    }),

  /**
   * 上传文件 — base64 → MinIO → MediaItem.create
   *
   * Phase 1:不做缩略图生成 / 不解析元数据(meta 留 {})
   *   - 真接 ImageMagick / ffprobe 留 Phase 2 异步 worker
   */
  upload: protectedProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(255),
        fileBase64: z.string().min(1), // data:image/...;base64,xxx OR pure base64
        kind: KIND_ENUM,
        scope: SCOPE_ENUM.default('PROJECT'),
        projectId: z.string().cuid().optional(),
        mimeType: z.string().max(100).optional(),
        tags: z.array(z.string().max(40)).max(20).default([]),
        // Phase 1.5 P0-5:同步到中转站素材库(获 asset:// 引用,后续视频生成免重传)
        // 默认 false — 仅 W4 资产首图 / W5 视频参考图等"高频复用"场景显式开启
        // 需先在 SystemSetting `relay.assets.default_group_id` 配 group_id 才生效
        syncToRelay: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 权限:PROJECT 必须有 projectId 且 user 是该项目成员
      if (input.scope === 'PROJECT') {
        if (!input.projectId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'scope=PROJECT 必须提供 projectId',
          });
        }
        const accessible = await ctx.prisma.project.findFirst({
          where: {
            id: input.projectId,
            deletedAt: null,
            OR: [
              { ownerId: ctx.user.id },
              { members: { some: { userId: ctx.user.id } } },
            ],
          },
          select: { id: true },
        });
        if (!accessible) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: '无权上传到该项目',
          });
        }
      } else if (input.scope === 'PERSONAL') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'PERSONAL scope 留 Phase 2',
        });
      }

      // 解析 base64(支持 data URL 前缀)
      const m = input.fileBase64.match(/^data:([^;]+);base64,(.+)$/);
      const pureBase64 = m ? m[2]! : input.fileBase64;
      const detectedMime = m ? m[1]! : undefined;
      const mimeType = input.mimeType ?? detectedMime ?? 'application/octet-stream';

      let buffer: Buffer;
      try {
        buffer = Buffer.from(pureBase64, 'base64');
      } catch (e) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `base64 解码失败: ${sanitizeErrorMsg(e)}`,
        });
      }

      // 第 18 轮 audit P1:mimeType ↔ kind 交叉校验(SVG XSS / PDF 假冒 IMAGE 等)
      const allowedMime = ALLOWED_MIME_BY_KIND[input.kind];
      if (!allowedMime.test(mimeType)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `kind=${input.kind} 不允许 mimeType=${mimeType}(SVG/PDF 等需走 OTHER 或对应 kind)`,
        });
      }

      if (buffer.byteLength > UPLOAD_MAX_BYTES) {
        throw new TRPCError({
          code: 'PAYLOAD_TOO_LARGE',
          message: `文件超过上限 ${UPLOAD_MAX_BYTES / 1024 / 1024}MB(实际 ${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB)`,
        });
      }

      // 拼 storageKey + putObject
      const ext = input.filename.split('.').pop()?.toLowerCase() ?? 'bin';
      const storageKey = buildStorageKey({
        scope: input.scope === 'PUBLIC' ? 'public' : 'project',
        projectId: input.projectId ?? undefined,
        kind: kindToStorageKind(input.kind),
        ext,
      });

      const storage = getStorageAdapter();
      const putResult = await storage.putObject(storageKey, buffer, {
        contentType: mimeType,
        acl: input.scope === 'PUBLIC' ? 'public-read' : 'private',
      });

      // Phase 1.5 P0-5:尝试同步到中转站素材库(失败时 fallback 不阻塞上传)
      let relayAssetUrl: string | null = null;
      let relayAssetId: string | null = null;
      let relaySyncError: string | null = null;
      if (input.syncToRelay && input.kind !== 'OTHER' && input.kind !== 'THREE_D') {
        try {
          const [relayProvider, groupId] = await Promise.all([
            getRelayAssetProvider(),
            getRelayDefaultGroupId(),
          ]);
          if (relayProvider && groupId !== null) {
            // 中转站服务端会下载 url,需公网可达 → PUBLIC 用 putResult.url,PROJECT 用签名 URL(12h 有效)
            const fetchUrl =
              input.scope === 'PUBLIC' && putResult.url
                ? putResult.url
                : await storage.getSignedUrl(storageKey, 12 * 3600);
            const assetType =
              input.kind === 'IMAGE' ? 'Image' : input.kind === 'VIDEO' ? 'Video' : 'Audio';
            const created = await relayProvider.createAsset({
              url: fetchUrl,
              assetType,
              groupId,
              name: input.filename.slice(0, 64),
            });
            relayAssetUrl = created.assetUrl;
            relayAssetId = created.id;
          } else if (input.syncToRelay) {
            relaySyncError = relayProvider
              ? 'relay.assets.default_group_id 未配置(去 /admin/settings 填)'
              : '无 active 中转站 provider(去 /admin/providers 启用 relay-* 项)';
          }
        } catch (e) {
          relaySyncError = sanitizeErrorMsg(e);
          console.warn(`[media.upload] relay sync failed for ${input.filename}:`, e);
        }
      }

      const media = await ctx.prisma.mediaItem.create({
        data: {
          projectId: input.scope === 'PROJECT' ? input.projectId : null,
          scope: input.scope,
          kind: input.kind,
          filename: input.filename,
          mimeType,
          sizeBytes: buffer.byteLength,
          storageKey,
          cdnUrl: input.scope === 'PUBLIC' ? putResult.url : null,
          aspectRatio: null,
          tags: input.tags,
          source: 'UPLOAD',
          // Phase 1.5 P0-5:中转站 asset URL 存 meta,aigc.generateVideo 接 relay provider 时优先用
          meta: {
            ...(relayAssetUrl ? { relayAssetUrl, relayAssetId } : {}),
            ...(relaySyncError ? { relaySyncError } : {}),
          },
        },
      });

      await logOperation(
        ctx,
        'media.upload',
        'mediaItem',
        media.id,
        null,
        {
          filename: media.filename,
          kind: media.kind,
          scope: media.scope,
          sizeBytes: media.sizeBytes,
          projectId: media.projectId,
          relayAssetUrl,
          relaySyncError,
        },
      );

      return media;
    }),

  /** 切换收藏(true/false 自动 toggle) */
  toggleFavorite: protectedProcedure
    .input(z.object({ mediaId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const m = await ctx.prisma.mediaItem.findFirst({
        where: { id: input.mediaId, deletedAt: null },
        select: { id: true, isFavorited: true, projectId: true, scope: true },
      });
      if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'media 不存在' });

      // 权限:PROJECT scope 需 user 是项目成员;PUBLIC 任何登录用户可收藏
      if (m.scope === 'PROJECT' && m.projectId) {
        const accessible = await ctx.prisma.project.findFirst({
          where: {
            id: m.projectId,
            OR: [
              { ownerId: ctx.user.id },
              { members: { some: { userId: ctx.user.id } } },
            ],
          },
          select: { id: true },
        });
        if (!accessible) throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const updated = await ctx.prisma.mediaItem.update({
        where: { id: m.id },
        data: { isFavorited: !m.isFavorited },
        select: { id: true, isFavorited: true },
      });
      return updated;
    }),

  /** 软删 — 仅 uploader / project admin / global admin 可删 */
  softDelete: protectedProcedure
    .input(z.object({ mediaId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const m = await ctx.prisma.mediaItem.findFirst({
        where: { id: input.mediaId, deletedAt: null },
        include: { project: { select: { ownerId: true } } },
      });
      if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'media 不存在' });

      // 权限:global admin / project owner / project ADMIN member
      let canDelete = ctx.user.isAdmin;
      if (!canDelete && m.projectId && m.project) {
        if (m.project.ownerId === ctx.user.id) {
          canDelete = true;
        } else {
          const adminMember = await ctx.prisma.projectMember.findUnique({
            where: {
              projectId_userId: { projectId: m.projectId, userId: ctx.user.id },
            },
          });
          canDelete = adminMember?.role === 'ADMIN';
        }
      } else if (!canDelete && m.scope === 'PUBLIC') {
        canDelete = ctx.user.isAdmin; // 公共库只 admin 能删
      }
      if (!canDelete) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '需要项目管理员或全局管理员权限',
        });
      }

      await ctx.prisma.mediaItem.update({
        where: { id: m.id },
        data: { deletedAt: new Date() },
      });
      await logOperation(
        ctx,
        'media.delete',
        'mediaItem',
        m.id,
        { filename: m.filename, scope: m.scope, projectId: m.projectId },
        null,
      );
      return { id: m.id, success: true };
    }),

  /** 临时签名 URL — 私有 media 预览/下载用 */
  getSignedUrl: protectedProcedure
    .input(z.object({ mediaId: z.string().cuid(), expiresInSeconds: z.number().min(60).max(3600).default(300) }))
    .query(async ({ ctx, input }) => {
      const m = await ctx.prisma.mediaItem.findFirst({
        where: { id: input.mediaId, deletedAt: null },
        select: { id: true, storageKey: true, cdnUrl: true, scope: true, projectId: true },
      });
      if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'media 不存在' });

      // 权限:PROJECT scope 需 user 是项目成员
      if (m.scope === 'PROJECT' && m.projectId) {
        const accessible = await ctx.prisma.project.findFirst({
          where: {
            id: m.projectId,
            OR: [
              { ownerId: ctx.user.id },
              { members: { some: { userId: ctx.user.id } } },
            ],
          },
          select: { id: true },
        });
        if (!accessible) throw new TRPCError({ code: 'FORBIDDEN' });
      }

      // PUBLIC 直接返 cdnUrl
      if (m.scope === 'PUBLIC' && m.cdnUrl) {
        return { url: m.cdnUrl, expiresInSeconds: 0 };
      }

      // 外部 URL(AIGC 生成的 external://xxx)直接返
      if (m.storageKey.startsWith('external://')) {
        return { url: m.storageKey.replace(/^external:\/\//, ''), expiresInSeconds: 0 };
      }

      const storage = getStorageAdapter();
      const url = await storage.getSignedUrl(m.storageKey, input.expiresInSeconds);
      return { url, expiresInSeconds: input.expiresInSeconds };
    }),
});
