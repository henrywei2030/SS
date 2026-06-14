/**
 * Project Router — Mission Control 后端
 *
 * W6 Collab Hub(2026-05-24):扩展 listMembers / addMember / removeMember /
 * updateMemberRole / searchAddableUsers / listAssignments / assignUserToEpisode /
 * unassignUser 8 个 procedure,加 assertProjectAdmin helper。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  createProjectSchema,
  updateProjectSchema,
} from '@ss/shared/schemas';

import { router, protectedProcedure } from '../trpc.js';
import { logOperation } from '../middleware/audit.js';
import type { Context } from '../context.js';

// ===========================================================================
// W6 Collab Hub:权限 helper
//
// 校验当前用户对项目有"管理"权限 — owner / member.role=ADMIN / 全局 admin
// 任何 member CRUD / episode assignment 必须先调,统一权限语义
// ===========================================================================
async function assertProjectAdmin(
  ctx: Context,
  projectId: string,
): Promise<{ id: string; ownerId: string; name: string }> {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const project = await ctx.prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, ownerId: true, name: true },
  });
  if (!project) {
    throw new TRPCError({ code: 'NOT_FOUND', message: '项目不存在' });
  }
  if (project.ownerId === ctx.user.id || ctx.user.isAdmin) return project;
  const member = await ctx.prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: ctx.user.id } },
  });
  if (member?.role === 'ADMIN') return project;
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: '需要项目所有者 / ADMIN 权限',
  });
}

const MODULE_ENUM = z.enum([
  'director',
  'art',
  'aigc',
  'library',
  'analytics',
]);
const MEMBER_ROLE_ENUM = z.enum(['ADMIN', 'LEADER', 'MEMBER', 'VIEWER']);
const ASSIGN_ROLE_ENUM = z.enum(['OWNER', 'COLLAB', 'REVIEWER']);

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
            // r7 audit:IN_EDIT 枚举值已删除(剪辑模块已移除)
            status: { in: ['ADOPTED', 'FINAL'] },
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
  /** 七二第十波(#4 项目↔风格联动):风格列表 — 供建项目/编辑项目的风格选择器用。
   *  非 admin 可读(只返展示必要字段),与 admin.style.list(管理用,adminProcedure)分开。 */
  listStyles: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.styleProfile.findMany({
      orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, kind: true },
    });
  }),

  create: protectedProcedure
    // 第 20 轮 audit / ADR-27:Mastra agent 创建新项目接入点
    .meta({
      agentTool: {
        description: '创建一个新项目(自动添加 owner 为 OWNER 成员)',
        sideEffects: ['db.create:Project', 'db.create:ProjectMember', 'OperationLog.write'],
        costEstimateCny: 0,
        requireConfirm: false,
      },
    })
    .input(createProjectSchema)
    .mutation(async ({ ctx, input }) => {
      // 七二第十波(#4 项目↔风格联动 — 根因修复):此前建项目从不绑 style → project.styleId 永远
      //   NULL → 风格三段 prompt(scene/character/prop)对分镜与资产生成链全程不生效(摆设)。
      //   现:用户未显式选 styleId 时,按 project.type 自动绑对应内置风格,让风格 prompt 真正进链路。
      //   POSTER/CUSTOM 无对口内置风格 → 不强绑(留 NULL,用户可后续在风格选择器里改)。
      let styleId = input.styleId;
      if (!styleId) {
        const TYPE_DEFAULT_STYLE_SLUG: Partial<Record<typeof input.type, string>> = {
          AI_REAL: 'ai_real',
          ANIM_3D: 'anim_3d',
          ANIM_2D: 'anim_2d',
        };
        const slug = TYPE_DEFAULT_STYLE_SLUG[input.type];
        if (slug) {
          const st = await ctx.prisma.styleProfile.findUnique({
            where: { slug },
            select: { id: true },
          });
          styleId = st?.id;
        }
      }
      const project = await ctx.prisma.project.create({
        data: {
          ...input,
          styleId,
          ownerId: ctx.user.id,
          members: {
            create: {
              userId: ctx.user.id,
              role: 'OWNER',
              modules: ['director', 'art', 'aigc', 'library', 'analytics'],
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
              modules: ['director', 'art', 'aigc', 'library', 'analytics'],
            },
          },
        },
      });
      // 资产/剧本的深克隆放 Phase 2 — 当前仅复制元信息
      await logOperation(ctx, 'project.clone', 'project', cloned.id, src, cloned);
      return cloned;
    }),

  // =========================================================================
  // W6 Collab Hub:成员管理(7 procedure)
  // =========================================================================

  /** 列项目成员(含 owner) — 任何项目成员可查 */
  listMembers: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findFirst({
        where: {
          id: input.projectId,
          deletedAt: null,
          OR: [
            { ownerId: ctx.user.id },
            { members: { some: { userId: ctx.user.id } } },
          ],
        },
        include: {
          owner: {
            select: {
              id: true,
              displayName: true,
              email: true,
              avatarUrl: true,
              status: true,
            },
          },
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  displayName: true,
                  email: true,
                  avatarUrl: true,
                  status: true,
                },
              },
            },
            orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
          },
        },
      });
      if (!project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '项目不存在或无权访问',
        });
      }
      return {
        ownerId: project.ownerId,
        owner: project.owner,
        members: project.members,
      };
    }),

  /** 添加成员 — 必须是已注册激活用户 */
  addMember: protectedProcedure
    // 第 20 轮 audit / ADR-27:Mastra agent 加成员前必须确认人选(防误邀请到敏感项目)
    .meta({
      agentTool: {
        description: '将某 user 加为项目成员,role 决定权限(OWNER/ADMIN/LEADER/MEMBER/VIEWER)',
        sideEffects: ['db.create:ProjectMember', 'OperationLog.write'],
        costEstimateCny: 0,
        requireConfirm: true,
      },
    })
    .input(
      z.object({
        projectId: z.string().cuid(),
        userId: z.string().cuid(),
        role: MEMBER_ROLE_ENUM,
        // r7 audit:default 改为全 5 个模块,防前端传空数组导致新成员无任何权限
        modules: z.array(MODULE_ENUM).default(['director', 'art', 'aigc', 'library', 'analytics']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAdmin(ctx, input.projectId);
      const targetUser = await ctx.prisma.user.findFirst({
        where: { id: input.userId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, displayName: true, email: true },
      });
      if (!targetUser) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '用户不存在或已禁用',
        });
      }
      const existing = await ctx.prisma.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: input.projectId,
            userId: input.userId,
          },
        },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `${targetUser.displayName} 已是项目成员`,
        });
      }
      const member = await ctx.prisma.projectMember.create({
        data: {
          projectId: input.projectId,
          userId: input.userId,
          role: input.role,
          modules:
            input.modules.length > 0
              ? input.modules
              : ['director', 'art', 'aigc', 'library', 'analytics'],
        },
      });
      await logOperation(
        ctx,
        'project.member.add',
        'projectMember',
        `${input.projectId}/${input.userId}`,
        null,
        { ...member, projectId: input.projectId, targetUserName: targetUser.displayName },
      );
      return member;
    }),

  /** 移除成员(不能移除 owner) */
  removeMember: protectedProcedure
    .input(z.object({ projectId: z.string().cuid(), userId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const project = await assertProjectAdmin(ctx, input.projectId);
      if (input.userId === project.ownerId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '不能移除项目 owner — 请先转移所有权(Phase 2)',
        });
      }
      const before = await ctx.prisma.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: input.projectId,
            userId: input.userId,
          },
        },
        include: { user: { select: { displayName: true } } },
      });
      if (!before) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '成员不存在' });
      }
      await ctx.prisma.projectMember.delete({
        where: {
          projectId_userId: {
            projectId: input.projectId,
            userId: input.userId,
          },
        },
      });
      await logOperation(
        ctx,
        'project.member.remove',
        'projectMember',
        `${input.projectId}/${input.userId}`,
        before,
        { projectId: input.projectId },
      );
      return { success: true };
    }),

  /** 更新成员 role(owner role 不可改) */
  updateMemberRole: protectedProcedure
    .input(
      z.object({
        projectId: z.string().cuid(),
        userId: z.string().cuid(),
        role: MEMBER_ROLE_ENUM,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await assertProjectAdmin(ctx, input.projectId);
      if (input.userId === project.ownerId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Owner 角色不可改(转移所有权 Phase 2)',
        });
      }
      const before = await ctx.prisma.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: input.projectId,
            userId: input.userId,
          },
        },
      });
      if (!before) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '成员不存在' });
      }
      const updated = await ctx.prisma.projectMember.update({
        where: {
          projectId_userId: {
            projectId: input.projectId,
            userId: input.userId,
          },
        },
        data: { role: input.role },
      });
      await logOperation(
        ctx,
        'project.member.updateRole',
        'projectMember',
        `${input.projectId}/${input.userId}`,
        before,
        { ...updated, projectId: input.projectId },
      );
      return updated;
    }),

  /** 搜索可邀请的用户(已是成员的排除) */
  searchAddableUsers: protectedProcedure
    .input(z.object({ projectId: z.string().cuid(), q: z.string().max(100) }))
    .query(async ({ ctx, input }) => {
      await assertProjectAdmin(ctx, input.projectId);
      const q = input.q.trim();
      if (q.length < 1) return [];
      const project = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
        select: { ownerId: true },
      });
      const existingMemberIds = await ctx.prisma.projectMember.findMany({
        where: { projectId: input.projectId },
        select: { userId: true },
      });
      const excludeIds = [
        ...existingMemberIds.map((m) => m.userId),
        ...(project ? [project.ownerId] : []),
      ];
      const users = await ctx.prisma.user.findMany({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          id: { notIn: excludeIds },
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { username: { contains: q, mode: 'insensitive' } },
            { displayName: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 20,
        select: {
          id: true,
          displayName: true,
          email: true,
          username: true,
          avatarUrl: true,
        },
        orderBy: [{ displayName: 'asc' }],
      });
      return users;
    }),

  // =========================================================================
  // W6 Collab Hub:集数分配(3 procedure)
  // =========================================================================

  /** 列项目所有集 + 各集的 EpisodeAssignment */
  listAssignments: protectedProcedure
    .input(z.object({ projectId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findFirst({
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
      if (!project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '项目不存在或无权访问',
        });
      }
      const episodes = await ctx.prisma.episode.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        orderBy: { number: 'asc' },
        include: {
          assignments: {
            include: {
              user: {
                select: {
                  id: true,
                  displayName: true,
                  email: true,
                  avatarUrl: true,
                },
              },
            },
            orderBy: [{ role: 'asc' }, { assignedAt: 'asc' }],
          },
          _count: {
            select: { shotGroups: { where: { deletedAt: null } } },
          },
        },
      });
      return episodes.map((e) => ({
        id: e.id,
        number: e.number,
        title: e.title,
        status: e.status,
        totalGroups: e._count.shotGroups,
        assignments: e.assignments,
      }));
    }),

  /** 分配集到用户(必须是项目成员或 owner) */
  assignUserToEpisode: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().cuid(),
        userId: z.string().cuid(),
        role: ASSIGN_ROLE_ENUM,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ep = await ctx.prisma.episode.findFirst({
        where: { id: input.episodeId, deletedAt: null },
        include: { project: { select: { id: true, ownerId: true } } },
      });
      if (!ep) throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
      await assertProjectAdmin(ctx, ep.projectId);
      const isProjectOwner = ep.project.ownerId === input.userId;
      if (!isProjectOwner) {
        const isMember = await ctx.prisma.projectMember.findUnique({
          where: {
            projectId_userId: {
              projectId: ep.projectId,
              userId: input.userId,
            },
          },
        });
        if (!isMember) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '只能分配给项目成员 — 请先在团队页添加成员',
          });
        }
      }
      const existing = await ctx.prisma.episodeAssignment.findUnique({
        where: {
          episodeId_userId_role: {
            episodeId: input.episodeId,
            userId: input.userId,
            role: input.role,
          },
        },
      });
      if (existing) {
        return { ...existing, alreadyExisted: true };
      }
      const assignment = await ctx.prisma.episodeAssignment.create({
        data: {
          episodeId: input.episodeId,
          userId: input.userId,
          role: input.role,
        },
      });
      await logOperation(
        ctx,
        'episode.assign',
        'episodeAssignment',
        assignment.id,
        null,
        { ...assignment, projectId: ep.projectId },
      );
      return { ...assignment, alreadyExisted: false };
    }),

  /** 取消分配 */
  unassignUser: protectedProcedure
    .input(z.object({ assignmentId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.episodeAssignment.findUnique({
        where: { id: input.assignmentId },
        include: { episode: { select: { projectId: true } } },
      });
      if (!before) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '分配不存在' });
      }
      await assertProjectAdmin(ctx, before.episode.projectId);
      await ctx.prisma.episodeAssignment.delete({
        where: { id: input.assignmentId },
      });
      await logOperation(
        ctx,
        'episode.unassign',
        'episodeAssignment',
        input.assignmentId,
        before,
        { projectId: before.episode.projectId },
      );
      return { success: true };
    }),
});
