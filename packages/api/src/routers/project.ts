/**
 * Project Router — Mission Control 后端
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  createProjectSchema,
  updateProjectSchema,
} from '@ss/shared/schemas';

import { router, protectedProcedure } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';

export const projectRouter = router({
  /** 列表 — 当前用户可见的所有项目 */
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          take: z.number().min(1).max(100).default(50),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const projects = await ctx.prisma.project.findMany({
        where: {
          deletedAt: null,
          OR: [
            { ownerId: ctx.user.id },
            { members: { some: { userId: ctx.user.id } } },
          ],
          ...(input?.search && {
            name: { contains: input.search, mode: 'insensitive' as const },
          }),
        },
        orderBy: { updatedAt: 'desc' },
        take: input?.take ?? 50,
        include: {
          _count: {
            select: { episodes: true, assets: true, members: true },
          },
          owner: {
            select: { id: true, displayName: true, avatarUrl: true },
          },
          members: {
            take: 8,
            select: {
              user: {
                select: { id: true, displayName: true, avatarUrl: true },
              },
            },
          },
        },
      });
      return projects;
    }),

  /** 单项目详情（含统计） */
  get: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findFirst({
        where: {
          id: input.id,
          deletedAt: null,
          OR: [
            { ownerId: ctx.user.id },
            { members: { some: { userId: ctx.user.id } } },
          ],
        },
        include: {
          owner: { select: { id: true, displayName: true, avatarUrl: true } },
          style: true,
          members: {
            include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
          },
          // W1-W7 audit:episodes 过滤 deletedAt + 内嵌 shots _count 用 where 过滤 shot.deletedAt
          // 防软删 episode 出现在卡片列表,以及软删 shot 进 episode 进度统计
          episodes: {
            where: { deletedAt: null },
            orderBy: { number: 'asc' },
            select: {
              id: true,
              number: true,
              title: true,
              status: true,
              publishedAt: true,
              _count: { select: { shots: { where: { deletedAt: null } } } },
            },
          },
        },
      });
      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '项目不存在或无权访问' });
      }

      // 统计数字 — W1-W7 audit:episode 也要过滤 deletedAt(原 episode 软删时其下 shot 仍被统计)
      const [shotCount, assetCount, completedShots] = await Promise.all([
        ctx.prisma.shot.count({
          where: {
            episode: { projectId: project.id, deletedAt: null },
            deletedAt: null,
          },
        }),
        ctx.prisma.asset.count({ where: { projectId: project.id, deletedAt: null } }),
        ctx.prisma.shot.count({
          where: {
            episode: { projectId: project.id, deletedAt: null },
            deletedAt: null, // 与 shotCount 一致,防 progressPct > 100%
            status: { in: ['ADOPTED', 'IN_EDIT', 'FINAL'] },
          },
        }),
      ]);

      return {
        ...project,
        stats: {
          shotCount,
          assetCount,
          completedShots,
          progressPct: shotCount > 0 ? Math.round((completedShots / shotCount) * 100) : 0,
        },
      };
    }),

  /** 创建项目 */
  create: protectedProcedure
    .input(createProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.create({
        data: {
          ...input,
          ownerId: ctx.user.id,
          members: {
            create: {
              userId: ctx.user.id,
              role: 'OWNER',
              modules: ['director', 'art', 'aigc', 'edit', 'library', 'analytics'],
            },
          },
        },
      });
      await logOperation(ctx, 'project.create', 'project', project.id, null, project);
      return project;
    }),

  /** 更新项目 */
  update: protectedProcedure
    .input(z.object({ id: z.string().cuid(), data: updateProjectSchema }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.project.findFirst({
        where: { id: input.id, deletedAt: null },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      const isOwner = existing.ownerId === ctx.user.id;
      const isAdmin = await ctx.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: input.id, userId: ctx.user.id } },
      });
      if (!isOwner && isAdmin?.role !== 'ADMIN' && !ctx.user.isAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '无修改权限' });
      }

      const updated = await ctx.prisma.project.update({
        where: { id: input.id },
        data: input.data,
      });
      await logOperation(ctx, 'project.update', 'project', updated.id, existing, updated);
      return updated;
    }),

  /** 软删除项目 */
  delete: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.project.findFirst({
        where: { id: input.id, deletedAt: null },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      if (existing.ownerId !== ctx.user.id && !ctx.user.isAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '仅项目所有者可删除' });
      }
      await ctx.prisma.project.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      });
      await logOperation(ctx, 'project.delete', 'project', input.id, existing, null);
      return { success: true };
    }),

  /** 克隆项目（保留资产 + 剧本，重置进度） */
  clone: protectedProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        newName: z.string().min(1).max(120),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 校验访问权限 — 任何登录用户不能克隆别人的项目
      const src = await ctx.prisma.project.findFirst({
        where: {
          id: input.id,
          deletedAt: null,
          OR: [
            { ownerId: ctx.user.id },
            { members: { some: { userId: ctx.user.id } } },
          ],
        },
      });
      if (!src) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '项目不存在或无权访问' });
      }

      const cloned = await ctx.prisma.project.create({
        data: {
          name: input.newName,
          description: src.description,
          type: src.type,
          aspect: src.aspect,
          styleId: src.styleId,
          ownerId: ctx.user.id,
          members: {
            create: {
              userId: ctx.user.id,
              role: 'OWNER',
              modules: ['director', 'art', 'aigc', 'edit', 'library', 'analytics'],
            },
          },
        },
      });
      // 资产/剧本的深克隆放 Phase 2 — 当前仅复制元信息
      await logOperation(ctx, 'project.clone', 'project', cloned.id, src, cloned);
      return cloned;
    }),
});
