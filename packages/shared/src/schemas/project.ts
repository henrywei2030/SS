import { z } from 'zod';

export const projectTypeSchema = z.enum(['AI_REAL', 'ANIM_3D', 'ANIM_2D', 'POSTER', 'CUSTOM']);

export const aspectRatioSchema = z.enum(['9:16', '16:9', '1:1']);

export const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  type: projectTypeSchema,
  aspect: aspectRatioSchema,
  styleId: z.string().cuid().optional(),
  budgetCny: z.number().nonnegative().optional(),
  startDate: z.coerce.date().optional(),
  daysCount: z.number().int().positive().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
