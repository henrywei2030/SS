/**
 * 剧本分析核心 — Phase 1 单次 LLM 调用（W2.7 后续可加多 Agent 对抗）
 *
 * 输入：剧本全文（按集）
 * 输出：8 维评分 + 整集诊断 + 剧情曲线 + 制作曲线
 */
import { getTextProvider } from '@ss/adapters/provider';
import type { CallContext } from '@ss/adapters/provider';

export interface AnalysisInput {
  scriptText: string;
  episodeNumber: number;
  projectType?: string;
  ctx: CallContext;
  modelId?: string;
}

export interface AnalysisDimensions {
  hookScore: number;
  suspenseScore: number;
  twistScore: number;
  climaxScore: number;
  conflictScore: number;
  dialogueScore: number;
  paceScore: number;
  urgencyScore: number;
  overallScore: number;
}

export interface AnalysisIssue {
  severity: 'high' | 'medium' | 'low';
  scene?: string;
  type: string;
  description: string;
  suggestion: string;
}

export interface AnalysisHighlight {
  type: string;
  text: string;
}

export interface CurvePoint {
  time: string;      // "00:00:27"
  emotion: number;   // 0-10
  badges: string[];  // ['hook','climax','twist']
  scene?: string;
}

export interface ProductionPlanItem {
  sceneIdx: number;
  priority: 'S' | 'A' | 'B' | 'C';
  durationS: number;
  note?: string;
}

export interface AnalysisResult {
  scores: AnalysisDimensions;
  summary: string;
  highlights: AnalysisHighlight[];
  issues: AnalysisIssue[];
  curve: CurvePoint[];
  productionPlan: ProductionPlanItem[];
  cost: number;
}

const SYSTEM_PROMPT = `你是经验丰富的短剧制作总监。分析剧本，从制作落地视角输出结构化诊断 JSON。

【重要】你必须先找问题再打分（反向打分原则）：
1. 先识别剧本的具体问题（台词生硬、节奏断层、钩子薄弱、信息冗余等）
2. 基于问题反推分数（问题越严重，对应维度分数越低）
3. 不要"夸"——AI 评分容易虚高，请保持批判性

输出严格 JSON，结构：
{
  "scores": {
    "hookScore": 0-10,
    "suspenseScore": 0-10,
    "twistScore": 0-10,
    "climaxScore": 0-10,
    "conflictScore": 0-10,
    "dialogueScore": 0-10,
    "paceScore": 0-10,
    "urgencyScore": 0-10,
    "overallScore": 0-10
  },
  "summary": "整集 200 字诊断（指出 3 大亮点 + 3 大问题）",
  "highlights": [{ "type": "情绪张力" | "反派塑造" | ..., "text": "20 字" }],
  "issues": [{ "severity": "high"|"medium"|"low", "scene": "1-3", "type": "台词锐度"|"钩子力度"|..., "description": "30 字", "suggestion": "改写建议 30 字" }],
  "curve": [{ "time": "00:00:27", "emotion": 0-10, "badges": ["hook"|"climax"|"twist"|"low"], "scene": "1" }],
  "productionPlan": [{ "sceneIdx": 1, "priority": "S"|"A"|"B"|"C", "durationS": 15, "note": "需多抽卡保证情绪" }]
}

priority 含义：
- S = 爽点 / 反转，最高优先级，多抽卡 + 顶级模型
- A = 高潮 / 冲突，重要镜头
- B = 叙事推进，标准制作
- C = 过渡 / 信息交代，可用 fast 模型降本

curve 点数：每集 8-15 个，覆盖完整时间线。`;

export async function analyzeScript(input: AnalysisInput): Promise<AnalysisResult> {
  const provider = await getTextProvider(input.modelId ?? 'claude-sonnet-4-5');
  const result = await provider.generate(
    {
      system: SYSTEM_PROMPT,
      prompt: `请分析以下第 ${input.episodeNumber} 集剧本：\n\n${input.scriptText}`,
      maxTokens: 4096,
      temperature: 0.2,
      jsonSchema: {},
    },
    input.ctx,
  );

  if (!result.json) {
    throw new Error('剧本分析返回非 JSON');
  }
  const parsed = result.json as Partial<AnalysisResult>;

  return {
    scores: parsed.scores ?? {
      hookScore: 0,
      suspenseScore: 0,
      twistScore: 0,
      climaxScore: 0,
      conflictScore: 0,
      dialogueScore: 0,
      paceScore: 0,
      urgencyScore: 0,
      overallScore: 0,
    },
    summary: parsed.summary ?? '',
    highlights: parsed.highlights ?? [],
    issues: parsed.issues ?? [],
    curve: parsed.curve ?? [],
    productionPlan: parsed.productionPlan ?? [],
    cost: result.costCny,
  };
}
