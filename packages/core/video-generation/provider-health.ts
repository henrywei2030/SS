/**
 * F5b-b(七二):Provider 健康度 + failover 解析。
 *
 * 健康度(ProviderConfig.healthScore 0.2-1,起始 1;lastErrorAt 最近真打失败时刻):
 *   - worker 真打失败(provider.generate 抛/超时)→ score-0.2(clamp 0.2)+ lastErrorAt=now
 *   - 真打成功 → score+0.1(clamp 1)
 *   确定性微步进(口径同 H3 权重 ±0.05 思路):单次抖动不击穿,连败 3 次进不健康区。
 *   ⚠️ 只在 worker 真打终态更新 — submit 预检 deny(缺图/预算等)不是 provider 的锅,不扣分。
 *
 * failover(shot.video.fallbackProviderIds,CSV;空=关):
 *   - 仅作用于「未显式 override」的提交(用户点名 = 用户意图,绝不偷换)
 *   - 主家不健康(score < 0.5 且 lastErrorAt 在 10 分钟内)→ 取第一个健康的备选
 *   - 备选全不健康/不存在 → 保持主家(best effort)+ 调用方记日志
 */
import type { PrismaClient } from '@ss/db';

const HEALTH_MIN = 0.2;
const HEALTH_MAX = 1;
const FAIL_STEP = 0.2;
const RECOVER_STEP = 0.1;
/** 不健康判定:分数线 + 最近失败时间窗(老失败不挡道,自然冷却) */
const UNHEALTHY_BELOW = 0.5;
const RECENT_ERROR_WINDOW_MS = 10 * 60_000;

export const FALLBACK_PROVIDERS_KEY = 'shot.video.fallbackProviderIds';

/** worker 真打终态记录健康度(增强项:任何失败吞掉不影响主流程) */
export async function recordProviderOutcome(
  prisma: PrismaClient,
  providerId: string,
  outcome: 'success' | 'failure',
): Promise<void> {
  try {
    const row = await prisma.providerConfig.findUnique({
      where: { providerId },
      select: { healthScore: true },
    });
    if (!row) return;
    const next =
      outcome === 'failure'
        ? Math.max(HEALTH_MIN, row.healthScore - FAIL_STEP)
        : Math.min(HEALTH_MAX, row.healthScore + RECOVER_STEP);
    await prisma.providerConfig.update({
      where: { providerId },
      data: {
        healthScore: next,
        ...(outcome === 'failure' ? { lastErrorAt: new Date() } : {}),
      },
    });
  } catch (e) {
    console.warn(
      `[provider-health] ${providerId} 健康度更新失败(忽略):`,
      e instanceof Error ? e.message : e,
    );
  }
}

export interface FailoverResolution {
  providerId: string;
  /** 发生了切换时带原因(UI toast / 日志) */
  failedOver?: { from: string; reason: string };
}

function isUnhealthy(row: { healthScore: number; lastErrorAt: Date | null }, now: number): boolean {
  return (
    row.healthScore < UNHEALTHY_BELOW &&
    row.lastErrorAt != null &&
    now - row.lastErrorAt.getTime() < RECENT_ERROR_WINDOW_MS
  );
}

/**
 * 解析「实际下发」的 provider:主家健康直接用;不健康时从 CSV 备选里取第一个健康且
 * active 的。备选无可用 → 仍返回主家(best effort)。
 */
export async function resolveHealthyVideoProvider(
  prisma: PrismaClient,
  args: { primaryProviderId: string; fallbackCsv: string | null | undefined },
): Promise<FailoverResolution> {
  const fallbacks = (args.fallbackCsv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== args.primaryProviderId);
  if (fallbacks.length === 0) return { providerId: args.primaryProviderId };

  const now = Date.now();
  const rows = await prisma.providerConfig.findMany({
    where: { providerId: { in: [args.primaryProviderId, ...fallbacks] } },
    select: { providerId: true, healthScore: true, lastErrorAt: true, isActive: true },
  });
  const byId = new Map(rows.map((r) => [r.providerId, r]));
  const primary = byId.get(args.primaryProviderId);
  if (!primary || !isUnhealthy(primary, now)) {
    return { providerId: args.primaryProviderId };
  }
  for (const fb of fallbacks) {
    const row = byId.get(fb);
    if (row && row.isActive && !isUnhealthy(row, now)) {
      return {
        providerId: fb,
        failedOver: {
          from: args.primaryProviderId,
          reason: `主 Provider 健康度 ${primary.healthScore.toFixed(1)}(${Math.round(
            (now - (primary.lastErrorAt?.getTime() ?? now)) / 60000,
          )} 分钟前有失败)→ 自动切换备选`,
        },
      };
    }
  }
  // 备选全不可用:保持主家(best effort)
  return { providerId: args.primaryProviderId };
}
