/**
 * H1(docs/07 §2 Planner):确定性检索规划 — 结构化字段推"本组哪几维是重点 + 每维怎么检索"。
 *
 * 零成本零 LLM(docs/07 H1 拍板:确定性规则起步;LLM Planner 留 `harness.planner.enabled`
 * 升级位,enabled 时由 H2+ 接管本函数的输出口径)。
 *
 * 设计要点:
 *   - allowTagFallback 是"对症 vs 通用"的闸:画质/稳定/主体纪律是通用维(无关键词命中也
 *     该注入,tag 模式按 hitCount 给);光影/氛围/动作/运镜是对症维(没证据就别硬塞 —
 *     tag 兜底会把「治愈清新」塞进紧张戏,宁缺毋滥)
 *   - 镜头语言通则(景别阶梯/黄金结构等无关键词条目)由 storyboard_main v3 模板承载,
 *     优化器侧只检索对症条目(对话→轴线/特写→特写时机)— 模板=通则,检索=对症
 *   - 维度 k 总预算 ≈ 8-12 条 × ~40 字 ≈ 500 字,不撑爆优化器输入
 */
import type { RetrieveFilter } from './retrieval.js';

/** Planner 输入(OptimizeContext 的纯数据子集 — 保持可单测) */
export interface PlannerInput {
  groupPrompt: string;
  shots: Array<{
    framing?: string | null;
    angle?: string | null;
    movement?: string | null;
    lighting?: string | null;
    sound?: string | null;
    content?: string | null;
  }>;
  /** 绑定里有 CHARACTER 资产(→ 主体/稳定纪律) */
  hasCharacterAssets: boolean;
  /** 目标模型家族(tag 过滤) */
  providerFamily: string;
}

/** 单维检索计划 */
export interface PlannedRetrieval {
  dimension: string;
  k: number;
  /** false = 对症维:keyword 零命中时不走 tag 兜底(宁缺毋滥) */
  allowTagFallback: boolean;
}

export interface KnowledgePlan {
  /** 检索查询文本 = 组正文 + 逐镜内容/音效(keyword 降级链匹配源 & embedding query 原文) */
  queryText: string;
  filter: RetrieveFilter;
  retrievals: PlannedRetrieval[];
}

/** 夜戏信号:文本时段词 或 镜头光线字段含低调/冷调/月光 */
const NIGHT_RE = /夜|深夜|凌晨|月光|月色|入夜|天黑|晚上/;
const DUSK_RE = /黄昏|夕阳|傍晚|日落|晨曦|黎明|清晨/;

export function planKnowledgeRetrieval(input: PlannerInput): KnowledgePlan {
  const pieces = [
    input.groupPrompt,
    ...input.shots.map((s) => [s.content ?? '', s.sound ?? ''].filter(Boolean).join(' ')),
  ].filter((s) => s.trim().length > 0);
  // 查询文本上限 4000 字(containment 匹配无需更长;防极端组撑大后续 embedding 输入)
  const queryText = pieces.join('\n').slice(0, 4000);

  const lightingValues = input.shots.map((s) => (s.lighting ?? '').trim()).filter(Boolean);
  const hasLightingSignal =
    lightingValues.length > 0 || NIGHT_RE.test(queryText) || DUSK_RE.test(queryText);
  const hasMovementSignal =
    input.shots.length >= 2 || input.shots.some((s) => (s.movement ?? '').trim().length > 0);

  const retrievals: PlannedRetrieval[] = [
    // 通用维(八要素 #7/#8 此前全缺,文章"质量保险丝")— 永远在,tag 兜底放行
    { dimension: 'QUALITY', k: 1, allowTagFallback: true },
    { dimension: 'CONSTRAINT', k: 2, allowTagFallback: true },
  ];
  if (queryText.length > 0) {
    // 动作翻译对:按正文情绪词对症(紧张/愤怒/犹豫…),零命中不硬塞
    retrievals.push({ dimension: 'ACTION', k: 2, allowTagFallback: false });
    // 场景氛围/年代具体化:对症(雨/废墟/年代词…)
    retrievals.push({ dimension: 'SCENE', k: 2, allowTagFallback: false });
    // 风格词:对症(正文/风格描述出现风格词才注入,避免风格污染)
    retrievals.push({ dimension: 'STYLE', k: 1, allowTagFallback: false });
  }
  if (hasLightingSignal) {
    retrievals.push({ dimension: 'LIGHTING', k: 2, allowTagFallback: false });
  }
  if (hasMovementSignal) {
    retrievals.push({ dimension: 'CAMERA', k: 2, allowTagFallback: false });
  }
  if (input.hasCharacterAssets) {
    // 主体纪律(@token 锚定/出场定装)是通用纪律 → tag 兜底放行
    retrievals.push({ dimension: 'SUBJECT', k: 2, allowTagFallback: true });
  }

  return {
    queryText,
    filter: { family: input.providerFamily },
    retrievals,
  };
}
