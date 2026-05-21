import { z } from 'zod';

export const priorityCodeSchema = z.enum(['S', 'A', 'B', 'C']);

export const shotInputSchema = z.object({
  episodeId: z.string().cuid(),
  number: z.string().min(1),
  framing: z.string().optional(),
  angle: z.string().optional(),
  content: z.string().min(1),
  prompt: z.string().min(1),
  priority: priorityCodeSchema.optional(),
  durationS: z.number().positive().max(60).default(5),
  positionIdx: z.number().int().nonnegative(),
});

export type ShotInput = z.infer<typeof shotInputSchema>;

export const mergeShotsSchema = z.object({
  episodeId: z.string().cuid(),
  shotIds: z.array(z.string().cuid()).min(2),
});

export type MergeShotsInput = z.infer<typeof mergeShotsSchema>;
