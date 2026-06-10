/**
 * F4 整集批量生成 — 纯函数层(优先级排序/时长口径/批次标签)。
 *
 * 排序规则(蓝图 docs/06 §M4):Shot.priority S>A>B>C;组优先级 = 组内最高 shot 优先级;
 * 组内 shot 全空时回退 ScriptAnalysis.productionPlan 的场级优先级(sceneIdx ↔ 场序);
 * 仍无则压底。同优先级按首镜 positionIdx(剧本顺序)。IO 留 api/batch-followup,这里可单测。
 */

export type BatchPriority = 'S' | 'A' | 'B' | 'C';

/** GenerationAttempt.groupId 的批次标签前缀(区别于单点重抽归组 UUID) */
export const BATCH_GROUP_PREFIX = 'batch_' as const;

export function isBatchGroupId(groupId: string | null | undefined): groupId is string {
  return typeof groupId === 'string' && groupId.startsWith(BATCH_GROUP_PREFIX);
}

/** 失败 retryable 自动重抽上限设置 KEY(默认 0=关;clamp 0-3 防失控烧钱) */
export const BATCH_RETRY_MAX_KEY = 'batch.retry.max' as const;

export function parseBatchRetryMax(raw: string | undefined | null): number {
  const n = Number(raw ?? '0');
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3, Math.trunc(n)));
}

/**
 * 批量生成的单组时长口径 — estimate 与提交必须同公式(验收:预估 vs 实扣偏差 <10%)。
 * group.durationS 是 Float(LLM 可产 7.5),VideoGenJobData 要求 int → round 后 clamp。
 */
export function batchDurationS(groupDurationS: number | null | undefined, maxDurationS: number): number {
  const raw = Math.round(groupDurationS ?? 5);
  return Math.max(1, Math.min(raw, Math.max(1, Math.round(maxDurationS))));
}

const PRIORITY_RANK: Record<BatchPriority, number> = { S: 0, A: 1, B: 2, C: 3 };
const NO_PRIORITY_RANK = 9;

export interface BatchGroupCandidate {
  groupId: string;
  number: string;
  durationS: number;
  /** 组内首镜 positionIdx(剧本顺序 tiebreak;无镜组压底) */
  firstShotPos: number;
  /** 组内最高 shot.priority(S 最高);全空 null */
  bestShotPriority: BatchPriority | null;
  /** ScriptAnalysis.productionPlan 场级优先级回退(shot 全空时用) */
  scenePlanPriority: BatchPriority | null;
}

export function candidateRank(c: BatchGroupCandidate): number {
  const p = c.bestShotPriority ?? c.scenePlanPriority;
  return p ? PRIORITY_RANK[p] : NO_PRIORITY_RANK;
}

/** S>A>B>C 排序(plan 回退),同级按首镜顺序;入参不变,返回新数组 */
export function orderBatchCandidates(cands: BatchGroupCandidate[]): BatchGroupCandidate[] {
  return [...cands].sort((a, b) => {
    const ra = candidateRank(a);
    const rb = candidateRank(b);
    if (ra !== rb) return ra - rb;
    return a.firstShotPos - b.firstShotPos;
  });
}

/** productionPlan Json 防御性解析:[{sceneIdx, priority, ...}] → Map<sceneIdx, priority> */
export function parseProductionPlanPriorities(plan: unknown): Map<number, BatchPriority> {
  const out = new Map<number, BatchPriority>();
  if (!Array.isArray(plan)) return out;
  for (const item of plan) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const idx = typeof o.sceneIdx === 'number' ? o.sceneIdx : Number(o.sceneIdx);
    const p = o.priority;
    if (
      Number.isInteger(idx) &&
      (p === 'S' || p === 'A' || p === 'B' || p === 'C') &&
      !out.has(idx)
    ) {
      out.set(idx, p);
    }
  }
  return out;
}
