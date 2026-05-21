/**
 * 跨包共享的工具类型
 */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type Maybe<T> = T | null | undefined;

export type Brand<T, B> = T & { readonly __brand: B };

export type UserId = Brand<string, 'UserId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type EpisodeId = Brand<string, 'EpisodeId'>;
export type ShotId = Brand<string, 'ShotId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type MediaItemId = Brand<string, 'MediaItemId'>;
export type AttemptId = Brand<string, 'AttemptId'>;

export interface PaginationInput {
  page?: number;
  pageSize?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
}

export interface AuditContext {
  userId: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}
