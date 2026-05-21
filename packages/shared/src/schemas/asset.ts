import { z } from 'zod';

export const assetTypeSchema = z.enum(['CHARACTER', 'SCENE', 'PROP', 'STYLE_REFERENCE']);

export const createAssetSchema = z.object({
  projectId: z.string().cuid(),
  type: assetTypeSchema,
  name: z.string().min(1).max(120),
  alias: z.array(z.string()).default([]),
  description: z.string().max(2000).optional(),
  prompt: z.string().min(1),
  characterRole: z.string().optional(),
  tags: z.array(z.string()).default([]),
  styleId: z.string().cuid().optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;

export const assetBreakdownInputSchema = z.object({
  projectId: z.string().cuid(),
  episodeId: z.string().cuid().optional(),
  scriptText: z.string().min(1),
  steps: z.array(z.enum(['step1_core', 'step2_support', 'step3_species', 'step4_crowd'])).default([
    'step1_core',
    'step2_support',
    'step3_species',
    'step4_crowd',
  ]),
});

export type AssetBreakdownInput = z.infer<typeof assetBreakdownInputSchema>;
