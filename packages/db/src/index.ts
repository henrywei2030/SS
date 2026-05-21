/**
 * @ss/db — Prisma Client 统一出口
 * 在所有 packages 中通过 import { prisma } from '@ss/db' 使用
 */
export * from './client.js';
export * from './enums.js';
export type {
  User,
  Project,
  ProjectMember,
  Episode,
  EpisodeAssignment,
  Script,
  ScriptAnalysis,
  Shot,
  ShotAssetRef,
  Asset,
  AssetVersion,
  MediaItem,
  GenerationAttempt,
  CostLedgerEntry,
  OperationLog,
  PromptTemplate,
  PromptTemplateVersion,
  StyleProfile,
  ProviderConfig,
  Invitation,
  Notification,
  WorkReportSnapshot,
  Prisma,
} from '@prisma/client';
