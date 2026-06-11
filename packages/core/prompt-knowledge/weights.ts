/**
 * H3(docs/07 飞轮回路②③):qcScore × run.fragmentIds 相关性权重升降 + 家族雷点沉淀。
 *
 * 回路②(权重):take 出 QC 分后,找该组最近一次 applied 优化 run 的知识片段 —
 *   高分(≥80)条目 weight +0.05,低分(<60)-0.05,clamp [0.2, 2]。
 *   确定性微步进:单次真打影响小,长期数据累积才改变排序(防单次 QC 抖动反转知识库)。
 *   ⚠️ qcScore 是不可信信号(M3c 注入面纪律)— 它只调"检索排序的次级权重",
 *   永远不能自动启停/删改条目内容(那是 admin 审核的事)。
 *
 * 回路③(沉淀):QC 判定形象漂移 → 按模型家族 upsert 一条 CONSTRAINT 维候选条目
 *   (source=MINED,enabled=false 等 admin 审核;hitCount 当证据计数累加)。
 */
import type { PrismaClient } from '@ss/db';

const WEIGHT_STEP = 0.05;
const WEIGHT_MIN = 0.2;
const WEIGHT_MAX = 2;
/** run 关联窗:优化与真打间隔超过该窗则不归因(组 prompt 可能已被改) */
const RUN_RELEVANCE_WINDOW_MS = 7 * 24 * 3600 * 1000;

export async function applyQcFeedbackToKnowledge(
  prisma: PrismaClient,
  args: {
    groupId: string;
    qcScore: number | null;
    /** QC 判定的形象漂移(qcJson.drift) */
    drift?: boolean | null;
    /** 视频模型家族(detectProviderFamily(attempt.providerId)) */
    providerFamily?: string | null;
  },
): Promise<void> {
  try {
    // 回路②:片段权重升降
    if (args.qcScore !== null && Number.isFinite(args.qcScore)) {
      const delta = args.qcScore >= 80 ? WEIGHT_STEP : args.qcScore < 60 ? -WEIGHT_STEP : 0;
      if (delta !== 0) {
        const run = await prisma.promptOptimizeRun.findFirst({
          where: {
            groupId: args.groupId,
            applied: true,
            createdAt: { gte: new Date(Date.now() - RUN_RELEVANCE_WINDOW_MS) },
          },
          orderBy: { createdAt: 'desc' },
          select: { fragmentIds: true },
        });
        if (run && run.fragmentIds.length > 0) {
          await prisma.promptKnowledge.updateMany({
            where: { id: { in: run.fragmentIds } },
            data: { weight: { increment: delta } },
          });
          // clamp(两条 updateMany,无竞态危害 — weight 是排序软信号非资金)
          await prisma.promptKnowledge.updateMany({
            where: { id: { in: run.fragmentIds }, weight: { gt: WEIGHT_MAX } },
            data: { weight: WEIGHT_MAX },
          });
          await prisma.promptKnowledge.updateMany({
            where: { id: { in: run.fragmentIds }, weight: { lt: WEIGHT_MIN } },
            data: { weight: WEIGHT_MIN },
          });
        }
      }
    }

    // 回路③:漂移 → 家族约束维候选沉淀
    if (args.drift && args.providerFamily && args.providerFamily !== 'generic') {
      await sedimentDriftConstraint(prisma, args.providerFamily);
    }
  } catch (e) {
    // 飞轮是增强项 — 任何失败不影响 QC 主流程
    console.warn('[knowledge-flywheel] qc 反馈应用失败(忽略):', e instanceof Error ? e.message : e);
  }
}

/** 漂移雷点候选(幂等 upsert by slug;hitCount 当证据计数) */
export async function sedimentDriftConstraint(
  prisma: PrismaClient,
  family: string,
): Promise<void> {
  const slug = `pk_mined_qc_drift_${family}`;
  await prisma.promptKnowledge.upsert({
    where: { slug },
    create: {
      slug,
      dimension: 'CONSTRAINT',
      title: `${family} 系形象漂移雷点(QC 自动沉淀)`,
      content:
        '该模型家族出现过人物形象漂移(QC 判定):提示词正文显式加强「五官一致、面部不变形、同一人物贯穿全片」约束,并优先附带人物形象参考图',
      tagsJson: { family: [family] },
      source: 'MINED',
      enabled: false, // 等 admin 审核启用(D-D:候选条目需人工把关)
    },
    update: { hitCount: { increment: 1 } },
  });
}
