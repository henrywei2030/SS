/**
 * Voice & Audio 共用 schema（Phase 2 Voice Studio）
 */
import { z } from 'zod';

export const voiceCloneRequestSchema = z.object({
  characterAssetId: z.string().cuid().optional(),
  sourceMediaIds: z.array(z.string().cuid()).min(1).max(10),
  voiceName: z.string().min(1).max(60),
  /** 'elevenlabs' | 'minimax' | 'cosyvoice' | ... */
  providerId: z.string(),
});

export type VoiceCloneRequest = z.infer<typeof voiceCloneRequestSchema>;

export const voiceGenerationRequestSchema = z.object({
  voiceId: z.string().cuid(),
  text: z.string().min(1).max(10_000),
  emotion: z.enum(['neutral', 'happy', 'sad', 'angry', 'excited', 'whisper']).default('neutral'),
  speed: z.number().min(0.5).max(2).default(1),
  language: z.string().default('zh-CN'),
});

export type VoiceGenerationRequest = z.infer<typeof voiceGenerationRequestSchema>;
