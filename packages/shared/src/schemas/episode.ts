/**
 * Episode / Script 共用 Zod schema
 */
import { z } from 'zod';

export const createEpisodeSchema = z.object({
  projectId: z.string().cuid(),
  number: z.number().int().positive(),
  title: z.string().max(200).optional(),
});

export type CreateEpisodeInput = z.infer<typeof createEpisodeSchema>;

export const uploadScriptSchema = z.object({
  projectId: z.string().cuid(),
  episodeNumber: z.number().int().positive(),
  title: z.string().max(200).optional(),
  content: z.string().min(1, '剧本内容不能为空').max(500_000, '剧本过长 (max 500K)'),
  language: z.string().default('zh-CN'),
});

export type UploadScriptInput = z.infer<typeof uploadScriptSchema>;

export const analyzeScriptSchema = z.object({
  scriptId: z.string().cuid(),
  modelId: z.string().default('claude-sonnet-4-5'),
});

export type AnalyzeScriptInput = z.infer<typeof analyzeScriptSchema>;
