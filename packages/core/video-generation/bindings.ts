/**
 * 视频生成 binding/业务参数读取(F4 随批量自动重抽下沉自 api getVideoBindings)。
 *
 * 下沉动机:批量失败 retryable 自动重抽发生在 worker 侧(无 tRPC ctx),重抽与
 * router 必须用同一套参数解析 — 单一真相源放 core,api getVideoBindings 转调。
 * 逻辑与原 api 版逐行等价(W5.4 + r12 NaN 防御 + M2′ 配音参数 + 六七深审 P2 clamp)。
 */
import type { PrismaClient } from '@ss/db';
import type { Prisma } from '@ss/db';
import { ASPECT_RATIOS, type AspectRatio } from '@ss/shared/constants';

export interface VideoGenBindings {
  providerId: string;
  maxDurationS: number;
  defaultAspectRatio: AspectRatio;
  dailyBudgetCny: number;
  /** F5b-b:failover 备选 provider CSV(空=关) */
  fallbackProviderIds: string;
  defaultGenerateAudio: boolean;
  audioSurchargeCnyPerS: number;
}

// 2026-05-27 audit r12:Number() 非法值返 NaN 会污染下游 Math.min / Decimal 计算
// SystemSetting 老值 / admin 误填 null/字符串时,fallback 到合理默认而非 NaN
function parseNum(
  raw: string | undefined,
  fallback: number,
  min = -Infinity,
  max = Infinity,
): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

export async function loadVideoGenBindings(
  prisma: Prisma.TransactionClient | PrismaClient,
): Promise<VideoGenBindings> {
  const rows = await prisma.systemSetting.findMany({
    where: {
      key: {
        in: [
          'binding.shot.video.providerId',
          'shot.video.maxDurationS',
          'shot.video.defaultAspectRatio',
          'shot.video.dailyBudgetCny',
          // F5b-b(七二):failover 备选链(CSV;空=关)
          'shot.video.fallbackProviderIds',
          // M2′ 配音产品化(2026-06-10):有声默认开关 + 有声差价
          'shot.video.generateAudio.default',
          'shot.video.audioSurchargeCnyPerS',
        ],
      },
    },
    select: { key: true, value: true },
  });
  const settings: Record<string, string | undefined> = {};
  for (const r of rows) settings[r.key] = r.value;

  const rawAr = settings['shot.video.defaultAspectRatio'] ?? '9:16';
  // 2026-05-27:扩到 6 比例后用 ASPECT_RATIOS 真相源校验,白名单外的默认 9:16
  const ar: AspectRatio = (ASPECT_RATIOS as readonly string[]).includes(rawAr)
    ? (rawAr as AspectRatio)
    : '9:16';

  return {
    // 二十收工后用户反馈:不 hardcode 默认 provider,空时调用方判断
    providerId: settings['binding.shot.video.providerId'] ?? '',
    maxDurationS: parseNum(settings['shot.video.maxDurationS'], 15),
    defaultAspectRatio: ar,
    dailyBudgetCny: parseNum(settings['shot.video.dailyBudgetCny'], 500),
    // F5b-b(七二):failover 备选链(resolveHealthyVideoProvider 消费;空=关)
    fallbackProviderIds: settings['shot.video.fallbackProviderIds'] ?? '',
    // 七二:requireComplianceForVideo 已退役(合规改纯标识,不再门控生成)
    // seedance 2.0 文档默认 generate_audio=true → 系统默认跟随,admin 可改
    defaultGenerateAudio: (settings['shot.video.generateAudio.default'] ?? 'true') === 'true',
    // clamp [0,100]:防 admin 误填负数/超大值污染 UI 预估(六七深审 P2)
    audioSurchargeCnyPerS: parseNum(settings['shot.video.audioSurchargeCnyPerS'], 0, 0, 100),
  };
}
