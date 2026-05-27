import { z } from 'zod';

import { aspectRatioSchema } from './project.js';

export const videoGenerationRequestSchema = z.object({
  shotId: z.string().cuid(),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  prompt: z.string().min(1),
  durationS: z.number().positive().max(60).default(5),
  aspectRatio: aspectRatioSchema.default('9:16'),
  seed: z.number().int().optional(),
  refImageUrls: z.array(z.string().url()).default([]),
  complianceIds: z.array(z.string()).default([]),
  extraParams: z.record(z.unknown()).optional(),
});

export type VideoGenerationRequest = z.infer<typeof videoGenerationRequestSchema>;

export const imageGenerationRequestSchema = z.object({
  assetId: z.string().cuid().optional(),
  projectId: z.string().cuid(),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  prompt: z.string().min(1),
  refImageUrls: z.array(z.string().url()).default([]),
  count: z.number().int().min(1).max(4).default(1),
  aspectRatio: z.string().optional(),
  extraParams: z.record(z.unknown()).optional(),
});

export type ImageGenerationRequest = z.infer<typeof imageGenerationRequestSchema>;
