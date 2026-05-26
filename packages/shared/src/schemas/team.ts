/**
 * 团队协作 共用 schema
 */
import { z } from 'zod';

export const memberRoleSchema = z.enum(['OWNER', 'ADMIN', 'LEADER', 'MEMBER', 'VIEWER']);

export const assignRoleSchema = z.enum(['OWNER', 'COLLAB', 'REVIEWER']);

export const workbenchModuleSchema = z.enum([
  'director',
  'art',
  'aigc',
  'library',
  'analytics',
]);

export const inviteMemberSchema = z.object({
  projectId: z.string().cuid(),
  email: z.string().email(),
  role: memberRoleSchema.default('MEMBER'),
  modules: z.array(workbenchModuleSchema).default([]),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const assignEpisodeSchema = z.object({
  episodeId: z.string().cuid(),
  userId: z.string().cuid(),
  role: assignRoleSchema,
});

export type AssignEpisodeInput = z.infer<typeof assignEpisodeSchema>;
