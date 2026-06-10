/**
 * M6 动态 Prompt 优化 — 类型层(蓝图 docs/06 §5)。
 *
 * 核心扩展点 ContextContributor:优化器本体不硬编码"喂什么",新维度 = 新增一个
 * contributor 文件 + SystemSetting 开关,核心不动(§5.2)。首批四个:
 * shot / assets / style / continuity。
 */
import type { PrismaClient } from '@ss/db';

/** 优化目标 provider 家族 — 模板按家族自适应输出风格(§5.1) */
export type ProviderFamily = 'seedance' | 'kling' | 'happyhorse' | 'generic';

/** 预装配好的优化上下文 — contributor 只读,不再各自查库(一次装配多处消费) */
export interface OptimizeContext {
  prisma: PrismaClient;
  group: {
    id: string;
    number: string;
    prompt: string;
    durationS: number;
    episodeId: string;
    projectId: string;
  };
  /** 组内镜(positionIdx 升序):四维 + 音效 + 内容 + 时长 */
  shots: Array<{
    positionIdx: number;
    framing: string | null;
    angle: string | null;
    movement: string | null;
    lighting: string | null;
    sound: string | null;
    content: string;
    durationS: number;
    priority: string | null;
  }>;
  /** 绑定资产(refSlotIdx 升序去重):优化器知道 @token 指向谁 */
  assets: Array<{
    name: string;
    type: string;
    /** 编译器口径的 token 文本(@图片N/@音频N,按 binding kind);无槽位 null */
    token: string | null;
    /** 资产基础提示词截断摘要(控输入体积) */
    promptBrief: string;
  }>;
  /** 项目风格(StyleProfile) */
  style: {
    characterPrompt: string | null;
    scenePrompt: string | null;
    propPrompt: string | null;
    forbiddenWords: string[];
  } | null;
  /** 上一组(剧本顺序,同集):衔接注记素材;首组 null */
  prevGroup: {
    number: string;
    prompt: string;
    lastShotContent: string | null;
    sameScene: boolean;
  } | null;
  providerFamily: ProviderFamily;
}

/**
 * ContextContributor — §5.2 可扩展架构。
 * render 返回该维度的上下文段落(null = 本组无此维度内容,跳过)。
 * Phase 2 升多模态时返回类型扩 union(MultiModalPart),核心收集逻辑不变。
 */
export interface PromptContextContributor {
  /** 开关键名(SystemSetting prompt.optimizer.contributors CSV 里的项) */
  key: string;
  /** 拼接顺序(小在前) */
  order: number;
  render(ctx: OptimizeContext): Promise<string | null>;
}

export interface OptimizeResult {
  ok: true;
  /** 优化后的提示词正文(已过 token 保全校验) */
  optimized: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costCny: number;
  /** 启用且产出了内容的 contributor keys(审计/调试) */
  contributorsUsed: string[];
}

export interface OptimizeDeny {
  ok: false;
  code: 'NO_BINDING' | 'EMPTY_PROMPT' | 'TOKEN_LOST' | 'EMPTY_OUTPUT';
  message: string;
  /** TOKEN_LOST 时:LLM 原始输出(供人工查看为什么丢 token) */
  rawOutput?: string;
  costCny?: number;
}

export type OptimizeOutcome = OptimizeResult | OptimizeDeny;
