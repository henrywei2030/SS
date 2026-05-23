/**
 * sanitize-prompt — GenerationAttempt.inputJson 写入前的敏感数据处理(W7 audit R8 P0)
 *
 * 背景:之前 inputJson 完整存 `compiled.positive` / `references[].name` 明文,
 * 含 NDA / 客户名 / 真实人名的 prompt 任何 DBA / 备份泄露 / 越权 listVideoTakes 都能拿到。
 *
 * 策略(Phase 1 简单且可逆):
 *   - 保留 prompt 短摘要(前 200 字)+ SHA-256 hash(便于追溯但无法逆推)
 *   - references 只保留 refSlotIdx + kind + assetId,丢 name 和 mediaUrl
 *   - 其他业务结构化字段(durationS / aspectRatio / kind / sceneNumber)正常保留
 *
 * Phase 2 升级路径:对 inputJson 做字段级加密(沿用 encryptSecret + APP_MASTER_KEY)。
 */
import { createHash } from 'node:crypto';

const MAX_PREVIEW_CHARS = 200;

export function sanitizePromptForLedger(text: string): {
  preview: string;
  hash: string;
  length: number;
} {
  const trimmed = text.trim();
  return {
    preview: trimmed.slice(0, MAX_PREVIEW_CHARS) + (trimmed.length > MAX_PREVIEW_CHARS ? '…' : ''),
    hash: createHash('sha256').update(trimmed).digest('hex').slice(0, 16),
    length: trimmed.length,
  };
}

export interface RawVideoReference {
  refSlotIdx: number;
  kind: string;
  assetId: string;
  name?: string;
  mediaUrl?: string;
  token?: string;
}

/** 引用清单脱敏:丢 name / mediaUrl,保留 idx + kind + assetId(便于追溯) */
export function sanitizeReferencesForLedger(
  refs: RawVideoReference[],
): Array<{ refSlotIdx: number; kind: string; assetId: string }> {
  return refs.map((r) => ({
    refSlotIdx: r.refSlotIdx,
    kind: r.kind,
    assetId: r.assetId,
  }));
}
