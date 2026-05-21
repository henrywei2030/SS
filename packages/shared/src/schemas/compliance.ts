/**
 * Compliance 合规模块共用 schema（W1.7 + Phase 2 Compliance Sentinel 用）
 */
import { z } from 'zod';

export const complianceCheckRequestSchema = z.object({
  targetType: z.enum(['script', 'shot', 'asset', 'reel']),
  targetId: z.string().cuid(),
  imageUrl: z.string().url().optional(),
  /** 平台规则集：'volcengine' | 'douyin' | 'kuaishou' | 'youtube' ... */
  platform: z.string().default('volcengine'),
});

export type ComplianceCheckRequest = z.infer<typeof complianceCheckRequestSchema>;

export const complianceResultSchema = z.object({
  approved: z.boolean(),
  complianceId: z.string().optional(),
  reasons: z.array(z.string()).default([]),
  costCny: z.number().nonnegative().default(0),
});

export type ComplianceResult = z.infer<typeof complianceResultSchema>;
