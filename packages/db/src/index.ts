/**
 * @ss/db — Prisma Client 统一出口
 * 在所有 packages 中通过 import { prisma } from '@ss/db' 使用
 */
export * from './client.js';
export * from './enums.js';
// W1-W5 audit P1 followup(R9):Prisma 既作类型(Prisma.Decimal 类型)也作 value(new Prisma.Decimal()),
// 必须 value-export 而不能 type-only
// Prisma 7 升级:Prisma + model 类型从生成的 client 导出,不再从 @prisma/client
export { Prisma } from './generated/prisma/client.js';
export type {
  User,
  Project,
  ProjectMember,
  Episode,
  EpisodeAssignment,
  Script,
  ScriptAnalysis,
  Shot,
  Asset,
  AssetUsageBinding,
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
} from './generated/prisma/client.js';

// W1-W5 audit P2 followup(P2-3):ShotAssetRef 类型已从公共导出移除
// schema 里 model 还在(@deprecated 标记),W6 schema 升级时一起 drop 表 + enum AssetRefKind。
// 删除步骤(W6 执行):
//   1. schema 删 model ShotAssetRef + enum AssetRefKind + Shot.assets + Asset.bindings
//   2. prisma migrate dev --create-only,人工把 dropTable 改成 IF EXISTS
//   3. 删 db/src/enums.ts 的 AssetRefKind export
